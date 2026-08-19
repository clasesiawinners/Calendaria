import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "../test-client";
import { getAppConfig, upsertAppConfig } from "./app-config";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("app-config repository", () => {
  it("retorna null cuando no hay configuración guardada", async () => {
    const config = await getAppConfig(db);
    expect(config).toBeNull();
  });

  it("crea la configuración cuando no existe (upsert inicial)", async () => {
    const config = await upsertAppConfig(db, {
      workHoursStart: "09:00",
      workHoursEnd: "18:00",
      conflictPolicy: "warn",
    });
    expect(config.workHoursStart).toBe("09:00");
    expect(config.workHoursEnd).toBe("18:00");
    expect(config.conflictPolicy).toBe("warn");
  });

  it("actualiza la configuración existente en vez de crear una segunda fila", async () => {
    await upsertAppConfig(db, { workHoursStart: "08:00" });
    await upsertAppConfig(db, { workHoursStart: "10:00" });
    const config = await getAppConfig(db);
    expect(config?.workHoursStart).toBe("10:00");
  });
});
