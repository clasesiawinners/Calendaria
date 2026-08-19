"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db/client";
import { createBitacoraActivity } from "@/lib/actions/create-bitacora-activity";

export interface SubmitBitacoraState {
  status: "idle" | "created" | "duplicate";
}

export async function submitBitacoraActivity(
  _prevState: SubmitBitacoraState,
  formData: FormData
): Promise<SubmitBitacoraState> {
  const session = await auth();
  if (!session) {
    throw new Error("No autorizado");
  }

  const title = String(formData.get("title") ?? "");
  const activityType = String(formData.get("activityType") ?? "");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));
  const externalId = String(formData.get("externalId") || randomUUID());

  const result = await createBitacoraActivity(db, {
    title,
    activityType,
    start,
    end,
    externalId,
  });

  revalidatePath("/panel/calendario");
  return { status: result.status };
}
