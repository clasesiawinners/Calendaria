"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { rescheduleBooking, cancelBooking } from "@/lib/actions/manage-booking";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export interface ManageBookingState {
  status: "idle" | "conflict" | "invalid" | "not_found";
  message?: string;
}

export async function submitReschedule(
  _prevState: ManageBookingState,
  formData: FormData
): Promise<ManageBookingState> {
  const token = String(formData.get("token") ?? "");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));

  const result = await rescheduleBooking(db, createGoogleCalendarClient, { token, start, end });

  if (result.status === "rescheduled") {
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

  redirect("/reservar/gestionar/cancelada");
}
