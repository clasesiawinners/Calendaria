"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";

export async function submitAppConfig(formData: FormData): Promise<void> {
  await upsertAppConfig(db, {
    workHoursStart: String(formData.get("workHoursStart")),
    workHoursEnd: String(formData.get("workHoursEnd")),
    conflictPolicy: formData.get("conflictPolicy") === "warn" ? "warn" : "block",
    googleCalendarId: String(formData.get("googleCalendarId") || ""),
  });
  revalidatePath("/panel/config");
}
