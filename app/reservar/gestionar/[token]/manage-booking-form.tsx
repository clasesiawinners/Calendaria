"use client";

import { useActionState } from "react";
import { submitReschedule, submitCancel, type ManageBookingState } from "@/app/actions/booking-management";

const initialState: ManageBookingState = { status: "idle" };

export function ManageBookingForm({
  token,
  currentStart,
  currentEnd,
}: {
  token: string;
  currentStart: string;
  currentEnd: string;
}) {
  const [rescheduleState, rescheduleAction] = useActionState(submitReschedule, initialState);
  const [cancelState, cancelAction] = useActionState(submitCancel, initialState);

  return (
    <div className="space-y-6">
      <form action={rescheduleAction} className="space-y-3 rounded border bg-white p-4">
        <h2 className="font-medium">Reprogramar</h2>
        <input type="hidden" name="token" value={token} />
        <label className="block text-sm">Nuevo inicio</label>
        <input
          name="start"
          type="datetime-local"
          defaultValue={currentStart}
          required
          className="w-full rounded border p-2"
        />
        <label className="block text-sm">Nuevo término</label>
        <input
          name="end"
          type="datetime-local"
          defaultValue={currentEnd}
          required
          className="w-full rounded border p-2"
        />
        {rescheduleState.status !== "idle" && (
          <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">{rescheduleState.message}</div>
        )}
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Guardar nuevo horario
        </button>
      </form>

      <form action={cancelAction} className="rounded border bg-white p-4">
        <h2 className="mb-3 font-medium">Cancelar reserva</h2>
        <input type="hidden" name="token" value={token} />
        {cancelState.status === "not_found" && (
          <div className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{cancelState.message}</div>
        )}
        <button type="submit" className="rounded bg-red-600 px-4 py-2 text-sm text-white">
          Cancelar mi reserva
        </button>
      </form>
    </div>
  );
}
