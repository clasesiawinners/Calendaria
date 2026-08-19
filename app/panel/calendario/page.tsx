import { connection } from "next/server";
import { db } from "@/lib/db/client";
import { listActivitiesInRange } from "@/lib/db/repositories/activities";
import { toCalendarEvents } from "@/lib/db/repositories/activities-view";
import { CalendarView } from "./calendar-view";
import { NewActivityModal } from "./new-activity-modal";

export default async function CalendarioPage() {
  await connection();
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const activities = await listActivitiesInRange(db, { start: rangeStart, end: rangeEnd });
  const events = toCalendarEvents(activities);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendario</h1>
        <NewActivityModal />
      </div>
      <CalendarView events={events} />
    </div>
  );
}
