"use client";

import { useActionState, useState } from "react";
import { submitManualActivity, type SubmitManualActivityState } from "@/app/actions/manual-activity";

const initialState: SubmitManualActivityState = { status: "idle" };

export function NewActivityModal() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(submitManualActivity, initialState);

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Nueva actividad
      </button>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Nueva actividad</h2>
            <form action={formAction} className="space-y-3">
              <input name="title" placeholder="Título" required className="w-full rounded border p-2" />
              <input
                name="activityType"
                placeholder="Tipo de actividad (o escribe 'Otro')"
                required
                className="w-full rounded border p-2"
              />
              <label className="block text-sm">Inicio</label>
              <input name="start" type="datetime-local" required className="w-full rounded border p-2" />
              <label className="block text-sm">Término</label>
              <input name="end" type="datetime-local" required className="w-full rounded border p-2" />
              <textarea name="description" placeholder="Descripción" className="w-full rounded border p-2" />
              <input name="location" placeholder="Ubicación (opcional)" className="w-full rounded border p-2" />

              {state.status === "conflict" && (
                <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">
                  {state.message}
                  <input type="hidden" name="confirmDespiteConflict" value="true" />
                </div>
              )}
              {state.status === "invalid" && (
                <div className="rounded bg-red-100 p-2 text-sm text-red-800">{state.message}</div>
              )}
              {state.status === "created" && state.warning && (
                <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">{state.warning}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm">
                  Cancelar
                </button>
                <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
                  {state.status === "conflict" ? "Guardar de todos modos" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
