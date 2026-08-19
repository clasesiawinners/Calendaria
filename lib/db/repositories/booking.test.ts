import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity } from "@/lib/db/repositories/activities";
import { getWeeklyAvailability, getActivityByBookingToken } from "./booking";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
  await upsertAppConfig(db, {
    workHoursStart: "08:00",
    workHoursEnd: "10:00",
    timezone: "America/Santiago",
  });
});

describe("getWeeklyAvailability", () => {
  it("devuelve slots libres para cada día de la ventana cuando no hay actividades", async () => {
    const result = await getWeeklyAvailability(db, {
      from: new Date("2026-08-24T00:00:00Z"),
      days: 3,
      slotDurationMinutes: 60,
    });

    expect(result).toHaveLength(3);
    expect(result[0].slots.length).toBeGreaterThan(0);
  });

  it("excluye slots ocupados por una actividad existente de cualquier fuente", async () => {
    await createActivity(db, {
      source: "google_calendar",
      title: "Evento externo",
      activityType: "Otro",
      status: "externa",
      color: "plomo",
      startDatetime: new Date("2026-08-24T11:00:00.000Z"),
      endDatetime: new Date("2026-08-24T12:00:00.000Z"),
      createdBy: "admin",
      syncStatus: "synced",
    });

    const result = await getWeeklyAvailability(db, {
      from: new Date("2026-08-24T00:00:00Z"),
      days: 1,
      slotDurationMinutes: 60,
    });

    const occupiedSlot = result[0].slots.find(
      (slot) => slot.start.toISOString() === "2026-08-24T11:00:00.000Z"
    );
    expect(occupiedSlot).toBeUndefined();
  });

  it("no incluye slots del día de hoy que ya pasaron", async () => {
    const now = new Date();

    const result = await getWeeklyAvailability(db, {
      from: now,
      days: 1,
      slotDurationMinutes: 60,
    });

    const pastSlot = result[0].slots.find((slot) => slot.start.getTime() <= now.getTime());
    expect(pastSlot).toBeUndefined();
  });
});

describe("getActivityByBookingToken", () => {
  it("devuelve null si el token no existe", async () => {
    const result = await getActivityByBookingToken(db, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("devuelve la actividad cuando el token existe y no está eliminada", async () => {
    const created = await createActivity(db, {
      source: "manual",
      title: "Reserva pública",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00.000Z"),
      endDatetime: new Date("2026-08-24T15:00:00.000Z"),
      createdBy: "public",
      syncStatus: "synced",
      bookingToken: "11111111-1111-1111-1111-111111111111",
      bookerEmail: "cliente@example.com",
      bookerName: "Ana",
    });

    const result = await getActivityByBookingToken(db, "11111111-1111-1111-1111-111111111111");
    expect(result?.id).toBe(created.id);
  });
});
