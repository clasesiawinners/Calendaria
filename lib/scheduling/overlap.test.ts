import { describe, it, expect } from "vitest";
import { hasOverlap, findOverlaps } from "./overlap";

describe("hasOverlap", () => {
  it("detecta solapamiento parcial (b empieza dentro de a)", () => {
    const a = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T12:00:00Z") };
    const b = { start: new Date("2026-08-20T11:00:00Z"), end: new Date("2026-08-20T13:00:00Z") };
    expect(hasOverlap(a, b)).toBe(true);
  });

  it("detecta solapamiento total (b contiene a a)", () => {
    const a = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T11:00:00Z") };
    const b = { start: new Date("2026-08-20T09:00:00Z"), end: new Date("2026-08-20T12:00:00Z") };
    expect(hasOverlap(a, b)).toBe(true);
  });

  it("no detecta solapamiento cuando los rangos son adyacentes (b empieza justo cuando termina a)", () => {
    const a = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T11:00:00Z") };
    const b = { start: new Date("2026-08-20T11:00:00Z"), end: new Date("2026-08-20T12:00:00Z") };
    expect(hasOverlap(a, b)).toBe(false);
  });

  it("no detecta solapamiento cuando los rangos están separados", () => {
    const a = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T11:00:00Z") };
    const b = { start: new Date("2026-08-20T14:00:00Z"), end: new Date("2026-08-20T15:00:00Z") };
    expect(hasOverlap(a, b)).toBe(false);
  });

  it("detecta solapamiento en un evento que atraviesa medianoche", () => {
    const a = { start: new Date("2026-08-20T23:00:00Z"), end: new Date("2026-08-21T01:00:00Z") };
    const b = { start: new Date("2026-08-21T00:30:00Z"), end: new Date("2026-08-21T02:00:00Z") };
    expect(hasOverlap(a, b)).toBe(true);
  });
});

describe("findOverlaps", () => {
  it("retorna solo los rangos existentes que solapan con el candidato", () => {
    const candidate = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T11:00:00Z") };
    const existing = [
      { start: new Date("2026-08-20T09:00:00Z"), end: new Date("2026-08-20T10:30:00Z") }, // solapa
      { start: new Date("2026-08-20T12:00:00Z"), end: new Date("2026-08-20T13:00:00Z") }, // no solapa
    ];
    const result = findOverlaps(candidate, existing);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(existing[0]);
  });

  it("retorna arreglo vacío cuando no hay solapamientos", () => {
    const candidate = { start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T11:00:00Z") };
    const existing = [
      { start: new Date("2026-08-20T12:00:00Z"), end: new Date("2026-08-20T13:00:00Z") },
    ];
    expect(findOverlaps(candidate, existing)).toEqual([]);
  });
});
