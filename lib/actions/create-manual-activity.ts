import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity, findConflicts, updateActivitySyncStatus } from "@/lib/db/repositories/activities";
import { validateTimeRange } from "@/lib/scheduling/validate-range";
import { colorForStatus } from "@/lib/scheduling/color";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export interface CreateManualActivityInput {
  title: string;
  activityType: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  confirmDespiteConflict?: boolean;
}

export type CreateManualActivityResult =
  | { status: "created"; activity: Activity; warning?: string }
  | { status: "conflict"; conflicts: Activity[] }
  | { status: "invalid"; reason: string };

export async function createManualActivity(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  input: CreateManualActivityInput
): Promise<CreateManualActivityResult> {
  const rangeValidation = validateTimeRange({ start: input.start, end: input.end });
  if (!rangeValidation.valid) {
    return { status: "invalid", reason: rangeValidation.reason };
  }

  const config = await getAppConfig(db);
  const conflicts = await findConflicts(db, { start: input.start, end: input.end });

  let warning: string | undefined;
  if (conflicts.length > 0) {
    const policy = config?.conflictPolicy ?? "block";
    if (policy === "block" && !input.confirmDespiteConflict) {
      return { status: "conflict", conflicts };
    }
    if (policy === "warn") {
      warning = "El horario elegido se superpone con otra actividad.";
    }
  }

  const status = "programada" as const;
  const activity = await createActivity(db, {
    source: "manual",
    title: input.title,
    activityType: input.activityType,
    status,
    color: colorForStatus(status),
    startDatetime: input.start,
    endDatetime: input.end,
    description: input.description,
    location: input.location,
    createdBy: "admin",
    syncStatus: "pending",
  });

  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: "No hay Calendar ID o token de Google configurado",
    });
    return { status: "created", activity: updated, warning };
  }

  try {
    const googleClient = googleClientFactory({
      calendarId: config.googleCalendarId,
      refreshToken: decryptToken(config.googleRefreshToken),
    });
    const { googleEventId } = await googleClient.insertEvent({
      title: activity.title,
      description: activity.description ?? undefined,
      location: activity.location ?? undefined,
      start: activity.startDatetime,
      end: activity.endDatetime,
      timezone: config.timezone,
    });
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "synced",
      googleEventId,
      remindersConfigured: true,
    });
    return { status: "created", activity: updated, warning };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: message,
    });
    return { status: "created", activity: updated, warning };
  }
}
