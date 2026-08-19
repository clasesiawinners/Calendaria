import { and, eq, isNull } from "drizzle-orm";
import type { db as dbType } from "../client";
import { activities, type Activity } from "../schema";
import { getAppConfig } from "./app-config";
import { listActivitiesInRange } from "./activities";
import { computeAvailableSlots } from "@/lib/scheduling/availability";
import { getUpcomingDays } from "@/lib/scheduling/week-window";
import type { TimeRange } from "@/lib/scheduling/overlap";

type Db = typeof dbType;

export interface DayAvailability {
  day: Date;
  slots: TimeRange[];
}

export async function getWeeklyAvailability(
  db: Db,
  params: { from: Date; days: number; slotDurationMinutes: number }
): Promise<DayAvailability[]> {
  const config = await getAppConfig(db);
  const workHours = {
    start: config?.workHoursStart ?? "08:00",
    end: config?.workHoursEnd ?? "19:00",
  };
  const timezone = config?.timezone ?? "America/Santiago";
  const notBefore = new Date();

  const days = getUpcomingDays(params.from, params.days);

  const results: DayAvailability[] = [];
  for (const day of days) {
    const dayEnd = new Date(day);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const existing = await listActivitiesInRange(db, { start: day, end: dayEnd });

    const slots = computeAvailableSlots({
      day,
      workHours,
      timezone,
      existing: existing.map((a) => ({ start: a.startDatetime, end: a.endDatetime })),
      slotDurationMinutes: params.slotDurationMinutes,
      notBefore,
    });

    results.push({ day, slots });
  }

  return results;
}

export async function getActivityByBookingToken(db: Db, token: string): Promise<Activity | null> {
  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.bookingToken, token), isNull(activities.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}
