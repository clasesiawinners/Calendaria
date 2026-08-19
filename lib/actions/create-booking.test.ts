import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { createActivity } from "@/lib/db/repositories/activities";
import { createBooking } from "./create-booking";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { ResendLike } from "@/lib/email/resend-client";

const db = createTestDb();

function makeFakeGoogleClient(overrides: Partial<GoogleCalendarClient> = {}): GoogleCalendarClient {
  return {
    insertEvent: vi.fn().mockResolvedValue({ googleEventId: "google-evt-1" }),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listEvents: vi.fn(),
    ...overrides,
  };
}

function makeFakeResend(): ResendLike {
  return {
    emails: { send: vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }) },
  };
}

const buildManageUrl = (token: string) => `https://example.com/reservar/gestionar/${token}`;

beforeEach(async () => {
  await truncateAll(db);
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  await upsertAppConfig(db, {
    googleCalendarId: "primary",
    googleRefreshToken: encryptToken("refresh-token"),
    conflictPolicy: "block",
    timezone: "America/Santiago",
  });
});

describe("createBooking", () => {
  it("rechaza cuando el rango horario es inválido", async () => {
    const result = await createBooking(db, () => makeFakeGoogleClient(), makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T15:00:00Z"),
      end: new Date("2026-08-24T14:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });
    expect(result.status).toBe("invalid");
  });

  it("bloquea si hay conflicto (política block, sin excepción para el público)", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Ocupado",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "admin",
      syncStatus: "synced",
    });

    const result = await createBooking(db, () => makeFakeGoogleClient(), makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T14:30:00Z"),
      end: new Date("2026-08-24T15:30:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });
    expect(result.status).toBe("conflict");
  });

  it("crea la reserva, la sincroniza con Google, envía el email y guarda booking_token", async () => {
    const googleClient = makeFakeGoogleClient();
    const resend = makeFakeResend();

    const result = await createBooking(db, () => googleClient, resend, buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T14:00:00Z"),
      end: new Date("2026-08-24T15:00:00Z"),
      bookerName: "Ana Pérez",
      bookerEmail: "ana@example.com",
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.createdBy).toBe("public");
      expect(result.activity.status).toBe("programada");
      expect(result.activity.color).toBe("azul");
      expect(result.activity.bookingToken).toBeTruthy();
      expect(result.activity.bookerEmail).toBe("ana@example.com");
      expect(result.activity.syncStatus).toBe("synced");
    }
    expect(googleClient.insertEvent).toHaveBeenCalledOnce();
    expect(resend.emails.send).toHaveBeenCalledOnce();
    const emailCall = (resend.emails.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(emailCall.to).toEqual(["ana@example.com"]);
  });

  it("crea la reserva aunque falle el envío del email (no revierte la actividad)", async () => {
    const googleClient = makeFakeGoogleClient();
    const resend: ResendLike = {
      emails: { send: vi.fn().mockRejectedValue(new Error("Resend down")) },
    };

    const result = await createBooking(db, () => googleClient, resend, buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-25T14:00:00Z"),
      end: new Date("2026-08-25T15:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });

    expect(result.status).toBe("created");
  });

  it("rechaza un horario en el pasado", async () => {
    const result = await createBooking(db, () => makeFakeGoogleClient(), makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2020-01-01T14:00:00Z"),
      end: new Date("2020-01-01T15:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/pasado/i);
    }
  });

  it("rechaza un horario fuera del horario de atención laboral", async () => {
    // Horario laboral configurado 08:00-19:00 America/Santiago; 03:00 UTC cae de madrugada, fuera de horario.
    const result = await createBooking(db, () => makeFakeGoogleClient(), makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T03:00:00Z"),
      end: new Date("2026-08-24T04:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/horario de atención/i);
    }
  });

  it("marca sync_status=error si falla Google, pero conserva la reserva y el booking_token", async () => {
    const googleClient = makeFakeGoogleClient({
      insertEvent: vi.fn().mockRejectedValue(new Error("Google API unavailable")),
    });

    const result = await createBooking(db, () => googleClient, makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-26T14:00:00Z"),
      end: new Date("2026-08-26T15:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.syncStatus).toBe("error");
      expect(result.activity.bookingToken).toBeTruthy();
    }
  });
});
