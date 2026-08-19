"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { createBooking } from "@/lib/actions/create-booking";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";
import { createResendClient } from "@/lib/email/resend-client";

export interface SubmitBookingState {
  status: "idle" | "conflict" | "invalid";
  message?: string;
}

async function buildManageUrl(token: string): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  return `${protocol}://${host}/reservar/gestionar/${token}`;
}

export async function submitBooking(
  _prevState: SubmitBookingState,
  formData: FormData
): Promise<SubmitBookingState> {
  const title = String(formData.get("activityType") ?? "Reserva");
  const activityType = String(formData.get("activityType") ?? "Reserva");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));
  const bookerName = String(formData.get("bookerName") ?? "");
  const bookerEmail = String(formData.get("bookerEmail") ?? "");

  const manageUrl = await buildManageUrl("PLACEHOLDER");

  const result = await createBooking(
    db,
    createGoogleCalendarClient,
    createResendClient(),
    (token) => manageUrl.replace("PLACEHOLDER", token),
    { title, activityType, start, end, bookerName, bookerEmail }
  );

  if (result.status === "created") {
    revalidatePath("/reservar");
    revalidatePath("/panel/calendario");
    redirect(`/reservar/confirmacion?token=${result.activity.bookingToken}`);
  }

  if (result.status === "conflict") {
    return { status: "conflict", message: "Ese horario ya no está disponible. Por favor elige otro." };
  }

  return { status: "invalid", message: result.reason };
}
