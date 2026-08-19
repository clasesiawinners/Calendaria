import { describe, it, expect } from "vitest";
import { validateTimeRange } from "./validate-range";

describe("validateTimeRange", () => {
  it("es válido cuando el fin es posterior al inicio", () => {
    const range = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T11:00:00Z") };
    expect(validateTimeRange(range)).toEqual({ valid: true });
  });

  it("es inválido cuando el fin es igual al inicio", () => {
    const range = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T10:00:00Z") };
    const result = validateTimeRange(range);
    expect(result.valid).toBe(false);
  });

  it("es inválido cuando el fin es anterior al inicio", () => {
    const range = { start: new Date("2026-08-20T11:00:00Z"), end: new Date("2026-08-20T10:00:00Z") };
    const result = validateTimeRange(range);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/posterior/i);
    }
  });
});
