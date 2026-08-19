import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, truncateAll } from "../test-client";
import {
  createActivity,
  listActivitiesInRange,
  findConflicts,
  updateActivitySyncStatus,
  softDeleteActivity,
  getActivityByExternalId,
  upsertActivityByGoogleEventId,
} from "./activities";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

function makeActivity(overrides: Partial<Parameters<typeof createActivity>[1]> = {}) {
  return {
    source: "manual" as const,
    title: "Partido programado",
    activityType: "Partido",
    status: "programada" as const,
    color: "azul",
    startDatetime: new Date("2026-08-20T15:00:00Z"),
    endDatetime: new Date("2026-08-20T17:30:00Z"),
    createdBy: "admin" as const,
    ...overrides,
  };
}

describe("activities repository", () => {
  it("crea una actividad y la retorna con id generado", async () => {
    const activity = await createActivity(db, makeActivity());
    expect(activity.id).toBeDefined();
    expect(activity.title).toBe("Partido programado");
    expect(activity.syncStatus).toBe("pending");
  });

  it("lista actividades dentro de un rango, excluyendo eliminadas", async () => {
    const inRange = await createActivity(db, makeActivity());
    const outOfRange = await createActivity(
      db,
      makeActivity({
        startDatetime: new Date("2026-09-01T10:00:00Z"),
        endDatetime: new Date("2026-09-01T11:00:00Z"),
      })
    );
    const deleted = await createActivity(db, makeActivity({ title: "Eliminada" }));
    await softDeleteActivity(db, deleted.id);

    const results = await listActivitiesInRange(db, {
      start: new Date("2026-08-20T00:00:00Z"),
      end: new Date("2026-08-21T00:00:00Z"),
    });

    const ids = results.map((a) => a.id);
    expect(ids).toContain(inRange.id);
    expect(ids).not.toContain(outOfRange.id);
    expect(ids).not.toContain(deleted.id);
  });

  it("encuentra actividades en conflicto con un rango candidato", async () => {
    const existing = await createActivity(db, makeActivity());
    const conflicts = await findConflicts(db, {
      start: new Date("2026-08-20T16:00:00Z"),
      end: new Date("2026-08-20T18:00:00Z"),
    });
    expect(conflicts.map((a) => a.id)).toContain(existing.id);
  });

  it("no reporta conflicto para un rango libre", async () => {
    await createActivity(db, makeActivity());
    const conflicts = await findConflicts(db, {
      start: new Date("2026-08-21T09:00:00Z"),
      end: new Date("2026-08-21T10:00:00Z"),
    });
    expect(conflicts).toHaveLength(0);
  });

  it("actualiza el estado de sincronización de una actividad", async () => {
    const activity = await createActivity(db, makeActivity());
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "synced",
      googleEventId: "google-evt-123",
      remindersConfigured: true,
    });
    expect(updated.syncStatus).toBe("synced");
    expect(updated.googleEventId).toBe("google-evt-123");
    expect(updated.remindersConfigured).toBe(true);
  });

  it("marca una actividad como eliminada (soft delete)", async () => {
    const activity = await createActivity(db, makeActivity());
    await softDeleteActivity(db, activity.id);
    const results = await listActivitiesInRange(db, {
      start: new Date("2026-08-20T00:00:00Z"),
      end: new Date("2026-08-21T00:00:00Z"),
    });
    expect(results.map((a) => a.id)).not.toContain(activity.id);
  });

  it("busca una actividad por external_id", async () => {
    await createActivity(db, makeActivity({ source: "bitacora", externalId: "bitacora-001", createdBy: "bitacora" }));
    const found = await getActivityByExternalId(db, "bitacora-001");
    expect(found?.externalId).toBe("bitacora-001");
  });

  it("retorna null si no existe el external_id", async () => {
    const found = await getActivityByExternalId(db, "no-existe");
    expect(found).toBeNull();
  });

  it("upsertActivityByGoogleEventId crea si no existe y actualiza si ya existe", async () => {
    const created = await upsertActivityByGoogleEventId(db, "google-evt-x", {
      ...makeActivity({ source: "google_calendar", status: "externa", color: "plomo" }),
      title: "Reunión externa",
    });
    expect(created.title).toBe("Reunión externa");

    const updated = await upsertActivityByGoogleEventId(db, "google-evt-x", {
      ...makeActivity({ source: "google_calendar", status: "externa", color: "plomo" }),
      title: "Reunión externa (reprogramada)",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Reunión externa (reprogramada)");
  });
});
