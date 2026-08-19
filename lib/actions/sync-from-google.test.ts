import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig, getAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { syncFromGoogle } from "./sync-from-google";
import type { GoogleCalendarClient, GoogleCalendarEvent } from "@/lib/google-calendar/client";

const db = createTestDb();

function makeFakeGoogleClient(events: GoogleCalendarEvent[], nextSyncToken = "token-2"): GoogleCalendarClient {
  return {
    insertEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ events, nextSyncToken }),
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

describe("syncFromGoogle", () => {
  it("crea actividades nuevas provenientes de eventos confirmados de Google", async () => {
    const events: GoogleCalendarEvent[] = [
      {
        id: "google-evt-1",
        status: "confirmed",
        summary: "Reunión externa",
        start: { dateTime: "2026-08-25T10:00:00Z" },
        end: { dateTime: "2026-08-25T11:00:00Z" },
      },
    ];
    const googleClient = makeFakeGoogleClient(events);

    const result = await syncFromGoogle(db, () => googleClient);

    expect(result.created).toBe(1);
  });

  it("marca como eliminadas las actividades cuyo evento en Google tiene status 'cancelled'", async () => {
    const firstPass = makeFakeGoogleClient([
      {
        id: "google-evt-2",
        status: "confirmed",
        summary: "Reunión a cancelar",
        start: { dateTime: "2026-08-26T10:00:00Z" },
        end: { dateTime: "2026-08-26T11:00:00Z" },
      },
    ]);
    await syncFromGoogle(db, () => firstPass);

    const secondPass = makeFakeGoogleClient([
      { id: "google-evt-2", status: "cancelled" },
    ]);
    const result = await syncFromGoogle(db, () => secondPass);

    expect(result.deleted).toBe(1);
  });

  it("guarda el nextSyncToken en app_config tras sincronizar", async () => {
    const googleClient = makeFakeGoogleClient([], "new-sync-token");
    await syncFromGoogle(db, () => googleClient);

    const config = await getAppConfig(db);
    expect(config?.googleSyncToken).toBe("new-sync-token");
  });

  it("cuando el syncToken expiró (error 410), reintenta sin syncToken y reinicia el token guardado", async () => {
    await upsertAppConfig(db, { googleSyncToken: "expired-token" });

    let callCount = 0;
    const googleClient: GoogleCalendarClient = {
      insertEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      listEvents: vi.fn().mockImplementation(async (syncToken?: string) => {
        callCount += 1;
        if (syncToken === "expired-token") {
          const error = new Error("Sync token is no longer valid") as Error & { code?: number };
          error.code = 410;
          throw error;
        }
        return { events: [], nextSyncToken: "fresh-token" };
      }),
    };

    const result = await syncFromGoogle(db, () => googleClient);

    expect(callCount).toBe(2);
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
    const config = await getAppConfig(db);
    expect(config?.googleSyncToken).toBe("fresh-token");
  });
});
