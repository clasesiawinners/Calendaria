import type { db as dbType } from "@/lib/db/client";
import { getAppConfig, upsertAppConfig } from "@/lib/db/repositories/app-config";
import { upsertActivityByGoogleEventId, softDeleteActivity } from "@/lib/db/repositories/activities";
import { activities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { colorForStatus } from "@/lib/scheduling/color";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export interface SyncFromGoogleResult {
  created: number;
  updated: number;
  deleted: number;
}

export async function syncFromGoogle(
  db: Db,
  googleClientFactory: GoogleClientFactory
): Promise<SyncFromGoogleResult> {
  const config = await getAppConfig(db);
  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    return { created: 0, updated: 0, deleted: 0 };
  }

  const googleClient = googleClientFactory({
    calendarId: config.googleCalendarId,
    refreshToken: decryptToken(config.googleRefreshToken),
  });

  let listResult: { events: Awaited<ReturnType<GoogleCalendarClient["listEvents"]>>["events"]; nextSyncToken: string };
  try {
    listResult = await googleClient.listEvents(config.googleSyncToken ?? undefined);
  } catch (error) {
    const is410 = (error as { code?: number })?.code === 410;
    if (!is410) throw error;
    // syncToken expirado: carga completa sin syncToken y se reinicia el token (spec §7)
    listResult = await googleClient.listEvents(undefined);
  }
  const { events, nextSyncToken } = listResult;

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const event of events) {
    if (event.status === "cancelled") {
      const [existing] = await db.select().from(activities).where(eq(activities.googleEventId, event.id)).limit(1);
      if (existing) {
        await softDeleteActivity(db, existing.id);
        deleted += 1;
      }
      continue;
    }

    if (!event.start?.dateTime || !event.end?.dateTime) {
      continue;
    }

    const [existingBefore] = await db.select().from(activities).where(eq(activities.googleEventId, event.id)).limit(1);
    const status = "externa" as const;

    await upsertActivityByGoogleEventId(db, event.id, {
      source: "google_calendar",
      title: event.summary ?? "(Sin título)",
      activityType: "Evento de Google Calendar",
      status,
      color: colorForStatus(status),
      startDatetime: new Date(event.start.dateTime),
      endDatetime: new Date(event.end.dateTime),
      description: event.description,
      location: event.location,
      createdBy: "admin",
      syncStatus: "synced",
    });

    if (existingBefore) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  await upsertAppConfig(db, { googleSyncToken: nextSyncToken });

  return { created, updated, deleted };
}
