import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db/client";
import { getActivityByBookingToken } from "@/lib/db/repositories/booking";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { ManageBookingForm } from "./manage-booking-form";

function toDatetimeLocal(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm");
}

export default async function GestionarReservaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const activity = await getActivityByBookingToken(db, token);

  if (!activity) {
    notFound();
  }

  const config = await getAppConfig(db);
  const timezone = config?.timezone ?? "America/Santiago";

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-2 text-xl font-semibold">{activity.title}</h1>
      <p className="mb-6 text-sm text-gray-600">
        Reserva a nombre de {activity.bookerName ?? "—"}
      </p>
      <ManageBookingForm
        token={token}
        currentStart={toDatetimeLocal(activity.startDatetime, timezone)}
        currentEnd={toDatetimeLocal(activity.endDatetime, timezone)}
      />
    </main>
  );
}
