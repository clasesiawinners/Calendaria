import { describe, it, expect } from "vitest";
import { getUpcomingDays } from "./week-window";

describe("getUpcomingDays", () => {
  it("devuelve N días consecutivos empezando por el día indicado", () => {
    const days = getUpcomingDays(new Date("2026-08-24T00:00:00Z"), 7);

    expect(days).toHaveLength(7);
    expect(days[0].toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(days[6].toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });

  it("normaliza la fecha de entrada a medianoche UTC", () => {
    const days = getUpcomingDays(new Date("2026-08-24T15:37:00Z"), 1);
    expect(days[0].toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });
});
