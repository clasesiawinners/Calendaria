"use client";

import { useActionState } from "react";
import { submitBitacoraActivity, type SubmitBitacoraState } from "@/app/actions/bitacora-activity";

const initialState: SubmitBitacoraState = { status: "idle" };

export default function BitacoraPage() {
  const [state, formAction] = useActionState(submitBitacoraActivity, initialState);

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Registrar actividad de Bitácora</h1>
      <form action={formAction} className="space-y-3">
        <input name="title" placeholder="Título (ej. Corte de pasto)" required className="w-full rounded border p-2" />
        <input name="activityType" placeholder="Tipo (ej. Mantenimiento)" required className="w-full rounded border p-2" />
        <label className="block text-sm">Inicio</label>
        <input name="start" type="datetime-local" required className="w-full rounded border p-2" />
        <label className="block text-sm">Término</label>
        <input name="end" type="datetime-local" required className="w-full rounded border p-2" />
        <input name="externalId" placeholder="ID único (opcional, se genera si se deja vacío)" className="w-full rounded border p-2" />

        {state.status === "duplicate" && (
          <div className="rounded bg-yellow-100 p-2 text-sm text-yellow-800">
            Ya existía un registro con ese ID; no se creó un duplicado.
          </div>
        )}
        {state.status === "created" && (
          <div className="rounded bg-green-100 p-2 text-sm text-green-800">Actividad registrada.</div>
        )}

        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Registrar
        </button>
      </form>
    </div>
  );
}
