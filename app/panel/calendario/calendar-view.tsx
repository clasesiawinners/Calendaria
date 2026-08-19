"use client";

import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import type { CalendarEvent } from "@/lib/db/repositories/activities-view";
import { retrySync } from "@/app/actions/retry-sync";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: es }),
  getDay,
  locales: { es },
});

const COLOR_HEX: Record<string, string> = {
  verde: "#16a34a",
  azul: "#2563eb",
  naranjo: "#ea580c",
  plomo: "#6b7280",
};

const LEGEND_ITEMS: { label: string; color: string }[] = [
  { label: "Ejecutada", color: "verde" },
  { label: "Programada", color: "azul" },
  { label: "Pendiente", color: "naranjo" },
  { label: "Externa (Google)", color: "plomo" },
];

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const errorEvents = events.filter((event) => event.syncStatus === "error");

  return (
    <div>
      <div className="mb-4 flex gap-4">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: COLOR_HEX[item.color] }}
            />
            {item.label}
          </div>
        ))}
      </div>

      {errorEvents.length > 0 && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3">
          <p className="mb-2 text-sm font-medium text-red-800">
            Actividades con error de sincronización:
          </p>
          <ul className="space-y-2">
            {errorEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between text-sm">
                <span>{event.title}</span>
                <button
                  onClick={() => retrySync(event.id)}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                >
                  Reintentar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ height: 700 }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          eventPropGetter={(event: CalendarEvent) => ({
            style: {
              backgroundColor: COLOR_HEX[event.color] ?? "#6b7280",
              opacity: event.syncStatus === "error" ? 0.6 : 1,
              border: event.syncStatus === "error" ? "2px dashed red" : undefined,
            },
          })}
        />
      </div>
    </div>
  );
}
