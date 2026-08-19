"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { activities } from "@/lib/db/schema";
import { retrySyncActivity } from "@/lib/actions/retry-sync-activity";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export async function retrySync(activityId: string): Promise<void> {
  const session = await auth();
  if (!session) {
    throw new Error("No autorizado");
  }

  const [activity] = await db.select().from(activities).where(eq(activities.id, activityId)).limit(1);
  if (!activity) return;

  await retrySyncActivity(db, createGoogleCalendarClient, activity);
  revalidatePath("/panel/calendario");
}
