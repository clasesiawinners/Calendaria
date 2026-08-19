import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { createActivity } from "@/lib/db/repositories/activities";
import { rescheduleBooking, cancelBooking } from "./manage-booking";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

const db = createTestDb();
const TOKEN = "22222222-2222-2222-2222-222222222222";

function makeFakeGoogleClient(overrides: Partial<GoogleCalendarClient> = {}): GoogleCalendarClient {
  return {
    insertEvent: vi.fn().mockResolvedValue({ googleEventId: "google-evt-1" }),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listEvents: vi.fn(),
    ...overrides,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  await upsertAppConfig(db, {
    googleCalendarId: "primary",
    googleRefreshToken: encryptToken("refresh-token"),
    timezone: "America/Santiago",
  });
});

describe("cancelBooking", () => {
  it("devuelve not_found si el token no existe", async () => {
    const result = await cancelBooking(db, () => makeFakeGoogleClient(), "00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe("not_found");
  });

  it("hace soft delete de la actividad y elimina el evento en Google", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient();
    const result = await cancelBooking(db, () => googleClient, TOKEN);

    expect(result.status).toBe("cancelled");
    expect(googleClient.deleteEvent).toHaveBeenCalledWith("google-evt-1");

    const afterCancel = await cancelBooking(db, () => googleClient, TOKEN);
    expect(afterCancel.status).toBe("not_found");
  });

  it("retorna cancelled aunque deleteEvent de Google lance una excepción (el soft-delete local ya se aplicó)", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient({
      deleteEvent: vi.fn().mockRejectedValue(new Error("Google API unavailable")),
    });

    const result = await cancelBooking(db, () => googleClient, TOKEN);
    expect(result.status).toBe("cancelled");
    expect(googleClient.deleteEvent).toHaveBeenCalledWith("google-evt-1");
  });
});

describe("rescheduleBooking", () => {
  it("devuelve not_found si el token no existe", async () => {
    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: "00000000-0000-0000-0000-000000000000",
      start: new Date("2026-08-24T16:00:00Z"),
      end: new Date("2026-08-24T17:00:00Z"),
    });
    expect(result.status).toBe("not_found");
  });

  it("rechaza si el nuevo rango es inválido", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: TOKEN,
      start: new Date("2026-08-24T17:00:00Z"),
      end: new Date("2026-08-24T16:00:00Z"),
    });
    expect(result.status).toBe("invalid");
  });

  it("rechaza si el nuevo start está en el pasado", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: TOKEN,
      start: new Date("2020-01-01T14:00:00Z"),
      end: new Date("2020-01-01T15:00:00Z"),
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/pasado/i);
    }
  });

  it("rechaza si el nuevo horario cae fuera del horario de atención laboral", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: TOKEN,
      start: new Date("2026-08-25T03:00:00Z"),
      end: new Date("2026-08-25T04:00:00Z"),
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/horario de atención/i);
    }
  });

  it("bloquea si el nuevo horario se solapa con otra actividad", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva propia",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });
    await createActivity(db, {
      source: "manual",
      title: "Otra actividad",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T17:00:00Z"),
      endDatetime: new Date("2026-08-24T18:00:00Z"),
      createdBy: "admin",
      syncStatus: "synced",
    });

    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: TOKEN,
      start: new Date("2026-08-24T17:30:00Z"),
      end: new Date("2026-08-24T18:30:00Z"),
    });
    expect(result.status).toBe("conflict");
  });

  it("actualiza el horario y llama a Google events.update con el nuevo rango", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient();
    const result = await rescheduleBooking(db, () => googleClient, {
      token: TOKEN,
      start: new Date("2026-08-25T14:00:00Z"),
      end: new Date("2026-08-25T15:00:00Z"),
    });

    expect(result.status).toBe("rescheduled");
    if (result.status === "rescheduled") {
      expect(result.activity.startDatetime.toISOString()).toBe("2026-08-25T14:00:00.000Z");
      expect(result.activity.syncStatus).toBe("synced");
    }
    expect(googleClient.updateEvent).toHaveBeenCalledWith(
      "google-evt-1",
      expect.objectContaining({ start: new Date("2026-08-25T14:00:00Z") })
    );
  });

  it("queda pending (no error) cuando la actividad nunca se sincronizó a Google pero la config está completa, preservando el mensaje de error original", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "error",
      syncErrorMessage: "Google API unavailable (fallo original)",
      googleEventId: null,
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient();
    const result = await rescheduleBooking(db, () => googleClient, {
      token: TOKEN,
      start: new Date("2026-08-25T14:00:00Z"),
      end: new Date("2026-08-25T15:00:00Z"),
    });

    expect(result.status).toBe("rescheduled");
    if (result.status === "rescheduled") {
      expect(result.activity.syncStatus).toBe("pending");
      expect(result.activity.syncErrorMessage).toBe("Google API unavailable (fallo original)");
    }
    expect(googleClient.updateEvent).not.toHaveBeenCalled();
  });

  it("queda pending con syncErrorMessage null cuando la actividad nunca se sincronizó y no había error previo", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "pending",
      googleEventId: null,
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient();
    const result = await rescheduleBooking(db, () => googleClient, {
      token: TOKEN,
      start: new Date("2026-08-25T14:00:00Z"),
      end: new Date("2026-08-25T15:00:00Z"),
    });

    expect(result.status).toBe("rescheduled");
    if (result.status === "rescheduled") {
      expect(result.activity.syncStatus).toBe("pending");
      expect(result.activity.syncErrorMessage).toBeNull();
    }
  });
});
