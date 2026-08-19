import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { createBitacoraActivity } from "./create-bitacora-activity";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("createBitacoraActivity", () => {
  it("crea una actividad de bitácora con status ejecutada y color verde", async () => {
    const result = await createBitacoraActivity(db, {
      title: "Corte de pasto",
      activityType: "Mantenimiento",
      start: new Date("2026-08-20T08:00:00Z"),
      end: new Date("2026-08-20T09:00:00Z"),
      externalId: "bitacora-001",
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.status).toBe("ejecutada");
      expect(result.activity.color).toBe("verde");
      expect(result.activity.source).toBe("bitacora");
      expect(result.activity.syncStatus).toBe("synced");
    }
  });

  it("no duplica cuando se reenvía el mismo external_id, retorna la existente", async () => {
    await createBitacoraActivity(db, {
      title: "Corte de pasto",
      activityType: "Mantenimiento",
      start: new Date("2026-08-20T08:00:00Z"),
      end: new Date("2026-08-20T09:00:00Z"),
      externalId: "bitacora-001",
    });

    const second = await createBitacoraActivity(db, {
      title: "Corte de pasto (reenvío)",
      activityType: "Mantenimiento",
      start: new Date("2026-08-20T08:00:00Z"),
      end: new Date("2026-08-20T09:00:00Z"),
      externalId: "bitacora-001",
    });

    expect(second.status).toBe("duplicate");
    expect(second.activity.title).toBe("Corte de pasto");
  });
});
