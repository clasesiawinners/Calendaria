import type { Activity } from "../schema";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
  syncStatus: "synced" | "pending" | "error";
}

export function toCalendarEvents(activities: Activity[]): CalendarEvent[] {
  return activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
    start: activity.startDatetime,
    end: activity.endDatetime,
    color: activity.color,
    syncStatus: activity.syncStatus,
  }));
}
