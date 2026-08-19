import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity } from "@/lib/db/repositories/activities";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { retrySyncActivity } from "./retry-sync-activity";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  await upsertAppConfig(db, {
    googleCalendarId: "primary",
    googleRefreshToken: encryptToken("refresh-token"),
    timezone: "America/Santiago",
  });
});

describe("retrySyncActivity", () => {
  it("reintenta sincronizar una actividad con sync_status=error y la marca synced si Google responde bien", async () => {
    const activity = await createActivity(db, {
      source: "manual",
      title: "Actividad con error",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-22T10:00:00Z"),
      endDatetime: new Date("2026-08-22T11:00:00Z"),
      createdBy: "admin",
      syncStatus: "error",
      syncErrorMessage: "fallo previo",
    });

    const googleClient: GoogleCalendarClient = {
      insertEvent: vi.fn().mockResolvedValue({ googleEventId: "google-evt-retry" }),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      listEvents: vi.fn(),
    };

    const updated = await retrySyncActivity(db, () => googleClient, activity);

    expect(updated.syncStatus).toBe("synced");
    expect(updated.googleEventId).toBe("google-evt-retry");
  });
});
