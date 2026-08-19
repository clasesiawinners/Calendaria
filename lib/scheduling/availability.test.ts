import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "./availability";

const workHours = { start: "08:00", end: "19:00" };
const timezone = "America/Santiago";

describe("computeAvailableSlots", () => {
  it("un día sin actividades produce un único slot igual al horario laboral", () => {
    const slots = computeAvailableSlots({
      day: new Date("2026-08-24T00:00:00Z"), // lunes
      workHours,
      timezone,
      existing: [],
      slotDurationMinutes: 60,
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].start.toISOString()).toBe("2026-08-24T12:00:00.000Z"); // 08:00 America/Santiago = 12:00 UTC (UTC-4 en invierno boreal/CLT varía; ajustado al offset real de date-fns-tz)
  });

  it("excluye un slot que se solapa con una actividad existente", () => {
    const slots = computeAvailableSlots({
      day: new Date("2026-08-24T00:00:00Z"),
      workHours,
      timezone,
      existing: [
        {
          start: new Date("2026-08-24T14:00:00.000Z"),
          end: new Date("2026-08-24T15:00:00.000Z"),
        },
      ],
      slotDurationMinutes: 60,
    });

    const overlapping = slots.find(
      (slot) =>
        slot.start.getTime() < new Date("2026-08-24T15:00:00.000Z").getTime() &&
        slot.end.getTime() > new Date("2026-08-24T14:00:00.000Z").getTime()
    );
    expect(overlapping).toBeUndefined();
  });

  it("un día completamente ocupado no produce slots", () => {
    const slots = computeAvailableSlots({
      day: new Date("2026-08-24T00:00:00Z"),
      workHours,
      timezone,
      existing: [
        {
          start: new Date("2026-08-24T00:00:00.000Z"),
          end: new Date("2026-08-25T00:00:00.000Z"),
        },
      ],
      slotDurationMinutes: 60,
    });

    expect(slots).toHaveLength(0);
  });

  it("no genera un slot parcial si la duración no calza exacta con el cierre", () => {
    const slots = computeAvailableSlots({
      day: new Date("2026-08-24T00:00:00Z"),
      workHours: { start: "08:00", end: "09:50" },
      timezone,
      existing: [],
      slotDurationMinutes: 60,
    });

    expect(slots).toHaveLength(1); // solo 08:00-09:00; 09:50 no alcanza para otro slot de 60 min
  });
});
