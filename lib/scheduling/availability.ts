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
  notBefore?: Date;
}

function dayDateString(day: Date): string {
  return day.toISOString().slice(0, 10); // "YYYY-MM-DD" — day siempre se pasa a medianoche UTC del día deseado
}

/**
 * Convierte los límites de horario laboral ("HH:mm") de un día dado a instantes
 * UTC reales, interpretándolos en la timezone indicada.
 */
function workHoursBoundsForDay(dateStr: string, workHours: WorkHours, timezone: string): TimeRange {
  const workStart = fromZonedTime(`${dateStr}T${workHours.start}:00`, timezone);
  const workEnd = fromZonedTime(`${dateStr}T${workHours.end}:00`, timezone);
  return { start: workStart, end: workEnd };
}

/**
 * Determina si TODO el rango (start y end) cae dentro del horario laboral del
 * día en que comienza `range.start`, en la timezone indicada.
 */
export function isWithinWorkHours(range: TimeRange, workHours: WorkHours, timezone: string): boolean {
  const dateStr = dayDateString(range.start);
  const { start: workStart, end: workEnd } = workHoursBoundsForDay(dateStr, workHours, timezone);

  return (
    !isBefore(range.start, workStart) &&
    !isBefore(workEnd, range.start) &&
    !isBefore(range.end, workStart) &&
    !isBefore(workEnd, range.end)
  );
}

export function computeAvailableSlots(params: ComputeAvailableSlotsParams): TimeRange[] {
  const { day, workHours, timezone, existing, slotDurationMinutes, notBefore } = params;
  const dateStr = dayDateString(day);

  const { start: workStart, end: workEnd } = workHoursBoundsForDay(dateStr, workHours, timezone);

  const slots: TimeRange[] = [];
  let cursor = workStart;

  while (isBefore(cursor, workEnd)) {
    const slotEnd = addMinutes(cursor, slotDurationMinutes);
    if (slotEnd > workEnd) break;

    const candidate: TimeRange = { start: cursor, end: slotEnd };
    const isPast = notBefore ? !isBefore(notBefore, candidate.start) : false;
    const isFree = !existing.some((range) => hasOverlap(candidate, range));
    if (isFree && !isPast) {
      slots.push(candidate);
    }

    cursor = slotEnd;
  }

  return slots;
}
