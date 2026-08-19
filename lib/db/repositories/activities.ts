import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { db as dbType } from "../client";
import { activities, type Activity, type NewActivity } from "../schema";
import type { TimeRange } from "@/lib/scheduling/overlap";

type Db = typeof dbType;

export async function createActivity(db: Db, data: NewActivity): Promise<Activity> {
  const [created] = await db.insert(activities).values(data).returning();
  return created;
}

export async function listActivitiesInRange(db: Db, range: TimeRange): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(
      and(
        isNull(activities.deletedAt),
        lt(activities.startDatetime, range.end),
        gt(activities.endDatetime, range.start)
      )
    );
}

export async function findConflicts(db: Db, range: TimeRange): Promise<Activity[]> {
  return listActivitiesInRange(db, range);
}

export async function updateActivitySyncStatus(
  db: Db,
  id: string,
  patch: {
    syncStatus: "synced" | "pending" | "error";
    syncErrorMessage?: string | null;
    googleEventId?: string | null;
    remindersConfigured?: boolean;
  }
): Promise<Activity> {
  const [updated] = await db
    .update(activities)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();
  return updated;
}

export async function updateActivitySchedule(
  db: Db,
  id: string,
  patch: { startDatetime: Date; endDatetime: Date; syncStatus: "synced" | "pending" | "error"; syncErrorMessage?: string | null }
): Promise<Activity> {
  const [updated] = await db
    .update(activities)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();
  return updated;
}

export async function softDeleteActivity(db: Db, id: string): Promise<void> {
  await db.update(activities).set({ deletedAt: new Date() }).where(eq(activities.id, id));
}

export async function getActivityByExternalId(db: Db, externalId: string): Promise<Activity | null> {
  const rows = await db.select().from(activities).where(eq(activities.externalId, externalId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertActivityByGoogleEventId(
  db: Db,
  googleEventId: string,
  data: Omit<NewActivity, "googleEventId">
): Promise<Activity> {
  const [existing] = await db
    .select()
    .from(activities)
    .where(eq(activities.googleEventId, googleEventId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(activities)
      .set({ ...data, googleEventId, updatedAt: new Date() })
      .where(eq(activities.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(activities)
    .values({ ...data, googleEventId })
    .returning();
  return created;
}
