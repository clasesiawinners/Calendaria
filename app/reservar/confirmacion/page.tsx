import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getActivityByBookingToken } from "@/lib/db/repositories/booking";

export default async function ConfirmacionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    notFound();
  }

  const activity = await getActivityByBookingToken(db, token);
  if (!activity) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-xl font-semibold">¡Reserva confirmada!</h1>
      <p className="mb-4 text-gray-600">
        {activity.startDatetime.toLocaleString("es-CL")} — {activity.endDatetime.toLocaleTimeString("es-CL")}
      </p>
      <p className="text-sm text-gray-500">
        Te enviamos un correo con el link para gestionar tu reserva. Si no lo ves, revisa spam.
      </p>
      <a
        href={`/reservar/gestionar/${activity.bookingToken}`}
        className="mt-6 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white"
      >
        Gestionar mi reserva
      </a>
    </main>
  );
}
