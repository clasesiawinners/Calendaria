import { db } from "@/lib/db/client";
import { listActivitiesInRange } from "@/lib/db/repositories/activities";
import { toCalendarEvents } from "@/lib/db/repositories/activities-view";
import { CalendarView } from "./calendar-view";

export default async function CalendarioPage() {
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const activities = await listActivitiesInRange(db, { start: rangeStart, end: rangeEnd });
  const events = toCalendarEvents(activities);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Calendario</h1>
      <CalendarView events={events} />
    </div>
  );
}
