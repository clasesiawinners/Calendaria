import { describe, it, expect } from "vitest";
import { toCalendarEvents } from "./activities-view";
import type { Activity } from "../schema";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    source: "manual",
    externalId: null,
    title: "Partido programado",
    activityType: "Partido",
    status: "programada",
    color: "azul",
    startDatetime: new Date("2026-08-20T15:00:00Z"),
    endDatetime: new Date("2026-08-20T17:30:00Z"),
    description: null,
    location: null,
    syncStatus: "synced",
    syncErrorMessage: null,
    createdBy: "admin",
    googleEventId: "google-evt-1",
    remindersConfigured: true,
    bookingToken: null,
    bookerName: null,
    bookerEmail: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("toCalendarEvents", () => {
  it("mapea una actividad al formato de evento de calendario", () => {
    const [event] = toCalendarEvents([makeActivity()]);
    expect(event).toEqual({
      id: "act-1",
      title: "Partido programado",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:30:00Z"),
      color: "azul",
      syncStatus: "synced",
    });
  });

  it("mapea múltiples actividades preservando el orden", () => {
    const activities = [
      makeActivity({ id: "act-1" }),
      makeActivity({ id: "act-2", title: "Otra actividad", color: "verde", status: "ejecutada" }),
    ];
    const events = toCalendarEvents(activities);
    expect(events).toHaveLength(2);
    expect(events[1].title).toBe("Otra actividad");
    expect(events[1].color).toBe("verde");
  });
});
