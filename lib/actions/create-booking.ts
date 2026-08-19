import { randomUUID } from "node:crypto";
import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity, findConflicts, updateActivitySyncStatus } from "@/lib/db/repositories/activities";
import { validateTimeRange } from "@/lib/scheduling/validate-range";
import { isWithinWorkHours } from "@/lib/scheduling/availability";
import { colorForStatus } from "@/lib/scheduling/color";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { sendBookingConfirmationEmail } from "@/lib/email/resend-client";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { ResendLike } from "@/lib/email/resend-client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export interface CreateBookingInput {
  title: string;
  activityType: string;
  start: Date;
  end: Date;
  bookerName: string;
  bookerEmail: string;
}

export type CreateBookingResult =
  | { status: "created"; activity: Activity }
  | { status: "conflict"; conflicts: Activity[] }
  | { status: "invalid"; reason: string };

export async function createBooking(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  resendClient: ResendLike,
  buildManageUrl: (token: string) => string,
  input: CreateBookingInput
): Promise<CreateBookingResult> {
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

  const conflicts = await findConflicts(db, { start: input.start, end: input.end });
  if (conflicts.length > 0) {
    return { status: "conflict", conflicts };
  }

  const status = "programada" as const;
  const bookingToken = randomUUID();
  const activity = await createActivity(db, {
    source: "manual",
    title: input.title,
    activityType: input.activityType,
    status,
    color: colorForStatus(status),
    startDatetime: input.start,
    endDatetime: input.end,
    createdBy: "public",
    syncStatus: "pending",
    bookingToken,
    bookerName: input.bookerName,
    bookerEmail: input.bookerEmail,
  });

  let finalActivity = activity;

  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    finalActivity = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: "No hay Calendar ID o token de Google configurado",
    });
  } else {
    try {
      const googleClient = googleClientFactory({
        calendarId: config.googleCalendarId,
        refreshToken: decryptToken(config.googleRefreshToken),
      });
      const { googleEventId } = await googleClient.insertEvent({
        title: activity.title,
        start: activity.startDatetime,
        end: activity.endDatetime,
        timezone: config.timezone,
      });
      finalActivity = await updateActivitySyncStatus(db, activity.id, {
        syncStatus: "synced",
        googleEventId,
        remindersConfigured: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
      finalActivity = await updateActivitySyncStatus(db, activity.id, {
        syncStatus: "error",
        syncErrorMessage: message,
      });
    }
  }

  try {
    await sendBookingConfirmationEmail(resendClient, {
      to: input.bookerEmail,
      bookerName: input.bookerName,
      manageUrl: buildManageUrl(bookingToken),
      activityTitle: input.title,
      start: input.start,
      end: input.end,
      timezone: config?.timezone ?? "America/Santiago",
    });
  } catch {
    // El email es best-effort: la reserva ya quedó creada y sincronizada:
    // no revertir la actividad si Resend falla.
  }

  return { status: "created", activity: finalActivity };
}
