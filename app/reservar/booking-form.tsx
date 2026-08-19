"use client";

import { useActionState } from "react";
import { submitBooking, type SubmitBookingState } from "@/app/actions/booking";

const initialState: SubmitBookingState = { status: "idle" };

export function BookingForm({ start, end }: { start: string; end: string }) {
  const [state, formAction] = useActionState(submitBooking, initialState);

  return (
    <form action={formAction} className="space-y-3 rounded border bg-white p-4 shadow-sm">
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <p className="text-sm text-gray-600">
        {new Date(start).toLocaleString("es-CL")} — {new Date(end).toLocaleTimeString("es-CL")}
      </p>
      <input name="bookerName" placeholder="Nombre" required className="w-full rounded border p-2" />
      <input
        name="bookerEmail"
        type="email"
        placeholder="Correo electrónico"
        required
        className="w-full rounded border p-2"
      />
      <input name="activityType" placeholder="Motivo de la reserva" required className="w-full rounded border p-2" />

      {state.status === "conflict" && (
        <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">{state.message}</div>
      )}
      {state.status === "invalid" && (
        <div className="rounded bg-red-100 p-2 text-sm text-red-800">{state.message}</div>
      )}

      <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
        Confirmar reserva
      </button>
    </form>
  );
}
