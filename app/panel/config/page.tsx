import { connection } from "next/server";
import { db } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { submitAppConfig } from "@/app/actions/app-config";
import { signIn } from "@/auth";

export default async function ConfigPage() {
  await connection();
  const config = await getAppConfig(db);
  const isConnected = Boolean(config?.googleRefreshToken);

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold">Configuración</h1>

      <div className="rounded border p-4">
        <p className="mb-2 text-sm font-medium">Conexión con Google Calendar</p>
        {isConnected ? (
          <p className="text-sm text-green-700">Conectado</p>
        ) : (
          <div>
            <p className="mb-2 text-sm text-red-700">Requiere reconexión</p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/panel/config" });
              }}
            >
              <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">
                Reconectar con Google
              </button>
            </form>
          </div>
        )}
      </div>

      <form action={submitAppConfig} className="space-y-3">
        <label className="block text-sm">Horario laboral - inicio</label>
        <input
          name="workHoursStart"
          defaultValue={config?.workHoursStart ?? "08:00"}
          className="w-full rounded border p-2"
        />
        <label className="block text-sm">Horario laboral - término</label>
        <input
          name="workHoursEnd"
          defaultValue={config?.workHoursEnd ?? "19:00"}
          className="w-full rounded border p-2"
        />
        <label className="block text-sm">Política de conflicto</label>
        <select name="conflictPolicy" defaultValue={config?.conflictPolicy ?? "block"} className="w-full rounded border p-2">
          <option value="block">Bloquear superposiciones</option>
          <option value="warn">Advertir y permitir confirmación</option>
        </select>
        <label className="block text-sm">Calendar ID de Google</label>
        <input
          name="googleCalendarId"
          defaultValue={config?.googleCalendarId ?? ""}
          placeholder="ej. tu-correo@gmail.com o ID del calendario"
          className="w-full rounded border p-2"
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Guardar configuración
        </button>
      </form>
    </div>
  );
}
