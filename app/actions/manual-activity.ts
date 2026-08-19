"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { createManualActivity } from "@/lib/actions/create-manual-activity";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export interface SubmitManualActivityState {
  status: "idle" | "created" | "conflict" | "invalid";
  message?: string;
  warning?: string;
}

export async function submitManualActivity(
  _prevState: SubmitManualActivityState,
  formData: FormData
): Promise<SubmitManualActivityState> {
  const session = await auth();
  if (!session) {
    throw new Error("No autorizado");
  }

  const title = String(formData.get("title") ?? "");
  const activityType = String(formData.get("activityType") ?? "");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));
  const description = formData.get("description") ? String(formData.get("description")) : undefined;
  const location = formData.get("location") ? String(formData.get("location")) : undefined;
  const confirmDespiteConflict = formData.get("confirmDespiteConflict") === "true";

  const result = await createManualActivity(db, createGoogleCalendarClient, {
    title,
    activityType,
    start,
    end,
    description,
    location,
    confirmDespiteConflict,
  });

  if (result.status === "created") {
    revalidatePath("/panel/calendario");
    return result.warning ? { status: "created", warning: result.warning } : { status: "created" };
  }

  if (result.status === "conflict") {
    return { status: "conflict", message: "El horario elegido se superpone con otra actividad." };
  }

  return { status: "invalid", message: result.reason };
}
