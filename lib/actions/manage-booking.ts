import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { findConflicts, softDeleteActivity, updateActivitySchedule } from "@/lib/db/repositories/activities";
import { getActivityByBookingToken } from "@/lib/db/repositories/booking";
import { validateTimeRange } from "@/lib/scheduling/validate-range";
import { isWithinWorkHours } from "@/lib/scheduling/availability";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export type CancelResult = { status: "cancelled" } | { status: "not_found" };

export async function cancelBooking(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  token: string
): Promise<CancelResult> {
  const activity = await getActivityByBookingToken(db, token);
  if (!activity) {
    return { status: "not_found" };
  }

  await softDeleteActivity(db, activity.id);

  const config = await getAppConfig(db);
  if (activity.googleEventId && config?.googleCalendarId && config.googleRefreshToken) {
    try {
      const googleClient = googleClientFactory({
        calendarId: config.googleCalendarId,
        refreshToken: decryptToken(config.googleRefreshToken),
      });
      await googleClient.deleteEvent(activity.googleEventId);
    } catch {
      // La cancelación local ya se aplicó y es la fuente de verdad;
      // un cron de sync futuro reconciliaría el evento en Google.
    }
  }

  return { status: "cancelled" };
}

export type RescheduleResult =
  | { status: "rescheduled"; activity: Activity }
  | { status: "conflict"; conflicts: Activity[] }
  | { status: "invalid"; reason: string }
  | { status: "not_found" };

export async function rescheduleBooking(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  input: { token: string; start: Date; end: Date }
): Promise<RescheduleResult> {
  const activity = await getActivityByBookingToken(db, input.token);
  if (!activity) {
    return { status: "not_found" };
  }

  const rangeValidation = validateTimeRange({ start: input.start, end: input.end });
  if (!rangeValidation.valid) {
    return { status: "invalid", reason: rangeValidation.reason };
  }

  if (input.start < new Date()) {
    return { status: "invalid", reason: "No se puede reservar un horario en el pasado" };
  }

  const config = await getAppConfig(db);
  const workHours = {
    start: config?.workHoursStart ?? "08:00",
    end: config?.workHoursEnd ?? "19:00",
  };
  const timezone = config?.timezone ?? "America/Santiago";

  if (!isWithinWorkHours({ start: input.start, end: input.end }, workHours, timezone)) {
    return { status: "invalid", reason: "El horario elegido está fuera del horario de atención" };
  }

  const allConflicts = await findConflicts(db, { start: input.start, end: input.end });
  const conflicts = allConflicts.filter((c) => c.id !== activity.id);
  if (conflicts.length > 0) {
    return { status: "conflict", conflicts };
  }

  let syncStatus: "synced" | "pending" | "error" = "pending";
  let syncErrorMessage: string | null = null;

  if (activity.googleEventId && config?.googleCalendarId && config.googleRefreshToken) {
    try {
      const googleClient = googleClientFactory({
        calendarId: config.googleCalendarId,
        refreshToken: decryptToken(config.googleRefreshToken),
      });
      await googleClient.updateEvent(activity.googleEventId, {
        title: activity.title,
        start: input.start,
        end: input.end,
        timezone: config.timezone,
      });
      syncStatus = "synced";
    } catch (error) {
      syncStatus = "error";
      syncErrorMessage = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
    }
  } else if (!config?.googleCalendarId || !config.googleRefreshToken) {
    syncStatus = "error";
    syncErrorMessage = "No hay Calendar ID o token de Google configurado";
  } else {
    // La actividad nunca se sincronizó a Google (falló en su creación original);
    // queda pendiente para el próximo reintento manual, sin pisar el mensaje de error real.
    syncStatus = "pending";
    syncErrorMessage = activity.syncErrorMessage ?? null;
  }

  const updated = await updateActivitySchedule(db, activity.id, {
    startDatetime: input.start,
    endDatetime: input.end,
    syncStatus,
    syncErrorMessage,
  });

  return { status: "rescheduled", activity: updated };
}
