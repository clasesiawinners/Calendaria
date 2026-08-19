// e2e/reservar.spec.ts
import { test, expect } from "@playwright/test";
import { createTestDb, truncateAll } from "../lib/db/test-client";
import { upsertAppConfig } from "../lib/db/repositories/app-config";
import { createActivity } from "../lib/db/repositories/activities";

const db = createTestDb();

test.beforeEach(async () => {
  await truncateAll(db);
  await upsertAppConfig(db, {
    workHoursStart: "08:00",
    workHoursEnd: "19:00",
    timezone: "America/Santiago",
    conflictPolicy: "block",
  });
});

test("flujo feliz: reservar un slot disponible desde /reservar", async ({ page }) => {
  await page.goto("/reservar");
  await expect(page.getByRole("heading", { name: "Horarios disponibles" })).toBeVisible();

  const firstSlotLink = page.locator("a[href*='/reservar?start=']").first();
  await firstSlotLink.click();

  await expect(page.getByRole("heading", { name: "Confirma tu reserva" })).toBeVisible();
  await page.getByPlaceholder("Nombre").fill("Ana Pérez");
  await page.getByPlaceholder("Correo electrónico").fill("ana@example.com");
  await page.getByPlaceholder("Motivo de la reserva").fill("Reserva de prueba");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();

  await expect(page).toHaveURL(/\/reservar\/confirmacion\?token=/);
  await expect(page.getByRole("heading", { name: "¡Reserva confirmada!" })).toBeVisible();
});

test("flujo de conflicto: dos personas reservan el mismo slot, la segunda es bloqueada", async ({ page }) => {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(day);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(day);
  end.setUTCHours(15, 0, 0, 0);

  await createActivity(db, {
    source: "manual",
    title: "Ya reservado",
    activityType: "Otro",
    status: "programada",
    color: "azul",
    startDatetime: start,
    endDatetime: end,
    createdBy: "public",
    syncStatus: "error",
  });

  const startISO = encodeURIComponent(start.toISOString());
  const endISO = encodeURIComponent(end.toISOString());
  await page.goto(`/reservar?start=${startISO}&end=${endISO}`);

  await page.getByPlaceholder("Nombre").fill("Otro Cliente");
  await page.getByPlaceholder("Correo electrónico").fill("otro@example.com");
  await page.getByPlaceholder("Motivo de la reserva").fill("Intento conflictivo");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();

  await expect(page.getByText("Ese horario ya no está disponible")).toBeVisible();
});
