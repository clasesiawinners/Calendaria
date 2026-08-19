import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { createManualActivity } from "./create-manual-activity";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

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

describe("createManualActivity", () => {
  it("rechaza cuando el rango horario es inválido", async () => {
    const googleClient = makeFakeGoogleClient();
    const result = await createManualActivity(db, () => googleClient, {
      title: "Test",
      activityType: "Otro",
      start: new Date("2026-08-20T11:00:00Z"),
      end: new Date("2026-08-20T10:00:00Z"),
    });
    expect(result.status).toBe("invalid");
  });

  it("crea la actividad, la sincroniza con Google y marca synced", async () => {
    const googleClient = makeFakeGoogleClient();
    const result = await createManualActivity(db, () => googleClient, {
      title: "Partido programado",
      activityType: "Partido",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:30:00Z"),
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.status).toBe("programada");
      expect(result.activity.color).toBe("azul");
      expect(result.activity.syncStatus).toBe("synced");
      expect(result.activity.googleEventId).toBe("google-evt-1");
    }
    expect(googleClient.insertEvent).toHaveBeenCalledOnce();
  });

  it("bloquea el guardado cuando hay conflicto y la política es 'block'", async () => {
    const googleClient = makeFakeGoogleClient();
    await createManualActivity(db, () => googleClient, {
      title: "Actividad existente",
      activityType: "Otro",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:00:00Z"),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad conflictiva",
      activityType: "Otro",
      start: new Date("2026-08-20T16:00:00Z"),
      end: new Date("2026-08-20T18:00:00Z"),
    });

    expect(result.status).toBe("conflict");
  });

  it("permite guardar con conflicto si confirmDespiteConflict=true y la política es 'block'", async () => {
    const googleClient = makeFakeGoogleClient();
    await createManualActivity(db, () => googleClient, {
      title: "Actividad existente",
      activityType: "Otro",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:00:00Z"),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad conflictiva confirmada",
      activityType: "Otro",
      start: new Date("2026-08-20T16:00:00Z"),
      end: new Date("2026-08-20T18:00:00Z"),
      confirmDespiteConflict: true,
    });

    expect(result.status).toBe("created");
  });

  it("advierte pero permite guardar cuando hay conflicto y la política es 'warn'", async () => {
    const googleClient = makeFakeGoogleClient();
    await upsertAppConfig(db, { conflictPolicy: "warn" });

    await createManualActivity(db, () => googleClient, {
      title: "Actividad existente",
      activityType: "Otro",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:00:00Z"),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad conflictiva con warn",
      activityType: "Otro",
      start: new Date("2026-08-20T16:00:00Z"),
      end: new Date("2026-08-20T18:00:00Z"),
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.warning).toBeTruthy();
      expect(result.warning).toContain("superpone");
    }
  });

  it("no incluye warning cuando no hay conflicto (caso feliz)", async () => {
    const googleClient = makeFakeGoogleClient();
    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad sin conflicto",
      activityType: "Otro",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:00:00Z"),
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.warning).toBeUndefined();
    }
  });

  it("marca sync_status=error cuando falla la llamada a Google, sin perder la actividad", async () => {
    const googleClient = makeFakeGoogleClient({
      insertEvent: vi.fn().mockRejectedValue(new Error("Google API unavailable")),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad con falla de sync",
      activityType: "Otro",
      start: new Date("2026-08-22T10:00:00Z"),
      end: new Date("2026-08-22T11:00:00Z"),
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.syncStatus).toBe("error");
      expect(result.activity.syncErrorMessage).toContain("Google API unavailable");
    }
  });
});
