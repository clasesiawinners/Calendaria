# Portal Público de Agendamiento (Plan 2/2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el portal público de agendamiento (`/reservar`), sin login, donde cualquier persona puede ver huecos disponibles según el horario laboral configurado, reservar un slot (creando una actividad sincronizada con Google Calendar), y gestionar (reprogramar o cancelar) su propia reserva vía un link único enviado por correo con Resend.

**Architecture:** Se extiende el mismo proyecto Next.js 15 (App Router) del Plan 1/2, sin nuevos servicios. La lógica de cálculo de huecos disponibles vive en un módulo puro (`lib/scheduling/availability.ts`), testeado de forma aislada como `hasOverlap`/`validateTimeRange` del Plan 1. Las Server Actions de reserva pública y gestión de reserva reutilizan directamente `findConflicts`, `createActivity`, `updateActivitySyncStatus`, `colorForStatus` y el `GoogleCalendarClient` ya construidos — el flujo de creación es el mismo que `createManualActivity`, pero con `created_by=public`, `booking_token` nuevo, y un envío de email posterior vía Resend. La gestión de reserva (reprogramar/cancelar) es una Server Action nueva que valida el `booking_token`, revalida conflicto y llama `updateEvent`/`deleteEvent` de Google.

**Tech Stack:** Next.js 15 (App Router, TypeScript) — mismo proyecto del Plan 1/2. Drizzle ORM + PostgreSQL. `resend` (nueva dependencia) para el email transaccional. `date-fns` / `date-fns-tz` para el cálculo de slots en `America/Santiago`. Vitest para unitarios e integración. Playwright para los 2 flujos E2E de alcance reducido definidos en la spec §9.

**Spec:** `docs/superpowers/specs/2026-08-19-calendario-operacional-design.md`

## Global Constraints

- Zona horaria consistente en todo el sistema: `America/Santiago` (spec §6), leída de `app_config.timezone` — nunca hardcodeada en el portal público.
- Nunca exponer `google_refresh_token` ni credenciales en la interfaz o el código fuente (spec §6); se reutiliza `decryptToken` del Plan 1/2.
- Toda integración con Google opera únicamente sobre el `google_calendar_id` configurado en `app_config` (spec §6).
- La hora de término de una actividad siempre debe ser posterior a la de inicio (spec §6) — se reutiliza `validateTimeRange`.
- El color de una actividad se deriva SIEMPRE de `status`, nunca de `activity_type` (spec §4.1) — se reutiliza `colorForStatus`.
- Antes de guardar cualquier actividad manual o pública, se valida conflicto contra **todas** las fuentes visibles: bitácora, manual, google_calendar (spec §6) — se reutiliza `findConflicts`.
- El portal público NUNCA debe mostrar detalle de la actividad ajena, solo ocupado/libre, por privacidad (spec §5.5.2).
- No hay autenticación de usuario para el público: la gestión de reserva se hace vía `booking_token` (UUID), no usuario/contraseña (spec: "Explícitamente fuera de alcance").
- El sistema revalida el conflicto en el momento de confirmar una reserva o reprogramación, no solo al cargar la página (spec §5.5.4, §5.6.3).
- Package manager: `pnpm` para todos los comandos (`pnpm add`, `pnpm dlx`, etc. — nunca `npm`).

---

## Fase 1 — Cálculo de huecos disponibles (TDD, sin DB)

### Task 1: Módulo puro de cálculo de slots disponibles

**Files:**
- Create: `lib/scheduling/availability.ts`
- Test: `lib/scheduling/availability.test.ts`

**Interfaces:**
- Consumes: `TimeRange` de `lib/scheduling/overlap.ts` (`{ start: Date; end: Date }`), `hasOverlap` de `lib/scheduling/overlap.ts`.
- Produces: `computeAvailableSlots(params: ComputeAvailableSlotsParams): TimeRange[]`, tipo `ComputeAvailableSlotsParams`, tipo `WorkHours`. Usado por Task 4 (repositorio de disponibilidad) y por la Server Action de reserva pública (Task 5).

- [ ] **Step 1: Escribir el test que falla — un día completamente libre produce un único slot igual al horario laboral**

```typescript
// lib/scheduling/availability.test.ts
import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "./availability";

const workHours = { start: "08:00", end: "19:00" };
const timezone = "America/Santiago";

describe("computeAvailableSlots", () => {
  it("un día sin actividades produce un único slot igual al horario laboral", () => {
    const slots = computeAvailableSlots({
      day: new Date("2026-08-24T00:00:00Z"), // lunes
      workHours,
      timezone,
      existing: [],
      slotDurationMinutes: 60,
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].start.toISOString()).toBe("2026-08-24T11:00:00.000Z"); // 08:00 America/Santiago = 11:00 UTC (UTC-3 en verano boreal/CLT varía; ver Step 3 nota)
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm test lib/scheduling/availability.test.ts`
Expected: FAIL con "Cannot find module './availability'" o similar.

- [ ] **Step 3: Implementar `computeAvailableSlots`**

`America/Santiago` es UTC-4 (horario estándar, CLT) o UTC-3 (horario de verano, CLST) según la fecha — usar `date-fns-tz` para la conversión, nunca un offset fijo.

```bash
pnpm add date-fns-tz
```

```typescript
// lib/scheduling/availability.ts
import { fromZonedTime } from "date-fns-tz";
import { addMinutes, isBefore } from "date-fns";
import type { TimeRange } from "./overlap";
import { hasOverlap } from "./overlap";

export interface WorkHours {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface ComputeAvailableSlotsParams {
  day: Date;
  workHours: WorkHours;
  timezone: string;
  existing: TimeRange[];
  slotDurationMinutes: number;
}

function dayDateString(day: Date): string {
  return day.toISOString().slice(0, 10); // "YYYY-MM-DD" — day siempre se pasa a medianoche UTC del día deseado
}

export function computeAvailableSlots(params: ComputeAvailableSlotsParams): TimeRange[] {
  const { day, workHours, timezone, existing, slotDurationMinutes } = params;
  const dateStr = dayDateString(day);

  const workStart = fromZonedTime(`${dateStr}T${workHours.start}:00`, timezone);
  const workEnd = fromZonedTime(`${dateStr}T${workHours.end}:00`, timezone);

  const slots: TimeRange[] = [];
  let cursor = workStart;

  while (isBefore(cursor, workEnd)) {
    const slotEnd = addMinutes(cursor, slotDurationMinutes);
    if (slotEnd > workEnd) break;

    const candidate: TimeRange = { start: cursor, end: slotEnd };
    const isFree = !existing.some((range) => hasOverlap(candidate, range));
    if (isFree) {
      slots.push(candidate);
    }

    cursor = slotEnd;
  }

  return slots;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm test lib/scheduling/availability.test.ts`
Expected: PASS. Si el offset UTC del assert no coincide (Chile cambió reglas de horario de verano varias veces), ajustar el string ISO esperado al offset real que devuelva `date-fns-tz` para esa fecha — lo importante es que el test quede determinístico y en verde, no el valor literal.

- [ ] **Step 5: Agregar test — slot ocupado por una actividad existente se excluye**

```typescript
it("excluye un slot que se solapa con una actividad existente", () => {
  const slots = computeAvailableSlots({
    day: new Date("2026-08-24T00:00:00Z"),
    workHours,
    timezone,
    existing: [
      {
        start: new Date("2026-08-24T14:00:00.000Z"),
        end: new Date("2026-08-24T15:00:00.000Z"),
      },
    ],
    slotDurationMinutes: 60,
  });

  const overlapping = slots.find(
    (slot) =>
      slot.start.getTime() < new Date("2026-08-24T15:00:00.000Z").getTime() &&
      slot.end.getTime() > new Date("2026-08-24T14:00:00.000Z").getTime()
  );
  expect(overlapping).toBeUndefined();
});
```

Run: `pnpm test lib/scheduling/availability.test.ts`
Expected: PASS (el algoritmo del Step 3 ya cubre este caso; si falla, revisar que `hasOverlap` se está llamando con los argumentos en el orden correcto).

- [ ] **Step 6: Agregar test — actividad que cubre todo el horario laboral produce cero slots**

```typescript
it("un día completamente ocupado no produce slots", () => {
  const slots = computeAvailableSlots({
    day: new Date("2026-08-24T00:00:00Z"),
    workHours,
    timezone,
    existing: [
      {
        start: new Date("2026-08-24T00:00:00.000Z"),
        end: new Date("2026-08-25T00:00:00.000Z"),
      },
    ],
    slotDurationMinutes: 60,
  });

  expect(slots).toHaveLength(0);
});
```

Run: `pnpm test lib/scheduling/availability.test.ts`
Expected: PASS.

- [ ] **Step 7: Agregar test — `slotDurationMinutes` que no divide exacto el horario laboral no genera un slot parcial al final**

```typescript
it("no genera un slot parcial si la duración no calza exacta con el cierre", () => {
  const slots = computeAvailableSlots({
    day: new Date("2026-08-24T00:00:00Z"),
    workHours: { start: "08:00", end: "09:50" },
    timezone,
    existing: [],
    slotDurationMinutes: 60,
  });

  expect(slots).toHaveLength(1); // solo 08:00-09:00; 09:50 no alcanza para otro slot de 60 min
});
```

Run: `pnpm test lib/scheduling/availability.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/scheduling/availability.ts lib/scheduling/availability.test.ts package.json pnpm-lock.yaml
git commit -m "feat: agrega cálculo puro de slots disponibles según horario laboral"
```

---

### Task 2: Generar la ventana de días a mostrar en el portal público

**Files:**
- Create: `lib/scheduling/week-window.ts`
- Test: `lib/scheduling/week-window.test.ts`

**Interfaces:**
- Consumes: ninguna dependencia nueva.
- Produces: `getUpcomingDays(from: Date, count: number): Date[]`. Usado por la Server Action de disponibilidad pública (Task 4) para generar la vista semanal de la spec §5.5.2 ("Vista de huecos disponibles (semanal)").

- [ ] **Step 1: Escribir el test que falla**

```typescript
// lib/scheduling/week-window.test.ts
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm test lib/scheduling/week-window.test.ts`
Expected: FAIL con "Cannot find module './week-window'".

- [ ] **Step 3: Implementar `getUpcomingDays`**

```typescript
// lib/scheduling/week-window.ts
export function getUpcomingDays(from: Date, count: number): Date[] {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    return day;
  });
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm test lib/scheduling/week-window.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduling/week-window.ts lib/scheduling/week-window.test.ts
git commit -m "feat: agrega generador de ventana de días para vista semanal de disponibilidad"
```

---

## Fase 2 — Envío de email con Resend

### Task 3: Cliente de envío de email de confirmación de reserva

**Files:**
- Create: `lib/email/resend-client.ts`
- Test: `lib/email/resend-client.test.ts`
- Modify: `.env.example` (agregar `RESEND_API_KEY`, `BOOKING_EMAIL_FROM`)

**Interfaces:**
- Consumes: ninguna dependencia de tareas anteriores.
- Produces: `sendBookingConfirmationEmail(client: ResendLike, input: BookingEmailInput): Promise<void>`, tipo `BookingEmailInput = { to: string; bookerName: string; manageUrl: string; activityTitle: string; start: Date; end: Date; timezone: string }`, tipo `ResendLike` (interfaz mínima inyectable para test). Usado por la Server Action de reserva pública (Task 5).

- [ ] **Step 1: Instalar Resend**

```bash
pnpm add resend
```

- [ ] **Step 2: Escribir el test que falla**

```typescript
// lib/email/resend-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { sendBookingConfirmationEmail } from "./resend-client";
import type { ResendLike } from "./resend-client";

function makeFakeResend(): ResendLike {
  return {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }),
    },
  };
}

describe("sendBookingConfirmationEmail", () => {
  it("envía el correo con el link de gestión y los datos de la reserva", async () => {
    const resend = makeFakeResend();

    await sendBookingConfirmationEmail(resend, {
      to: "cliente@example.com",
      bookerName: "Ana Pérez",
      manageUrl: "https://example.com/reservar/gestionar/abc-123",
      activityTitle: "Cancha 1",
      start: new Date("2026-08-24T14:00:00.000Z"),
      end: new Date("2026-08-24T15:00:00.000Z"),
      timezone: "America/Santiago",
    });

    expect(resend.emails.send).toHaveBeenCalledOnce();
    const call = (resend.emails.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.to).toEqual(["cliente@example.com"]);
    expect(call.html).toContain("https://example.com/reservar/gestionar/abc-123");
    expect(call.html).toContain("Ana Pérez");
  });

  it("lanza un error si Resend responde con error", async () => {
    const resend = makeFakeResend();
    (resend.emails.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "invalid `to` field" },
    });

    await expect(
      sendBookingConfirmationEmail(resend, {
        to: "invalido",
        bookerName: "Ana",
        manageUrl: "https://example.com/x",
        activityTitle: "Cancha 1",
        start: new Date(),
        end: new Date(),
        timezone: "America/Santiago",
      })
    ).rejects.toThrow("invalid `to` field");
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `pnpm test lib/email/resend-client.test.ts`
Expected: FAIL con "Cannot find module './resend-client'".

- [ ] **Step 4: Implementar `resend-client.ts`**

```typescript
// lib/email/resend-client.ts
import { Resend } from "resend";
import { formatInTimeZone } from "date-fns-tz";

export interface BookingEmailInput {
  to: string;
  bookerName: string;
  manageUrl: string;
  activityTitle: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface ResendLike {
  emails: {
    send(input: {
      from: string;
      to: string[];
      subject: string;
      html: string;
    }): Promise<{ data: { id: string } | null; error: { name: string; message: string } | null }>;
  };
}

function formatRange(start: Date, end: Date, timezone: string): string {
  const day = formatInTimeZone(start, timezone, "dd/MM/yyyy");
  const startTime = formatInTimeZone(start, timezone, "HH:mm");
  const endTime = formatInTimeZone(end, timezone, "HH:mm");
  return `${day} de ${startTime} a ${endTime}`;
}

export async function sendBookingConfirmationEmail(
  client: ResendLike,
  input: BookingEmailInput
): Promise<void> {
  const from = process.env.BOOKING_EMAIL_FROM ?? "reservas@example.com";
  const range = formatRange(input.start, input.end, input.timezone);

  const { error } = await client.emails.send({
    from,
    to: [input.to],
    subject: `Confirmación de reserva: ${input.activityTitle}`,
    html: `
      <p>Hola ${input.bookerName},</p>
      <p>Tu reserva de <strong>${input.activityTitle}</strong> para el <strong>${range}</strong> quedó confirmada.</p>
      <p>Puedes ver, reprogramar o cancelar tu reserva en cualquier momento desde este link:</p>
      <p><a href="${input.manageUrl}">${input.manageUrl}</a></p>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export function createResendClient(): ResendLike {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY no está definida");
  }
  return new Resend(process.env.RESEND_API_KEY) as unknown as ResendLike;
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm test lib/email/resend-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Agregar variables de entorno a `.env.example`**

Agregar al final del archivo:

```bash
# Resend (email de confirmación de reserva pública)
RESEND_API_KEY=""
BOOKING_EMAIL_FROM="reservas@example.com"
```

- [ ] **Step 7: Commit**

```bash
git add lib/email/resend-client.ts lib/email/resend-client.test.ts .env.example package.json pnpm-lock.yaml
git commit -m "feat: agrega cliente de email de confirmación de reserva con Resend"
```

---

## Fase 3 — Capa de datos y disponibilidad pública

### Task 4: Query de disponibilidad semanal y repositorio de reservas públicas

**Files:**
- Create: `lib/db/repositories/booking.ts`
- Test: `lib/db/repositories/booking.test.ts`

**Interfaces:**
- Consumes: `listActivitiesInRange` de `lib/db/repositories/activities.ts`, `computeAvailableSlots`/`WorkHours` de `lib/scheduling/availability.ts`, `getUpcomingDays` de `lib/scheduling/week-window.ts`, `getAppConfig` de `lib/db/repositories/app-config.ts`.
- Produces: `getWeeklyAvailability(db, params: { from: Date; days: number; slotDurationMinutes: number }): Promise<{ day: Date; slots: TimeRange[] }[]>`, `getActivityByBookingToken(db, token: string): Promise<Activity | null>`. Usado por la Server Action de disponibilidad pública (Task 5) y la Server Action de gestión de reserva (Task 6).

- [ ] **Step 1: Escribir el test que falla — disponibilidad semanal sin actividades**

```typescript
// lib/db/repositories/booking.test.ts
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm test lib/db/repositories/booking.test.ts`
Expected: FAIL con "Cannot find module './booking'".

- [ ] **Step 3: Implementar `lib/db/repositories/booking.ts`**

```typescript
import { and, eq, isNull } from "drizzle-orm";
import type { db as dbType } from "../client";
import { activities, type Activity } from "../schema";
import { getAppConfig } from "./app-config";
import { listActivitiesInRange } from "./activities";
import { computeAvailableSlots } from "@/lib/scheduling/availability";
import { getUpcomingDays } from "@/lib/scheduling/week-window";
import type { TimeRange } from "@/lib/scheduling/overlap";

type Db = typeof dbType;

export interface DayAvailability {
  day: Date;
  slots: TimeRange[];
}

export async function getWeeklyAvailability(
  db: Db,
  params: { from: Date; days: number; slotDurationMinutes: number }
): Promise<DayAvailability[]> {
  const config = await getAppConfig(db);
  const workHours = {
    start: config?.workHoursStart ?? "08:00",
    end: config?.workHoursEnd ?? "19:00",
  };
  const timezone = config?.timezone ?? "America/Santiago";

  const days = getUpcomingDays(params.from, params.days);

  const results: DayAvailability[] = [];
  for (const day of days) {
    const dayEnd = new Date(day);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const existing = await listActivitiesInRange(db, { start: day, end: dayEnd });

    const slots = computeAvailableSlots({
      day,
      workHours,
      timezone,
      existing: existing.map((a) => ({ start: a.startDatetime, end: a.endDatetime })),
      slotDurationMinutes: params.slotDurationMinutes,
    });

    results.push({ day, slots });
  }

  return results;
}

export async function getActivityByBookingToken(db: Db, token: string): Promise<Activity | null> {
  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.bookingToken, token), isNull(activities.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `docker compose -f docker-compose.test.yml up -d && DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" TEST_DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" pnpm test lib/db/repositories/booking.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/repositories/booking.ts lib/db/repositories/booking.test.ts
git commit -m "feat: agrega repositorio de disponibilidad semanal y consulta por booking_token"
```

---

## Fase 4 — Server Actions de reserva pública

### Task 5: Server Action de creación de reserva pública

**Files:**
- Create: `lib/actions/create-booking.ts`
- Test: `lib/actions/create-booking.test.ts`

**Interfaces:**
- Consumes: `getAppConfig`, `findConflicts`, `createActivity`, `updateActivitySyncStatus` de `lib/db/repositories/activities.ts` y `lib/db/repositories/app-config.ts`; `validateTimeRange` de `lib/scheduling/validate-range.ts`; `colorForStatus` de `lib/scheduling/color.ts`; `decryptToken` de `lib/crypto/token-cipher.ts`; `GoogleCalendarClient` de `lib/google-calendar/client.ts`; `sendBookingConfirmationEmail`, `ResendLike` de `lib/email/resend-client.ts`.
- Produces: `createBooking(db, googleClientFactory, resendClient, buildManageUrl, input: CreateBookingInput): Promise<CreateBookingResult>`, tipo `CreateBookingInput = { title: string; activityType: string; start: Date; end: Date; bookerName: string; bookerEmail: string }`, tipo `CreateBookingResult = { status: "created"; activity: Activity } | { status: "conflict"; conflicts: Activity[] } | { status: "invalid"; reason: string }`. Usado por la Server Action pública en `app/actions/booking.ts` (Task 8).

- [ ] **Step 1: Escribir el test que falla — caso feliz crea, sincroniza y envía email**

```typescript
// lib/actions/create-booking.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { createActivity } from "@/lib/db/repositories/activities";
import { createBooking } from "./create-booking";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { ResendLike } from "@/lib/email/resend-client";

const db = createTestDb();

function makeFakeGoogleClient(overrides: Partial<GoogleCalendarClient> = {}): GoogleCalendarClient {
  return {
    insertEvent: vi.fn().mockResolvedValue({ googleEventId: "google-evt-1" }),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listEvents: vi.fn(),
    ...overrides,
  };
}

function makeFakeResend(): ResendLike {
  return {
    emails: { send: vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }) },
  };
}

const buildManageUrl = (token: string) => `https://example.com/reservar/gestionar/${token}`;

beforeEach(async () => {
  await truncateAll(db);
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  await upsertAppConfig(db, {
    googleCalendarId: "primary",
    googleRefreshToken: encryptToken("refresh-token"),
    conflictPolicy: "block",
    timezone: "America/Santiago",
  });
});

describe("createBooking", () => {
  it("rechaza cuando el rango horario es inválido", async () => {
    const result = await createBooking(db, () => makeFakeGoogleClient(), makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T15:00:00Z"),
      end: new Date("2026-08-24T14:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });
    expect(result.status).toBe("invalid");
  });

  it("bloquea si hay conflicto (política block, sin excepción para el público)", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Ocupado",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "admin",
      syncStatus: "synced",
    });

    const result = await createBooking(db, () => makeFakeGoogleClient(), makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T14:30:00Z"),
      end: new Date("2026-08-24T15:30:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });
    expect(result.status).toBe("conflict");
  });

  it("crea la reserva, la sincroniza con Google, envía el email y guarda booking_token", async () => {
    const googleClient = makeFakeGoogleClient();
    const resend = makeFakeResend();

    const result = await createBooking(db, () => googleClient, resend, buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-24T14:00:00Z"),
      end: new Date("2026-08-24T15:00:00Z"),
      bookerName: "Ana Pérez",
      bookerEmail: "ana@example.com",
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.createdBy).toBe("public");
      expect(result.activity.status).toBe("programada");
      expect(result.activity.color).toBe("azul");
      expect(result.activity.bookingToken).toBeTruthy();
      expect(result.activity.bookerEmail).toBe("ana@example.com");
      expect(result.activity.syncStatus).toBe("synced");
    }
    expect(googleClient.insertEvent).toHaveBeenCalledOnce();
    expect(resend.emails.send).toHaveBeenCalledOnce();
    const emailCall = (resend.emails.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(emailCall.to).toEqual(["ana@example.com"]);
  });

  it("crea la reserva aunque falle el envío del email (no revierte la actividad)", async () => {
    const googleClient = makeFakeGoogleClient();
    const resend: ResendLike = {
      emails: { send: vi.fn().mockRejectedValue(new Error("Resend down")) },
    };

    const result = await createBooking(db, () => googleClient, resend, buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-25T14:00:00Z"),
      end: new Date("2026-08-25T15:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });

    expect(result.status).toBe("created");
  });

  it("marca sync_status=error si falla Google, pero conserva la reserva y el booking_token", async () => {
    const googleClient = makeFakeGoogleClient({
      insertEvent: vi.fn().mockRejectedValue(new Error("Google API unavailable")),
    });

    const result = await createBooking(db, () => googleClient, makeFakeResend(), buildManageUrl, {
      title: "Cancha 1",
      activityType: "Reserva",
      start: new Date("2026-08-26T14:00:00Z"),
      end: new Date("2026-08-26T15:00:00Z"),
      bookerName: "Ana",
      bookerEmail: "ana@example.com",
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.syncStatus).toBe("error");
      expect(result.activity.bookingToken).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm test lib/actions/create-booking.test.ts`
Expected: FAIL con "Cannot find module './create-booking'".

- [ ] **Step 3: Implementar `lib/actions/create-booking.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity, findConflicts, updateActivitySyncStatus } from "@/lib/db/repositories/activities";
import { validateTimeRange } from "@/lib/scheduling/validate-range";
import { colorForStatus } from "@/lib/scheduling/color";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { sendBookingConfirmationEmail } from "@/lib/email/resend-client";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { ResendLike } from "@/lib/email/resend-client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export interface CreateBookingInput {
  title: string;
  activityType: string;
  start: Date;
  end: Date;
  bookerName: string;
  bookerEmail: string;
}

export type CreateBookingResult =
  | { status: "created"; activity: Activity }
  | { status: "conflict"; conflicts: Activity[] }
  | { status: "invalid"; reason: string };

export async function createBooking(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  resendClient: ResendLike,
  buildManageUrl: (token: string) => string,
  input: CreateBookingInput
): Promise<CreateBookingResult> {
  const rangeValidation = validateTimeRange({ start: input.start, end: input.end });
  if (!rangeValidation.valid) {
    return { status: "invalid", reason: rangeValidation.reason };
  }

  const config = await getAppConfig(db);
  const conflicts = await findConflicts(db, { start: input.start, end: input.end });
  if (conflicts.length > 0) {
    return { status: "conflict", conflicts };
  }

  const status = "programada" as const;
  const bookingToken = randomUUID();
  const activity = await createActivity(db, {
    source: "manual",
    title: input.title,
    activityType: input.activityType,
    status,
    color: colorForStatus(status),
    startDatetime: input.start,
    endDatetime: input.end,
    createdBy: "public",
    syncStatus: "pending",
    bookingToken,
    bookerName: input.bookerName,
    bookerEmail: input.bookerEmail,
  });

  let finalActivity = activity;

  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    finalActivity = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: "No hay Calendar ID o token de Google configurado",
    });
  } else {
    try {
      const googleClient = googleClientFactory({
        calendarId: config.googleCalendarId,
        refreshToken: decryptToken(config.googleRefreshToken),
      });
      const { googleEventId } = await googleClient.insertEvent({
        title: activity.title,
        start: activity.startDatetime,
        end: activity.endDatetime,
        timezone: config.timezone,
      });
      finalActivity = await updateActivitySyncStatus(db, activity.id, {
        syncStatus: "synced",
        googleEventId,
        remindersConfigured: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
      finalActivity = await updateActivitySyncStatus(db, activity.id, {
        syncStatus: "error",
        syncErrorMessage: message,
      });
    }
  }

  try {
    await sendBookingConfirmationEmail(resendClient, {
      to: input.bookerEmail,
      bookerName: input.bookerName,
      manageUrl: buildManageUrl(bookingToken),
      activityTitle: input.title,
      start: input.start,
      end: input.end,
      timezone: config?.timezone ?? "America/Santiago",
    });
  } catch {
    // El email es best-effort: la reserva ya quedó creada y sincronizada:
    // no revertir la actividad si Resend falla.
  }

  return { status: "created", activity: finalActivity };
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `pnpm test lib/actions/create-booking.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/actions/create-booking.ts lib/actions/create-booking.test.ts
git commit -m "feat: agrega Server Action de creación de reserva pública con sync y email"
```

---

### Task 6: Server Action de gestión de reserva (reprogramar / cancelar)

**Files:**
- Create: `lib/actions/manage-booking.ts`
- Test: `lib/actions/manage-booking.test.ts`

**Interfaces:**
- Consumes: `getActivityByBookingToken` de `lib/db/repositories/booking.ts`; `getAppConfig`, `findConflicts`, `softDeleteActivity` de `lib/db/repositories/activities.ts` y `app-config.ts`; `validateTimeRange` de `lib/scheduling/validate-range.ts`; `decryptToken` de `lib/crypto/token-cipher.ts`; `db.update` de Drizzle directamente para el reprogramado (no existe aún un `updateActivitySchedule` genérico).
- Produces: `rescheduleBooking(db, googleClientFactory, input: { token: string; start: Date; end: Date }): Promise<RescheduleResult>`, `cancelBooking(db, googleClientFactory, token: string): Promise<CancelResult>`, tipos `RescheduleResult = { status: "rescheduled"; activity: Activity } | { status: "conflict"; conflicts: Activity[] } | { status: "invalid"; reason: string } | { status: "not_found" }`, `CancelResult = { status: "cancelled" } | { status: "not_found" }`. Usado por `app/actions/booking-management.ts` (Task 8).

- [ ] **Step 1: Agregar `updateActivitySchedule` al repositorio de activities (necesario para el reprogramado)**

Antes de escribir el test de esta tarea, extender `lib/db/repositories/activities.ts` (archivo del Plan 1/2) con una función que faltaba: actualizar horario y `google_event_id` en una sola operación.

```typescript
// Agregar a lib/db/repositories/activities.ts, junto a updateActivitySyncStatus
export async function updateActivitySchedule(
  db: Db,
  id: string,
  patch: { startDatetime: Date; endDatetime: Date; syncStatus: "synced" | "pending" | "error"; syncErrorMessage?: string | null }
): Promise<Activity> {
  const [updated] = await db
    .update(activities)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();
  return updated;
}
```

- [ ] **Step 2: Escribir el test que falla — cancelar una reserva existente**

```typescript
// lib/actions/manage-booking.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { createActivity } from "@/lib/db/repositories/activities";
import { rescheduleBooking, cancelBooking } from "./manage-booking";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

const db = createTestDb();
const TOKEN = "22222222-2222-2222-2222-222222222222";

function makeFakeGoogleClient(overrides: Partial<GoogleCalendarClient> = {}): GoogleCalendarClient {
  return {
    insertEvent: vi.fn().mockResolvedValue({ googleEventId: "google-evt-1" }),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listEvents: vi.fn(),
    ...overrides,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  await upsertAppConfig(db, {
    googleCalendarId: "primary",
    googleRefreshToken: encryptToken("refresh-token"),
    timezone: "America/Santiago",
  });
});

describe("cancelBooking", () => {
  it("devuelve not_found si el token no existe", async () => {
    const result = await cancelBooking(db, () => makeFakeGoogleClient(), "00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe("not_found");
  });

  it("hace soft delete de la actividad y elimina el evento en Google", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient();
    const result = await cancelBooking(db, () => googleClient, TOKEN);

    expect(result.status).toBe("cancelled");
    expect(googleClient.deleteEvent).toHaveBeenCalledWith("google-evt-1");

    const afterCancel = await cancelBooking(db, () => googleClient, TOKEN);
    expect(afterCancel.status).toBe("not_found");
  });
});

describe("rescheduleBooking", () => {
  it("devuelve not_found si el token no existe", async () => {
    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: "00000000-0000-0000-0000-000000000000",
      start: new Date("2026-08-24T16:00:00Z"),
      end: new Date("2026-08-24T17:00:00Z"),
    });
    expect(result.status).toBe("not_found");
  });

  it("rechaza si el nuevo rango es inválido", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: TOKEN,
      start: new Date("2026-08-24T17:00:00Z"),
      end: new Date("2026-08-24T16:00:00Z"),
    });
    expect(result.status).toBe("invalid");
  });

  it("bloquea si el nuevo horario se solapa con otra actividad", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva propia",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });
    await createActivity(db, {
      source: "manual",
      title: "Otra actividad",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T17:00:00Z"),
      endDatetime: new Date("2026-08-24T18:00:00Z"),
      createdBy: "admin",
      syncStatus: "synced",
    });

    const result = await rescheduleBooking(db, () => makeFakeGoogleClient(), {
      token: TOKEN,
      start: new Date("2026-08-24T17:30:00Z"),
      end: new Date("2026-08-24T18:30:00Z"),
    });
    expect(result.status).toBe("conflict");
  });

  it("actualiza el horario y llama a Google events.update con el nuevo rango", async () => {
    await createActivity(db, {
      source: "manual",
      title: "Reserva",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-24T14:00:00Z"),
      endDatetime: new Date("2026-08-24T15:00:00Z"),
      createdBy: "public",
      syncStatus: "synced",
      googleEventId: "google-evt-1",
      bookingToken: TOKEN,
      bookerEmail: "ana@example.com",
      bookerName: "Ana",
    });

    const googleClient = makeFakeGoogleClient();
    const result = await rescheduleBooking(db, () => googleClient, {
      token: TOKEN,
      start: new Date("2026-08-25T10:00:00Z"),
      end: new Date("2026-08-25T11:00:00Z"),
    });

    expect(result.status).toBe("rescheduled");
    if (result.status === "rescheduled") {
      expect(result.activity.startDatetime.toISOString()).toBe("2026-08-25T10:00:00.000Z");
      expect(result.activity.syncStatus).toBe("synced");
    }
    expect(googleClient.updateEvent).toHaveBeenCalledWith(
      "google-evt-1",
      expect.objectContaining({ start: new Date("2026-08-25T10:00:00Z") })
    );
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `pnpm test lib/actions/manage-booking.test.ts`
Expected: FAIL con "Cannot find module './manage-booking'".

- [ ] **Step 4: Implementar `lib/actions/manage-booking.ts`**

```typescript
import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { findConflicts, softDeleteActivity, updateActivitySchedule } from "@/lib/db/repositories/activities";
import { getActivityByBookingToken } from "@/lib/db/repositories/booking";
import { validateTimeRange } from "@/lib/scheduling/validate-range";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export type CancelResult = { status: "cancelled" } | { status: "not_found" };

export async function cancelBooking(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  token: string
): Promise<CancelResult> {
  const activity = await getActivityByBookingToken(db, token);
  if (!activity) {
    return { status: "not_found" };
  }

  await softDeleteActivity(db, activity.id);

  const config = await getAppConfig(db);
  if (activity.googleEventId && config?.googleCalendarId && config.googleRefreshToken) {
    const googleClient = googleClientFactory({
      calendarId: config.googleCalendarId,
      refreshToken: decryptToken(config.googleRefreshToken),
    });
    await googleClient.deleteEvent(activity.googleEventId);
  }

  return { status: "cancelled" };
}

export type RescheduleResult =
  | { status: "rescheduled"; activity: Activity }
  | { status: "conflict"; conflicts: Activity[] }
  | { status: "invalid"; reason: string }
  | { status: "not_found" };

export async function rescheduleBooking(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  input: { token: string; start: Date; end: Date }
): Promise<RescheduleResult> {
  const activity = await getActivityByBookingToken(db, input.token);
  if (!activity) {
    return { status: "not_found" };
  }

  const rangeValidation = validateTimeRange({ start: input.start, end: input.end });
  if (!rangeValidation.valid) {
    return { status: "invalid", reason: rangeValidation.reason };
  }

  const allConflicts = await findConflicts(db, { start: input.start, end: input.end });
  const conflicts = allConflicts.filter((c) => c.id !== activity.id);
  if (conflicts.length > 0) {
    return { status: "conflict", conflicts };
  }

  const config = await getAppConfig(db);
  let syncStatus: "synced" | "pending" | "error" = "pending";
  let syncErrorMessage: string | null = null;

  if (activity.googleEventId && config?.googleCalendarId && config.googleRefreshToken) {
    try {
      const googleClient = googleClientFactory({
        calendarId: config.googleCalendarId,
        refreshToken: decryptToken(config.googleRefreshToken),
      });
      await googleClient.updateEvent(activity.googleEventId, {
        title: activity.title,
        start: input.start,
        end: input.end,
        timezone: config.timezone,
      });
      syncStatus = "synced";
    } catch (error) {
      syncStatus = "error";
      syncErrorMessage = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
    }
  } else {
    syncStatus = "error";
    syncErrorMessage = "No hay Calendar ID o token de Google configurado";
  }

  const updated = await updateActivitySchedule(db, activity.id, {
    startDatetime: input.start,
    endDatetime: input.end,
    syncStatus,
    syncErrorMessage,
  });

  return { status: "rescheduled", activity: updated };
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm test lib/actions/manage-booking.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/db/repositories/activities.ts lib/actions/manage-booking.ts lib/actions/manage-booking.test.ts
git commit -m "feat: agrega Server Actions de reprogramar y cancelar reserva pública vía booking_token"
```

---

## Fase 5 — UI del portal público

### Task 7: Página `/reservar` — vista semanal de disponibilidad

**Files:**
- Create: `app/reservar/page.tsx`
- Create: `app/reservar/booking-form.tsx`
- Create: `app/actions/booking.ts`

**Interfaces:**
- Consumes: `getWeeklyAvailability` de `lib/db/repositories/booking.ts`; `createBooking` de `lib/actions/create-booking.ts`; `createGoogleCalendarClient` de `lib/google-calendar/client.ts`; `createResendClient` de `lib/email/resend-client.ts`; `db` de `lib/db/client.ts`.
- Produces: Server Action `submitBooking(prevState, formData): Promise<SubmitBookingState>` exportada desde `app/actions/booking.ts`, tipo `SubmitBookingState`. Consumido por `app/reservar/booking-form.tsx` y reutilizable por la página de confirmación (Task 8 la redirige, no la reimporta).

- [ ] **Step 1: Crear la Server Action pública `app/actions/booking.ts`**

```typescript
"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { createBooking } from "@/lib/actions/create-booking";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";
import { createResendClient } from "@/lib/email/resend-client";

export interface SubmitBookingState {
  status: "idle" | "conflict" | "invalid";
  message?: string;
}

async function buildManageUrl(token: string): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  return `${protocol}://${host}/reservar/gestionar/${token}`;
}

export async function submitBooking(
  _prevState: SubmitBookingState,
  formData: FormData
): Promise<SubmitBookingState> {
  const title = String(formData.get("activityType") ?? "Reserva");
  const activityType = String(formData.get("activityType") ?? "Reserva");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));
  const bookerName = String(formData.get("bookerName") ?? "");
  const bookerEmail = String(formData.get("bookerEmail") ?? "");

  const manageUrl = await buildManageUrl("PLACEHOLDER");

  const result = await createBooking(
    db,
    createGoogleCalendarClient,
    createResendClient(),
    (token) => manageUrl.replace("PLACEHOLDER", token),
    { title, activityType, start, end, bookerName, bookerEmail }
  );

  if (result.status === "created") {
    redirect(`/reservar/confirmacion?token=${result.activity.bookingToken}`);
  }

  if (result.status === "conflict") {
    return { status: "conflict", message: "Ese horario ya no está disponible. Por favor elige otro." };
  }

  return { status: "invalid", message: result.reason };
}
```

`redirect()` de Next.js lanza internamente una excepción de control de flujo — es el patrón estándar dentro de una Server Action y no necesita `try/catch`.

- [ ] **Step 2: Crear `app/reservar/booking-form.tsx` (Client Component)**

```typescript
"use client";

import { useActionState } from "react";
import { submitBooking, type SubmitBookingState } from "@/app/actions/booking";

const initialState: SubmitBookingState = { status: "idle" };

export function BookingForm({ start, end }: { start: string; end: string }) {
  const [state, formAction] = useActionState(submitBooking, initialState);

  return (
    <form action={formAction} className="space-y-3 rounded border bg-white p-4 shadow-sm">
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <p className="text-sm text-gray-600">
        {new Date(start).toLocaleString("es-CL")} — {new Date(end).toLocaleTimeString("es-CL")}
      </p>
      <input name="bookerName" placeholder="Nombre" required className="w-full rounded border p-2" />
      <input
        name="bookerEmail"
        type="email"
        placeholder="Correo electrónico"
        required
        className="w-full rounded border p-2"
      />
      <input name="activityType" placeholder="Motivo de la reserva" required className="w-full rounded border p-2" />

      {state.status === "conflict" && (
        <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">{state.message}</div>
      )}
      {state.status === "invalid" && (
        <div className="rounded bg-red-100 p-2 text-sm text-red-800">{state.message}</div>
      )}

      <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
        Confirmar reserva
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Crear `app/reservar/page.tsx` (Server Component)**

```typescript
import { db } from "@/lib/db/client";
import { getWeeklyAvailability } from "@/lib/db/repositories/booking";
import { BookingForm } from "./booking-form";

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const params = await searchParams;
  const availability = await getWeeklyAvailability(db, {
    from: new Date(),
    days: 7,
    slotDurationMinutes: 60,
  });

  if (params.start && params.end) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-xl font-semibold">Confirma tu reserva</h1>
        <BookingForm start={params.start} end={params.end} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Horarios disponibles</h1>
      <div className="space-y-6">
        {availability.map(({ day, slots }) => (
          <section key={day.toISOString()}>
            <h2 className="mb-2 font-medium">
              {day.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}
            </h2>
            {slots.length === 0 ? (
              <p className="text-sm text-gray-500">Sin horarios disponibles</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <a
                    key={slot.start.toISOString()}
                    href={`/reservar?start=${encodeURIComponent(slot.start.toISOString())}&end=${encodeURIComponent(slot.end.toISOString())}`}
                    className="rounded border px-3 py-1 text-sm hover:bg-blue-50"
                  >
                    {slot.start.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                  </a>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Verificación manual**

```bash
pnpm dev
```

Visitar `http://localhost:3000/reservar`, verificar que se listan los 7 días con sus slots (o "Sin horarios disponibles" si `app_config` aún no tiene fila — en ese caso ejecutar primero el onboarding del Plan 1/2). Hacer clic en un slot, verificar que aparece el formulario de confirmación con el horario seleccionado.

- [ ] **Step 6: Commit**

```bash
git add app/reservar/page.tsx app/reservar/booking-form.tsx app/actions/booking.ts
git commit -m "feat: agrega portal público de agendamiento con vista semanal de disponibilidad"
```

---

### Task 8: Página de confirmación post-reserva

**Files:**
- Create: `app/reservar/confirmacion/page.tsx`

**Interfaces:**
- Consumes: `getActivityByBookingToken` de `lib/db/repositories/booking.ts`, `db` de `lib/db/client.ts`.
- Produces: página en `/reservar/confirmacion?token=...`. Sin exports consumidos por otras tareas.

- [ ] **Step 1: Crear `app/reservar/confirmacion/page.tsx`**

```typescript
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getActivityByBookingToken } from "@/lib/db/repositories/booking";

export default async function ConfirmacionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    notFound();
  }

  const activity = await getActivityByBookingToken(db, token);
  if (!activity) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-xl font-semibold">¡Reserva confirmada!</h1>
      <p className="mb-4 text-gray-600">
        {activity.startDatetime.toLocaleString("es-CL")} — {activity.endDatetime.toLocaleTimeString("es-CL")}
      </p>
      <p className="text-sm text-gray-500">
        Te enviamos un correo con el link para gestionar tu reserva. Si no lo ves, revisa spam.
      </p>
      <a
        href={`/reservar/gestionar/${activity.bookingToken}`}
        className="mt-6 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white"
      >
        Gestionar mi reserva
      </a>
    </main>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add app/reservar/confirmacion/page.tsx
git commit -m "feat: agrega página de confirmación post-reserva"
```

---

### Task 9: Página y Server Action de gestión de reserva (`/reservar/gestionar/[token]`)

**Files:**
- Create: `app/reservar/gestionar/[token]/page.tsx`
- Create: `app/reservar/gestionar/[token]/manage-booking-form.tsx`
- Create: `app/actions/booking-management.ts`

**Interfaces:**
- Consumes: `getActivityByBookingToken` de `lib/db/repositories/booking.ts`; `rescheduleBooking`, `cancelBooking` de `lib/actions/manage-booking.ts`; `createGoogleCalendarClient` de `lib/google-calendar/client.ts`; `db` de `lib/db/client.ts`.
- Produces: Server Actions `submitReschedule(prevState, formData)`, `submitCancel(prevState, formData)` exportadas desde `app/actions/booking-management.ts`.

- [ ] **Step 1: Crear `app/actions/booking-management.ts`**

```typescript
"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { rescheduleBooking, cancelBooking } from "@/lib/actions/manage-booking";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export interface ManageBookingState {
  status: "idle" | "conflict" | "invalid" | "not_found";
  message?: string;
}

export async function submitReschedule(
  _prevState: ManageBookingState,
  formData: FormData
): Promise<ManageBookingState> {
  const token = String(formData.get("token") ?? "");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));

  const result = await rescheduleBooking(db, createGoogleCalendarClient, { token, start, end });

  if (result.status === "rescheduled") {
    redirect(`/reservar/gestionar/${token}?updated=1`);
  }
  if (result.status === "conflict") {
    return { status: "conflict", message: "Ese horario ya no está disponible. Por favor elige otro." };
  }
  if (result.status === "not_found") {
    return { status: "not_found", message: "No se encontró la reserva." };
  }
  return { status: "invalid", message: result.reason };
}

export async function submitCancel(
  _prevState: ManageBookingState,
  formData: FormData
): Promise<ManageBookingState> {
  const token = String(formData.get("token") ?? "");
  const result = await cancelBooking(db, createGoogleCalendarClient, token);

  if (result.status === "not_found") {
    return { status: "not_found", message: "No se encontró la reserva." };
  }

  redirect("/reservar/gestionar/cancelada");
}
```

- [ ] **Step 2: Crear `app/reservar/gestionar/[token]/manage-booking-form.tsx` (Client Component)**

```typescript
"use client";

import { useActionState } from "react";
import { submitReschedule, submitCancel, type ManageBookingState } from "@/app/actions/booking-management";

const initialState: ManageBookingState = { status: "idle" };

export function ManageBookingForm({
  token,
  currentStart,
  currentEnd,
}: {
  token: string;
  currentStart: string;
  currentEnd: string;
}) {
  const [rescheduleState, rescheduleAction] = useActionState(submitReschedule, initialState);
  const [cancelState, cancelAction] = useActionState(submitCancel, initialState);

  return (
    <div className="space-y-6">
      <form action={rescheduleAction} className="space-y-3 rounded border bg-white p-4">
        <h2 className="font-medium">Reprogramar</h2>
        <input type="hidden" name="token" value={token} />
        <label className="block text-sm">Nuevo inicio</label>
        <input
          name="start"
          type="datetime-local"
          defaultValue={currentStart}
          required
          className="w-full rounded border p-2"
        />
        <label className="block text-sm">Nuevo término</label>
        <input
          name="end"
          type="datetime-local"
          defaultValue={currentEnd}
          required
          className="w-full rounded border p-2"
        />
        {rescheduleState.status !== "idle" && (
          <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">{rescheduleState.message}</div>
        )}
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Guardar nuevo horario
        </button>
      </form>

      <form action={cancelAction} className="rounded border bg-white p-4">
        <h2 className="mb-3 font-medium">Cancelar reserva</h2>
        <input type="hidden" name="token" value={token} />
        {cancelState.status === "not_found" && (
          <div className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{cancelState.message}</div>
        )}
        <button type="submit" className="rounded bg-red-600 px-4 py-2 text-sm text-white">
          Cancelar mi reserva
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Crear `app/reservar/gestionar/[token]/page.tsx`**

```typescript
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getActivityByBookingToken } from "@/lib/db/repositories/booking";
import { ManageBookingForm } from "./manage-booking-form";

function toDatetimeLocal(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export default async function GestionarReservaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const activity = await getActivityByBookingToken(db, token);

  if (!activity) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-2 text-xl font-semibold">{activity.title}</h1>
      <p className="mb-6 text-sm text-gray-600">
        Reserva a nombre de {activity.bookerName ?? "—"}
      </p>
      <ManageBookingForm
        token={token}
        currentStart={toDatetimeLocal(activity.startDatetime)}
        currentEnd={toDatetimeLocal(activity.endDatetime)}
      />
    </main>
  );
}
```

- [ ] **Step 4: Crear la página de confirmación de cancelación `app/reservar/gestionar/cancelada/page.tsx`**

```typescript
export default function ReservaCanceladaPage() {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-xl font-semibold">Reserva cancelada</h1>
      <p className="text-gray-600">Tu reserva fue cancelada correctamente.</p>
    </main>
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `pnpm tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Verificación manual**

```bash
pnpm dev
```

Completar una reserva de principio a fin en `/reservar`, copiar el `booking_token` mostrado en `/reservar/confirmacion`, visitar `/reservar/gestionar/[token]`, reprogramar a un horario libre y verificar que se actualiza; luego cancelar y verificar que redirige a la página de cancelación.

- [ ] **Step 7: Commit**

```bash
git add app/reservar/gestionar
git commit -m "feat: agrega gestión pública de reserva (reprogramar y cancelar) vía booking_token"
```

---

## Fase 6 — Verificación final

### Task 10: Tests E2E de alcance reducido con Playwright

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/reservar.spec.ts`
- Modify: `package.json` (script `test:e2e`)

**Interfaces:**
- Consumes: la app corriendo en `http://localhost:3000` (servida por `pnpm dev` durante el test run, configurado vía `webServer` de Playwright).
- Produces: ninguna — es la suite E2E final del plan.

- [ ] **Step 1: Instalar Playwright**

```bash
pnpm add -D @playwright/test
pnpm dlx playwright install --with-deps chromium
```

- [ ] **Step 2: Crear `playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://test:test@localhost:5433/calendario_test",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
```

- [ ] **Step 3: Agregar script a `package.json`**

Agregar en `"scripts"`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Escribir el test E2E — flujo feliz completo de agendamiento público**

Requiere que la base de datos de test tenga `app_config` con horario laboral y sin `google_calendar_id`/`google_refresh_token` configurados, para que el test no dependa de credenciales reales de Google (la actividad queda con `sync_status=error` por falta de config, lo cual no bloquea el flujo público — spec §7: "Se impide leer/crear eventos, se informa el problema... antes de permitir sincronizar", no antes de permitir reservar).

```typescript
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
```

- [ ] **Step 5: Ejecutar la suite E2E**

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" pnpm test:e2e
```

Expected: 2 tests PASS. Si el primer test falla porque no hay slots disponibles hoy (día ya pasado en horario laboral), ajustar `webServer.env` o el `beforeEach` para no depender de "hoy" — usar el mismo patrón de fecha futura fija que el segundo test.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e/reservar.spec.ts package.json pnpm-lock.yaml
git commit -m "test: agrega suite E2E de flujo feliz y flujo de conflicto en /reservar"
```

---

### Task 11: Suite completa y verificación end-to-end manual

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Ejecutar toda la suite de tests unitarios/integración**

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" TEST_DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" pnpm test
```

Expected: todos los tests en PASS, incluyendo los ~30 tests nuevos de las Tasks 1-6 sumados a los del Plan 1/2.

- [ ] **Step 2: Verificar tipos de todo el proyecto**

Run: `pnpm tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Ejecutar la suite E2E**

Run: `DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" pnpm test:e2e`
Expected: PASS.

- [ ] **Step 4: Levantar el servidor de desarrollo y verificar manualmente el flujo completo**

```bash
pnpm dev
```

Con `DATABASE_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` y `RESEND_API_KEY` reales (de un proyecto de prueba) en `.env.local`, y el admin ya conectado desde el Plan 1/2:

1. Visitar `http://localhost:3000/reservar`, verificar que los huecos mostrados excluyen las actividades ya existentes en el panel privado.
2. Reservar un slot con un email real de prueba, verificar que llega el correo de confirmación con el link de gestión.
3. Verificar en `/panel/calendario` que la nueva reserva aparece en azul y en Google Calendar real.
4. Abrir el link de gestión, reprogramar la reserva a otro horario libre, verificar que el evento en Google Calendar se actualiza (mismo `google_event_id`, nuevo horario).
5. Cancelar la reserva desde el link de gestión, verificar que desaparece de `/panel/calendario` y que el evento se elimina de Google Calendar.
6. Intentar reservar un slot ya ocupado por otra fuente (bitácora, manual o `google_calendar`) y verificar que el portal público lo bloquea.

- [ ] **Step 5: Documentar cualquier hallazgo de la verificación manual**

Si algo falla en la verificación manual, corregirlo dentro de este mismo plan antes de dar el proyecto por completo.

---

## Siguientes pasos

Al completar este plan, el sistema tendrá los dos planes originales (panel privado + portal público) totalmente funcionales: administración interna con sync bidireccional a Google Calendar, y agendamiento público autoservicio con gestión de reservas vía link único. No queda alcance pendiente de la spec `docs/superpowers/specs/2026-08-19-calendario-operacional-design.md`; cualquier trabajo adicional (multi-tenant, recordatorios propios, integración real de Bitácora externa) queda explícitamente fuera de alcance según su §2 y requeriría una nueva spec.
