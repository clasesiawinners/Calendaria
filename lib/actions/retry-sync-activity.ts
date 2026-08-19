import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { updateActivitySyncStatus } from "@/lib/db/repositories/activities";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export async function retrySyncActivity(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  activity: Activity
): Promise<Activity> {
  const config = await getAppConfig(db);

  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    return updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: "No hay Calendar ID o token de Google configurado",
    });
  }

  try {
    const googleClient = googleClientFactory({
      calendarId: config.googleCalendarId,
      refreshToken: decryptToken(config.googleRefreshToken),
    });
    const eventInput = {
      title: activity.title,
      description: activity.description ?? undefined,
      location: activity.location ?? undefined,
      start: activity.startDatetime,
      end: activity.endDatetime,
      timezone: config.timezone,
    };

    let googleEventId: string;
    if (activity.googleEventId) {
      await googleClient.updateEvent(activity.googleEventId, eventInput);
      googleEventId = activity.googleEventId;
    } else {
      const result = await googleClient.insertEvent(eventInput);
      googleEventId = result.googleEventId;
    }

    return updateActivitySyncStatus(db, activity.id, {
      syncStatus: "synced",
      googleEventId,
      remindersConfigured: true,
      syncErrorMessage: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
    return updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: message,
    });
  }
}
