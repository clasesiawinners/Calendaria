import { describe, it, expect } from "vitest";
import { colorForStatus } from "./color";

describe("colorForStatus", () => {
  it("retorna verde para ejecutada", () => {
    expect(colorForStatus("ejecutada")).toBe("verde");
  });
  it("retorna azul para programada", () => {
    expect(colorForStatus("programada")).toBe("azul");
  });
  it("retorna naranjo para pendiente", () => {
    expect(colorForStatus("pendiente")).toBe("naranjo");
  });
  it("retorna plomo para externa", () => {
    expect(colorForStatus("externa")).toBe("plomo");
  });
});
