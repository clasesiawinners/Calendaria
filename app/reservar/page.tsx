import { db } from "@/lib/db/client";
import { getWeeklyAvailability } from "@/lib/db/repositories/booking";
import { BookingForm } from "./booking-form";

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const params = await searchParams;
  const availability = await getWeeklyAvailability(db, {
    from: new Date(),
    days: 7,
    slotDurationMinutes: 60,
  });

  if (params.start && params.end) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-xl font-semibold">Confirma tu reserva</h1>
        <BookingForm start={params.start} end={params.end} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Horarios disponibles</h1>
      <div className="space-y-6">
        {availability.map(({ day, slots }) => (
          <section key={day.toISOString()}>
            <h2 className="mb-2 font-medium">
              {day.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}
            </h2>
            {slots.length === 0 ? (
              <p className="text-sm text-gray-500">Sin horarios disponibles</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <a
                    key={slot.start.toISOString()}
                    href={`/reservar?start=${encodeURIComponent(slot.start.toISOString())}&end=${encodeURIComponent(slot.end.toISOString())}`}
                    className="rounded border px-3 py-1 text-sm hover:bg-blue-50"
                  >
                    {slot.start.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                  </a>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
