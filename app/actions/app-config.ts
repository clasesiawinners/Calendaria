"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";

export async function submitAppConfig(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) {
    throw new Error("No autorizado");
  }

  const googleCalendarId = String(formData.get("googleCalendarId") || "").trim();

  await upsertAppConfig(db, {
    workHoursStart: String(formData.get("workHoursStart")),
    workHoursEnd: String(formData.get("workHoursEnd")),
    conflictPolicy: formData.get("conflictPolicy") === "warn" ? "warn" : "block",
    googleCalendarId: googleCalendarId || null,
  });
  revalidatePath("/panel/config");
}
