import type { db as dbType } from "@/lib/db/client";
import { createActivity, getActivityByExternalId } from "@/lib/db/repositories/activities";
import { colorForStatus } from "@/lib/scheduling/color";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;

export interface CreateBitacoraActivityInput {
  title: string;
  activityType: string;
  start: Date;
  end: Date;
  externalId: string;
  description?: string;
}

export type CreateBitacoraActivityResult =
  | { status: "created"; activity: Activity }
  | { status: "duplicate"; activity: Activity };

export async function createBitacoraActivity(
  db: Db,
  input: CreateBitacoraActivityInput
): Promise<CreateBitacoraActivityResult> {
  const existing = await getActivityByExternalId(db, input.externalId);
  if (existing) {
    return { status: "duplicate", activity: existing };
  }

  const status = "ejecutada" as const;
  const activity = await createActivity(db, {
    source: "bitacora",
    externalId: input.externalId,
    title: input.title,
    activityType: input.activityType,
    status,
    color: colorForStatus(status),
    startDatetime: input.start,
    endDatetime: input.end,
    description: input.description,
    createdBy: "bitacora",
    syncStatus: "synced",
  });

  return { status: "created", activity };
}
