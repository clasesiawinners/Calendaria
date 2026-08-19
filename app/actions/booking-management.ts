"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db/client";
import { rescheduleBooking, cancelBooking } from "@/lib/actions/manage-booking";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";

export interface ManageBookingState {
  status: "idle" | "conflict" | "invalid" | "not_found";
  message?: string;
}

export async function submitReschedule(
  _prevState: ManageBookingState,
  formData: FormData
): Promise<ManageBookingState> {
  const token = String(formData.get("token") ?? "");
  const config = await getAppConfig(db);
  const timezone = config?.timezone ?? "America/Santiago";
  const start = fromZonedTime(String(formData.get("start")), timezone);
  const end = fromZonedTime(String(formData.get("end")), timezone);

  const result = await rescheduleBooking(db, createGoogleCalendarClient, { token, start, end });

  if (result.status === "rescheduled") {
    revalidatePath("/reservar");
    revalidatePath("/panel/calendario");
    redirect(`/reservar/gestionar/${token}?updated=1`);
  }
  if (result.status === "conflict") {
    return { status: "conflict", message: "Ese horario ya no está disponible. Por favor elige otro." };
  }
  if (result.status === "not_found") {
    return { status: "not_found", message: "No se encontró la reserva." };
  }
  return { status: "invalid", message: result.reason };
}

export async function submitCancel(
  _prevState: ManageBookingState,
  formData: FormData
): Promise<ManageBookingState> {
  const token = String(formData.get("token") ?? "");
  const result = await cancelBooking(db, createGoogleCalendarClient, token);

  if (result.status === "not_found") {
    return { status: "not_found", message: "No se encontró la reserva." };
  }

  revalidatePath("/reservar");
  revalidatePath("/panel/calendario");
  redirect("/reservar/gestionar/cancelada");
}
