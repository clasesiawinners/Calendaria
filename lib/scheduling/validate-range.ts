import type { TimeRange } from "./overlap";

export type ValidationResult = { valid: true } | { valid: false; reason: string };

export function validateTimeRange(range: TimeRange): ValidationResult {
  if (range.end <= range.start) {
    return { valid: false, reason: "La hora de término debe ser posterior a la hora de inicio" };
  }
  return { valid: true };
}
