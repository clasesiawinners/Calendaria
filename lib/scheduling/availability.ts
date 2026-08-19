import { fromZonedTime } from "date-fns-tz";
import { addMinutes, isBefore } from "date-fns";
import type { TimeRange } from "./overlap";
import { hasOverlap } from "./overlap";

export interface WorkHours {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface ComputeAvailableSlotsParams {
  day: Date;
  workHours: WorkHours;
  timezone: string;
  existing: TimeRange[];
  slotDurationMinutes: number;
}

function dayDateString(day: Date): string {
  return day.toISOString().slice(0, 10); // "YYYY-MM-DD" — day siempre se pasa a medianoche UTC del día deseado
}

export function computeAvailableSlots(params: ComputeAvailableSlotsParams): TimeRange[] {
  const { day, workHours, timezone, existing, slotDurationMinutes } = params;
  const dateStr = dayDateString(day);

  const workStart = fromZonedTime(`${dateStr}T${workHours.start}:00`, timezone);
  const workEnd = fromZonedTime(`${dateStr}T${workHours.end}:00`, timezone);

  const slots: TimeRange[] = [];
  let cursor = workStart;

  while (isBefore(cursor, workEnd)) {
    const slotEnd = addMinutes(cursor, slotDurationMinutes);
    if (slotEnd > workEnd) break;

    const candidate: TimeRange = { start: cursor, end: slotEnd };
    const isFree = !existing.some((range) => hasOverlap(candidate, range));
    if (isFree) {
      slots.push(candidate);
    }

    cursor = slotEnd;
  }

  return slots;
}
