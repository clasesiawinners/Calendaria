# Calendario Operacional — Fundaciones + Panel Privado + Sync Google (Plan 1/2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo funcional del sistema: el administrador (single-tenant) puede iniciar sesión con Google, configurar su calendario, registrar actividades manuales y de Bitácora en un panel privado, ver todo en una vista de calendario con leyenda de colores, y mantener sincronización bidireccional con su Google Calendar real.

**Architecture:** Proyecto único Next.js 15 (App Router) + TypeScript. PostgreSQL vía Drizzle ORM. Auth.js (NextAuth v5) con proveedor Google OAuth para el login del admin, reutilizando el mismo consentimiento para obtener el `refresh_token` de Calendar. Toda la lógica de negocio pura (solapamiento, color, disponibilidad) vive en módulos sin dependencias de DB/framework, testeados de forma aislada. Server Actions orquestan: validar → persistir → sincronizar con Google vía un cliente `googleapis` propio. Un cron (Vercel Cron) hace sync entrante periódica usando `syncToken` incremental.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS, Drizzle ORM + PostgreSQL (Neon en prod, Postgres local vía Docker en test), Auth.js v5, `googleapis`, `react-big-calendar`, Vitest (unit + integration), `date-fns` / `date-fns-tz` para manejo de fechas y zona horaria.

**Spec:** `docs/superpowers/specs/2026-08-19-calendario-operacional-design.md`

## Global Constraints

- Zona horaria consistente en todo el sistema: `America/Santiago` (spec §6), configurable vía `app_config.timezone`.
- Nunca exponer `google_refresh_token` ni credenciales en la interfaz o el código fuente; se almacena cifrado en base de datos (spec §6).
- Toda integración con Google opera únicamente sobre el `google_calendar_id` configurado en `app_config` (spec §6).
- La hora de término de una actividad siempre debe ser posterior a la de inicio (spec §6).
- El color de una actividad se deriva SIEMPRE de `status`, nunca de `activity_type` (spec §4.1): `ejecutada`→verde, `programada`→azul, `pendiente`→naranjo, `externa`→plomo.
- Usar "Otro" como tipo de actividad NUNCA debe modificar automáticamente el catálogo `activity_types` (spec §6).
- Package manager: `pnpm` para todos los comandos (`pnpm add`, `pnpm dlx`, etc. — nunca `npm`).

---

## Fase 1 — Scaffolding y base de datos

### Task 1: Inicializar el proyecto Next.js

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `.env.example`

**Interfaces:**
- Produces: proyecto Next.js 15 App Router ejecutable con `pnpm dev`, Tailwind funcionando.

- [ ] **Step 1: Crear el proyecto con create-next-app**

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-pnpm --eslint
```

Responder "Yes" si pregunta por sobrescribir el directorio actual (ya contiene solo la spec y `.git`).

- [ ] **Step 2: Verificar que el dev server arranca**

Run: `pnpm dev &` luego `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` (esperar 3-5s antes del curl)
Expected: `200`

Detener el server (`kill %1` o similar) tras confirmar.

- [ ] **Step 3: Crear `.env.example` con las variables que se usarán en este plan**

```bash
# Base de datos
DATABASE_URL="postgres://user:password@localhost:5432/calendario_dev"

# Auth.js
AUTH_SECRET=""
AUTH_URL="http://localhost:3000"

# Google OAuth (Auth.js provider + Calendar API)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Cifrado del refresh_token en reposo
TOKEN_ENCRYPTION_KEY=""
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: inicializa proyecto Next.js 15 con TypeScript y Tailwind"
```

---

### Task 2: Configurar Drizzle ORM y conexión a PostgreSQL

**Files:**
- Create: `lib/db/client.ts`
- Create: `drizzle.config.ts`
- Modify: `package.json` (scripts)
- Create: `docker-compose.test.yml`

**Interfaces:**
- Produces: `db` (instancia Drizzle) exportado desde `lib/db/client.ts`, tipado sobre `DATABASE_URL`.

- [ ] **Step 1: Instalar dependencias**

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

- [ ] **Step 2: Crear `lib/db/client.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida");
}

const queryClient = postgres(process.env.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
```

(El archivo `./schema` se crea en el Task 3; este archivo quedará roto hasta entonces, lo cual es esperado dentro de la misma fase.)

- [ ] **Step 3: Crear `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Agregar scripts a `package.json`**

Agregar en la sección `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 5: Crear `docker-compose.test.yml` para la base de datos de test**

```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: calendario_test
    ports:
      - "5433:5432"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: configura Drizzle ORM y docker-compose para base de datos de test"
```

---

### Task 3: Definir el esquema de base de datos

**Files:**
- Create: `lib/db/schema.ts`

**Interfaces:**
- Consumes: nada (primer módulo de datos).
- Produces: tablas Drizzle `activities`, `activityTypes`, `appConfig`, y sus enums (`sourceEnum`, `statusEnum`, `syncStatusEnum`, `createdByEnum`, `conflictPolicyEnum`). Tipos inferidos `Activity`, `NewActivity`, `ActivityType`, `NewActivityType`, `AppConfig`, `NewAppConfig` exportados para uso en toda la app.

- [ ] **Step 1: Escribir `lib/db/schema.ts` completo**

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";

export const sourceEnum = pgEnum("source", [
  "bitacora",
  "manual",
  "google_calendar",
]);

export const statusEnum = pgEnum("status", [
  "ejecutada",
  "programada",
  "pendiente",
  "externa",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "synced",
  "pending",
  "error",
]);

export const createdByEnum = pgEnum("created_by", [
  "admin",
  "public",
  "bitacora",
]);

export const conflictPolicyEnum = pgEnum("conflict_policy", [
  "block",
  "warn",
]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: sourceEnum("source").notNull(),
  externalId: text("external_id").unique(),
  title: text("title").notNull(),
  activityType: text("activity_type").notNull(),
  status: statusEnum("status").notNull(),
  color: text("color").notNull(),
  startDatetime: timestamp("start_datetime", { withTimezone: true }).notNull(),
  endDatetime: timestamp("end_datetime", { withTimezone: true }).notNull(),
  description: text("description"),
  location: text("location"),
  syncStatus: syncStatusEnum("sync_status").notNull().default("pending"),
  syncErrorMessage: text("sync_error_message"),
  createdBy: createdByEnum("created_by").notNull(),
  googleEventId: text("google_event_id"),
  remindersConfigured: boolean("reminders_configured").notNull().default(false),
  bookingToken: uuid("booking_token"),
  bookerName: text("booker_name"),
  bookerEmail: text("booker_email"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityTypes = pgTable("activity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const appConfig = pgTable("app_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  workHoursStart: text("work_hours_start").notNull().default("08:00"),
  workHoursEnd: text("work_hours_end").notNull().default("19:00"),
  timezone: text("timezone").notNull().default("America/Santiago"),
  conflictPolicy: conflictPolicyEnum("conflict_policy").notNull().default("block"),
  googleCalendarId: text("google_calendar_id"),
  googleRefreshToken: text("google_refresh_token"),
  adminEmail: text("admin_email"),
  googleSyncToken: text("google_sync_token"),
});

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type ActivityType = typeof activityTypes.$inferSelect;
export type NewActivityType = typeof activityTypes.$inferInsert;
export type AppConfig = typeof appConfig.$inferSelect;
export type NewAppConfig = typeof appConfig.$inferInsert;
```

- [ ] **Step 2: Generar la migración**

Run: `pnpm db:generate`
Expected: crea un archivo en `lib/db/migrations/0000_*.sql` con las tablas y enums definidos arriba.

- [ ] **Step 3: Levantar la base de datos de test y aplicar la migración**

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" pnpm db:migrate
```

Expected: migración aplicada sin errores.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: define esquema de base de datos (activities, activity_types, app_config)"
```

---

## Fase 2 — Lógica de negocio pura (TDD, sin DB)

### Task 4: Detección de solapamiento de horarios

**Files:**
- Create: `lib/scheduling/overlap.ts`
- Test: `lib/scheduling/overlap.test.ts`

**Interfaces:**
- Produces: `hasOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean` y `findOverlaps(candidate: { start: Date; end: Date }, existing: { start: Date; end: Date }[]): { start: Date; end: Date }[]`. Usado por Tasks 8 y 9 (Server Actions) y por el cálculo de disponibilidad del Plan 2.

- [ ] **Step 1: Instalar Vitest**

```bash
pnpm add -D vitest
```

Agregar a `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Escribir tests fallidos en `lib/scheduling/overlap.test.ts`**

```typescript
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
```

- [ ] **Step 3: Ejecutar y verificar que fallan**

Run: `pnpm vitest run lib/scheduling/overlap.test.ts`
Expected: FAIL — "Cannot find module './overlap'"

- [ ] **Step 4: Implementar `lib/scheduling/overlap.ts`**

```typescript
export interface TimeRange {
  start: Date;
  end: Date;
}

export function hasOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function findOverlaps(candidate: TimeRange, existing: TimeRange[]): TimeRange[] {
  return existing.filter((range) => hasOverlap(candidate, range));
}
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/scheduling/overlap.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implementa detección de solapamiento de horarios"
```

---

### Task 5: Derivación de color por status

**Files:**
- Create: `lib/scheduling/color.ts`
- Test: `lib/scheduling/color.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `colorForStatus(status: "ejecutada" | "programada" | "pendiente" | "externa"): string`. Usado por Tasks 8 y 9 al construir el registro de `activities`.

- [ ] **Step 1: Escribir test fallido en `lib/scheduling/color.test.ts`**

```typescript
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
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm vitest run lib/scheduling/color.test.ts`
Expected: FAIL — "Cannot find module './color'"

- [ ] **Step 3: Implementar `lib/scheduling/color.ts`**

```typescript
export type ActivityStatus = "ejecutada" | "programada" | "pendiente" | "externa";

const STATUS_COLOR_MAP: Record<ActivityStatus, string> = {
  ejecutada: "verde",
  programada: "azul",
  pendiente: "naranjo",
  externa: "plomo",
};

export function colorForStatus(status: ActivityStatus): string {
  return STATUS_COLOR_MAP[status];
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm vitest run lib/scheduling/color.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implementa derivación de color por status de actividad"
```

---

### Task 6: Validación de rango horario (fin posterior a inicio)

**Files:**
- Create: `lib/scheduling/validate-range.ts`
- Test: `lib/scheduling/validate-range.test.ts`

**Interfaces:**
- Consumes: `TimeRange` de `lib/scheduling/overlap.ts`.
- Produces: `validateTimeRange(range: TimeRange): { valid: true } | { valid: false; reason: string }`. Usado por Tasks 8 y 9 antes de cualquier validación de conflicto.

- [ ] **Step 1: Escribir test fallido en `lib/scheduling/validate-range.test.ts`**

```typescript
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
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm vitest run lib/scheduling/validate-range.test.ts`
Expected: FAIL — "Cannot find module './validate-range'"

- [ ] **Step 3: Implementar `lib/scheduling/validate-range.ts`**

```typescript
import type { TimeRange } from "./overlap";

export type ValidationResult = { valid: true } | { valid: false; reason: string };

export function validateTimeRange(range: TimeRange): ValidationResult {
  if (range.end <= range.start) {
    return { valid: false, reason: "La hora de término debe ser posterior a la hora de inicio" };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm vitest run lib/scheduling/validate-range.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implementa validación de rango horario"
```

---

## Fase 3 — Capa de datos (repositorios)

### Task 7: Repositorio de `app_config`

**Files:**
- Create: `lib/db/repositories/app-config.ts`
- Test: `lib/db/repositories/app-config.test.ts`
- Create: `lib/db/test-client.ts`

**Interfaces:**
- Consumes: `db`-like client, tablas `appConfig` de `lib/db/schema.ts`.
- Produces: `getAppConfig(): Promise<AppConfig | null>`, `upsertAppConfig(data: Partial<NewAppConfig>): Promise<AppConfig>`. Usado por Tasks 8, 9, 10, 11, 13.

- [ ] **Step 1: Crear cliente de test de base de datos en `lib/db/test-client.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://test:test@localhost:5433/calendario_test";

export function createTestDb() {
  const queryClient = postgres(TEST_DATABASE_URL);
  return drizzle(queryClient, { schema });
}

export async function truncateAll(db: ReturnType<typeof createTestDb>) {
  await db.execute(`TRUNCATE TABLE activities, activity_types, app_config RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 2: Escribir test fallido en `lib/db/repositories/app-config.test.ts`**

```typescript
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
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `docker compose -f docker-compose.test.yml up -d && pnpm vitest run lib/db/repositories/app-config.test.ts`
Expected: FAIL — "Cannot find module './app-config'"

- [ ] **Step 4: Implementar `lib/db/repositories/app-config.ts`**

```typescript
import { eq } from "drizzle-orm";
import type { db as dbType } from "../client";
import { appConfig, type AppConfig, type NewAppConfig } from "../schema";

type Db = typeof dbType;

export async function getAppConfig(db: Db): Promise<AppConfig | null> {
  const rows = await db.select().from(appConfig).limit(1);
  return rows[0] ?? null;
}

export async function upsertAppConfig(
  db: Db,
  data: Partial<NewAppConfig>
): Promise<AppConfig> {
  const existing = await getAppConfig(db);

  if (!existing) {
    const [created] = await db.insert(appConfig).values(data).returning();
    return created;
  }

  const [updated] = await db
    .update(appConfig)
    .set(data)
    .where(eq(appConfig.id, existing.id))
    .returning();
  return updated;
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm vitest run lib/db/repositories/app-config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implementa repositorio de app_config"
```

---

### Task 8: Repositorio de `activities` — creación y consulta con solapamiento

**Files:**
- Create: `lib/db/repositories/activities.ts`
- Test: `lib/db/repositories/activities.test.ts`

**Interfaces:**
- Consumes: `hasOverlap`/`findOverlaps` de `lib/scheduling/overlap.ts`, tabla `activities` de `lib/db/schema.ts`, `Db` type de Task 7.
- Produces: `createActivity(db, data: NewActivity): Promise<Activity>`, `listActivitiesInRange(db, range: TimeRange): Promise<Activity[]>` (excluye `deletedAt` no nulo), `findConflicts(db, range: TimeRange): Promise<Activity[]>`, `updateActivitySyncStatus(db, id: string, patch: { syncStatus: "synced" | "pending" | "error"; syncErrorMessage?: string | null; googleEventId?: string | null; remindersConfigured?: boolean }): Promise<Activity>`, `softDeleteActivity(db, id: string): Promise<void>`, `getActivityByExternalId(db, externalId: string): Promise<Activity | null>`. Usado por Tasks 9, 10, 11, 13.

- [ ] **Step 1: Escribir tests fallidos en `lib/db/repositories/activities.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, truncateAll } from "../test-client";
import {
  createActivity,
  listActivitiesInRange,
  findConflicts,
  updateActivitySyncStatus,
  softDeleteActivity,
  getActivityByExternalId,
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
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm vitest run lib/db/repositories/activities.test.ts`
Expected: FAIL — "Cannot find module './activities'"

- [ ] **Step 3: Implementar `lib/db/repositories/activities.ts`**

```typescript
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { db as dbType } from "../client";
import { activities, type Activity, type NewActivity } from "../schema";
import type { TimeRange } from "@/lib/scheduling/overlap";

type Db = typeof dbType;

export async function createActivity(db: Db, data: NewActivity): Promise<Activity> {
  const [created] = await db.insert(activities).values(data).returning();
  return created;
}

export async function listActivitiesInRange(db: Db, range: TimeRange): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(
      and(
        isNull(activities.deletedAt),
        lt(activities.startDatetime, range.end),
        gt(activities.endDatetime, range.start)
      )
    );
}

export async function findConflicts(db: Db, range: TimeRange): Promise<Activity[]> {
  return listActivitiesInRange(db, range);
}

export async function updateActivitySyncStatus(
  db: Db,
  id: string,
  patch: {
    syncStatus: "synced" | "pending" | "error";
    syncErrorMessage?: string | null;
    googleEventId?: string | null;
    remindersConfigured?: boolean;
  }
): Promise<Activity> {
  const [updated] = await db
    .update(activities)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();
  return updated;
}

export async function softDeleteActivity(db: Db, id: string): Promise<void> {
  await db.update(activities).set({ deletedAt: new Date() }).where(eq(activities.id, id));
}

export async function getActivityByExternalId(db: Db, externalId: string): Promise<Activity | null> {
  const rows = await db.select().from(activities).where(eq(activities.externalId, externalId)).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/db/repositories/activities.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implementa repositorio de activities con detección de conflictos"
```

---

## Fase 4 — Autenticación del administrador

### Task 9: Auth.js con Google OAuth y captura del refresh_token

**Files:**
- Create: `auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/crypto/token-cipher.ts`
- Test: `lib/crypto/token-cipher.test.ts`
- Create: `middleware.ts`

**Interfaces:**
- Consumes: `upsertAppConfig` de Task 7, `db` de `lib/db/client.ts`.
- Produces: `encryptToken(plain: string): string`, `decryptToken(cipher: string): string` (usados por Task 10 y por cualquier lectura futura del refresh_token); `auth()` helper de NextAuth exportado desde `auth.ts` para proteger rutas `/panel/*`.

- [ ] **Step 1: Instalar dependencias**

```bash
pnpm add next-auth@beta
```

- [ ] **Step 2: Escribir test fallido para el cifrado en `lib/crypto/token-cipher.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "./token-cipher";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
});

describe("token-cipher", () => {
  it("cifra y descifra un token, recuperando el valor original", () => {
    const original = "ya29.a0AfH6SMB_example_refresh_token";
    const cipher = encryptToken(original);
    expect(cipher).not.toBe(original);
    expect(decryptToken(cipher)).toBe(original);
  });

  it("genera un cifrado distinto cada vez (IV aleatorio) para el mismo input", () => {
    const original = "same-token";
    const cipher1 = encryptToken(original);
    const cipher2 = encryptToken(original);
    expect(cipher1).not.toBe(cipher2);
    expect(decryptToken(cipher1)).toBe(original);
    expect(decryptToken(cipher2)).toBe(original);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `pnpm vitest run lib/crypto/token-cipher.test.ts`
Expected: FAIL — "Cannot find module './token-cipher'"

- [ ] **Step 4: Implementar `lib/crypto/token-cipher.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY debe estar definida con exactamente 32 caracteres");
  }
  return Buffer.from(key, "utf-8");
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptToken(cipherText: string): string {
  const raw = Buffer.from(cipherText, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf-8");
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm vitest run lib/crypto/token-cipher.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Crear `auth.ts` con el proveedor Google y captura del refresh_token**

```typescript
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db/client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, user }) {
      if (account?.refresh_token) {
        await upsertAppConfig(db, {
          googleRefreshToken: encryptToken(account.refresh_token),
          adminEmail: user.email ?? undefined,
        });
      }
      return true;
    },
  },
});
```

- [ ] **Step 7: Crear el route handler `app/api/auth/[...nextauth]/route.ts`**

```typescript
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 8: Crear `middleware.ts` protegiendo `/panel`**

```typescript
export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/panel/:path*"],
};
```

- [ ] **Step 9: Verificar compilación de TypeScript**

Run: `pnpm tsc --noEmit`
Expected: sin errores relacionados a `auth.ts`, `middleware.ts` o `token-cipher.ts`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: configura Auth.js con Google OAuth y cifrado de refresh_token"
```

---

## Fase 5 — Cliente de Google Calendar

### Task 10: Wrapper sobre la API de Google Calendar

**Files:**
- Create: `lib/google-calendar/client.ts`
- Test: `lib/google-calendar/client.test.ts`

**Interfaces:**
- Consumes: `decryptToken` de Task 9, `AppConfig` de `lib/db/schema.ts`.
- Produces: `createGoogleCalendarClient(config: { calendarId: string; refreshToken: string }): GoogleCalendarClient` donde `GoogleCalendarClient` expone `insertEvent(input: EventInput): Promise<{ googleEventId: string }>`, `updateEvent(googleEventId: string, input: EventInput): Promise<void>`, `deleteEvent(googleEventId: string): Promise<void>`, `listEvents(syncToken?: string): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string }>`. `EventInput = { title: string; description?: string; location?: string; start: Date; end: Date; timezone: string }`. Usado por Tasks 11, 12, 13.

- [ ] **Step 1: Instalar dependencias**

```bash
pnpm add googleapis
```

- [ ] **Step 2: Escribir tests fallidos en `lib/google-calendar/client.test.ts`, mockeando `googleapis`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const listMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    calendar: vi.fn().mockImplementation(() => ({
      events: {
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
        list: listMock,
      },
    })),
  },
}));

import { createGoogleCalendarClient } from "./client";

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  listMock.mockReset();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

describe("GoogleCalendarClient", () => {
  const config = { calendarId: "primary", refreshToken: "refresh-token" };

  it("crea un evento con los 3 reminders nativos", async () => {
    insertMock.mockResolvedValue({ data: { id: "google-evt-1" } });
    const client = createGoogleCalendarClient(config);

    const result = await client.insertEvent({
      title: "Partido programado",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:30:00Z"),
      timezone: "America/Santiago",
    });

    expect(result.googleEventId).toBe("google-evt-1");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({
          summary: "Partido programado",
          reminders: {
            useDefault: false,
            overrides: [
              { method: "email", minutes: 24 * 60 },
              { method: "email", minutes: 30 },
              { method: "email", minutes: 5 },
            ],
          },
        }),
      })
    );
  });

  it("actualiza un evento existente", async () => {
    updateMock.mockResolvedValue({ data: { id: "google-evt-1" } });
    const client = createGoogleCalendarClient(config);

    await client.updateEvent("google-evt-1", {
      title: "Partido reprogramado",
      start: new Date("2026-08-21T15:00:00Z"),
      end: new Date("2026-08-21T17:00:00Z"),
      timezone: "America/Santiago",
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary", eventId: "google-evt-1" })
    );
  });

  it("elimina un evento existente", async () => {
    deleteMock.mockResolvedValue({});
    const client = createGoogleCalendarClient(config);

    await client.deleteEvent("google-evt-1");

    expect(deleteMock).toHaveBeenCalledWith({ calendarId: "primary", eventId: "google-evt-1" });
  });

  it("lista eventos usando syncToken y retorna el nextSyncToken", async () => {
    listMock.mockResolvedValue({
      data: { items: [{ id: "evt-1", status: "confirmed" }], nextSyncToken: "token-abc" },
    });
    const client = createGoogleCalendarClient(config);

    const result = await client.listEvents("previous-token");

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary", syncToken: "previous-token" })
    );
    expect(result.nextSyncToken).toBe("token-abc");
    expect(result.events).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que fallan**

Run: `pnpm vitest run lib/google-calendar/client.test.ts`
Expected: FAIL — "Cannot find module './client'"

- [ ] **Step 4: Implementar `lib/google-calendar/client.ts`**

```typescript
import { google } from "googleapis";

export interface EventInput {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

export interface GoogleCalendarClient {
  insertEvent(input: EventInput): Promise<{ googleEventId: string }>;
  updateEvent(googleEventId: string, input: EventInput): Promise<void>;
  deleteEvent(googleEventId: string): Promise<void>;
  listEvents(syncToken?: string): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string }>;
}

const REMINDER_OVERRIDES = [
  { method: "email" as const, minutes: 24 * 60 },
  { method: "email" as const, minutes: 30 },
  { method: "email" as const, minutes: 5 },
];

function toEventRequestBody(input: EventInput) {
  return {
    summary: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    reminders: {
      useDefault: false,
      overrides: REMINDER_OVERRIDES,
    },
  };
}

export function createGoogleCalendarClient(config: {
  calendarId: string;
  refreshToken: string;
}): GoogleCalendarClient {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  return {
    async insertEvent(input) {
      const response = await calendar.events.insert({
        calendarId: config.calendarId,
        requestBody: toEventRequestBody(input),
      });
      return { googleEventId: response.data.id! };
    },

    async updateEvent(googleEventId, input) {
      await calendar.events.update({
        calendarId: config.calendarId,
        eventId: googleEventId,
        requestBody: toEventRequestBody(input),
      });
    },

    async deleteEvent(googleEventId) {
      await calendar.events.delete({
        calendarId: config.calendarId,
        eventId: googleEventId,
      });
    },

    async listEvents(syncToken) {
      const response = await calendar.events.list({
        calendarId: config.calendarId,
        syncToken,
      });
      return {
        events: (response.data.items ?? []) as GoogleCalendarEvent[],
        nextSyncToken: response.data.nextSyncToken ?? "",
      };
    },
  };
}
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/google-calendar/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implementa cliente de Google Calendar con reminders nativos"
```

---

## Fase 6 — Server Actions

### Task 11: Server Action de registro manual de actividad (con validación y sync)

**Files:**
- Create: `lib/actions/create-manual-activity.ts`
- Test: `lib/actions/create-manual-activity.test.ts`

**Interfaces:**
- Consumes: `validateTimeRange` (Task 6), `findConflicts`/`createActivity`/`updateActivitySyncStatus` (Task 8), `colorForStatus` (Task 5), `getAppConfig` (Task 7), `decryptToken` (Task 9), `createGoogleCalendarClient` (Task 10).
- Produces: `createManualActivity(db, googleClientFactory, input: CreateManualActivityInput): Promise<CreateManualActivityResult>` donde `CreateManualActivityInput = { title: string; activityType: string; start: Date; end: Date; description?: string; location?: string; confirmDespiteConflict?: boolean }` y `CreateManualActivityResult = { status: "created"; activity: Activity } | { status: "conflict"; conflicts: Activity[] } | { status: "invalid"; reason: string }`. `googleClientFactory` es una función `(config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient` inyectable para poder mockearla en tests (en producción será `createGoogleCalendarClient`). Usado por la UI del panel (Task 14) vía un Server Action real que envuelve esta función.

- [ ] **Step 1: Escribir tests fallidos en `lib/actions/create-manual-activity.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { createManualActivity } from "./create-manual-activity";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

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

describe("createManualActivity", () => {
  it("rechaza cuando el rango horario es inválido", async () => {
    const googleClient = makeFakeGoogleClient();
    const result = await createManualActivity(db, () => googleClient, {
      title: "Test",
      activityType: "Otro",
      start: new Date("2026-08-20T11:00:00Z"),
      end: new Date("2026-08-20T10:00:00Z"),
    });
    expect(result.status).toBe("invalid");
  });

  it("crea la actividad, la sincroniza con Google y marca synced", async () => {
    const googleClient = makeFakeGoogleClient();
    const result = await createManualActivity(db, () => googleClient, {
      title: "Partido programado",
      activityType: "Partido",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:30:00Z"),
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.status).toBe("programada");
      expect(result.activity.color).toBe("azul");
      expect(result.activity.syncStatus).toBe("synced");
      expect(result.activity.googleEventId).toBe("google-evt-1");
    }
    expect(googleClient.insertEvent).toHaveBeenCalledOnce();
  });

  it("bloquea el guardado cuando hay conflicto y la política es 'block'", async () => {
    const googleClient = makeFakeGoogleClient();
    await createManualActivity(db, () => googleClient, {
      title: "Actividad existente",
      activityType: "Otro",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:00:00Z"),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad conflictiva",
      activityType: "Otro",
      start: new Date("2026-08-20T16:00:00Z"),
      end: new Date("2026-08-20T18:00:00Z"),
    });

    expect(result.status).toBe("conflict");
  });

  it("permite guardar con conflicto si confirmDespiteConflict=true y la política es 'block'", async () => {
    const googleClient = makeFakeGoogleClient();
    await createManualActivity(db, () => googleClient, {
      title: "Actividad existente",
      activityType: "Otro",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:00:00Z"),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad conflictiva confirmada",
      activityType: "Otro",
      start: new Date("2026-08-20T16:00:00Z"),
      end: new Date("2026-08-20T18:00:00Z"),
      confirmDespiteConflict: true,
    });

    expect(result.status).toBe("created");
  });

  it("marca sync_status=error cuando falla la llamada a Google, sin perder la actividad", async () => {
    const googleClient = makeFakeGoogleClient({
      insertEvent: vi.fn().mockRejectedValue(new Error("Google API unavailable")),
    });

    const result = await createManualActivity(db, () => googleClient, {
      title: "Actividad con falla de sync",
      activityType: "Otro",
      start: new Date("2026-08-22T10:00:00Z"),
      end: new Date("2026-08-22T11:00:00Z"),
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.activity.syncStatus).toBe("error");
      expect(result.activity.syncErrorMessage).toContain("Google API unavailable");
    }
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm vitest run lib/actions/create-manual-activity.test.ts`
Expected: FAIL — "Cannot find module './create-manual-activity'"

- [ ] **Step 3: Implementar `lib/actions/create-manual-activity.ts`**

```typescript
import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity, findConflicts, updateActivitySyncStatus } from "@/lib/db/repositories/activities";
import { validateTimeRange } from "@/lib/scheduling/validate-range";
import { colorForStatus } from "@/lib/scheduling/color";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export interface CreateManualActivityInput {
  title: string;
  activityType: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  confirmDespiteConflict?: boolean;
}

export type CreateManualActivityResult =
  | { status: "created"; activity: Activity }
  | { status: "conflict"; conflicts: Activity[] }
  | { status: "invalid"; reason: string };

export async function createManualActivity(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  input: CreateManualActivityInput
): Promise<CreateManualActivityResult> {
  const rangeValidation = validateTimeRange({ start: input.start, end: input.end });
  if (!rangeValidation.valid) {
    return { status: "invalid", reason: rangeValidation.reason };
  }

  const config = await getAppConfig(db);
  const conflicts = await findConflicts(db, { start: input.start, end: input.end });

  if (conflicts.length > 0) {
    const policy = config?.conflictPolicy ?? "block";
    if (policy === "block" && !input.confirmDespiteConflict) {
      return { status: "conflict", conflicts };
    }
  }

  const status = "programada" as const;
  const activity = await createActivity(db, {
    source: "manual",
    title: input.title,
    activityType: input.activityType,
    status,
    color: colorForStatus(status),
    startDatetime: input.start,
    endDatetime: input.end,
    description: input.description,
    location: input.location,
    createdBy: "admin",
    syncStatus: "pending",
  });

  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: "No hay Calendar ID o token de Google configurado",
    });
    return { status: "created", activity: updated };
  }

  try {
    const googleClient = googleClientFactory({
      calendarId: config.googleCalendarId,
      refreshToken: decryptToken(config.googleRefreshToken),
    });
    const { googleEventId } = await googleClient.insertEvent({
      title: activity.title,
      description: activity.description ?? undefined,
      location: activity.location ?? undefined,
      start: activity.startDatetime,
      end: activity.endDatetime,
      timezone: config.timezone,
    });
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "synced",
      googleEventId,
      remindersConfigured: true,
    });
    return { status: "created", activity: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
    const updated = await updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: message,
    });
    return { status: "created", activity: updated };
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/actions/create-manual-activity.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implementa Server Action de registro manual con validación y sync a Google"
```

---

### Task 12: Server Action de registro de Bitácora (sin sync a Google)

**Files:**
- Create: `lib/actions/create-bitacora-activity.ts`
- Test: `lib/actions/create-bitacora-activity.test.ts`

**Interfaces:**
- Consumes: `createActivity`/`getActivityByExternalId` (Task 8), `colorForStatus` (Task 5).
- Produces: `createBitacoraActivity(db, input: CreateBitacoraActivityInput): Promise<CreateBitacoraActivityResult>` donde `CreateBitacoraActivityInput = { title: string; activityType: string; start: Date; end: Date; externalId: string; description?: string }` y `CreateBitacoraActivityResult = { status: "created"; activity: Activity } | { status: "duplicate"; activity: Activity }`. Usado por la UI del panel (Task 14).

- [ ] **Step 1: Escribir tests fallidos en `lib/actions/create-bitacora-activity.test.ts`**

```typescript
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
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `pnpm vitest run lib/actions/create-bitacora-activity.test.ts`
Expected: FAIL — "Cannot find module './create-bitacora-activity'"

- [ ] **Step 3: Implementar `lib/actions/create-bitacora-activity.ts`**

Nota: `sync_status` no aplica realmente a la Bitácora (no sincroniza a Google), pero el enum de la tabla exige un valor; se usa `synced` como "no requiere sincronización" para no introducir un cuarto estado no contemplado en la spec.

```typescript
import type { db as dbType } from "@/lib/db/client";
import { createActivity, getActivityByExternalId } from "@/lib/db/repositories/activities";
import { colorForStatus } from "@/lib/scheduling/color";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;

export interface CreateBitacoraActivityInput {
  title: string;
  activityType: string;
  start: Date;
  end: Date;
  externalId: string;
  description?: string;
}

export type CreateBitacoraActivityResult =
  | { status: "created"; activity: Activity }
  | { status: "duplicate"; activity: Activity };

export async function createBitacoraActivity(
  db: Db,
  input: CreateBitacoraActivityInput
): Promise<CreateBitacoraActivityResult> {
  const existing = await getActivityByExternalId(db, input.externalId);
  if (existing) {
    return { status: "duplicate", activity: existing };
  }

  const status = "ejecutada" as const;
  const activity = await createActivity(db, {
    source: "bitacora",
    externalId: input.externalId,
    title: input.title,
    activityType: input.activityType,
    status,
    color: colorForStatus(status),
    startDatetime: input.start,
    endDatetime: input.end,
    description: input.description,
    createdBy: "bitacora",
    syncStatus: "synced",
  });

  return { status: "created", activity };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/actions/create-bitacora-activity.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implementa Server Action de registro de Bitácora con prevención de duplicados"
```

---

### Task 13: Sincronización entrante desde Google Calendar (para el cron)

**Files:**
- Create: `lib/actions/sync-from-google.ts`
- Test: `lib/actions/sync-from-google.test.ts`

**Interfaces:**
- Consumes: `getAppConfig`/`upsertAppConfig` (Task 7), `createActivity`/`softDeleteActivity` (Task 8, más una función nueva `upsertActivityByGoogleEventId` añadida en este task), `decryptToken` (Task 9), `GoogleCalendarClient` (Task 10), `colorForStatus` (Task 5).
- Produces: `syncFromGoogle(db, googleClientFactory): Promise<{ created: number; updated: number; deleted: number }>`. Usado por el endpoint de cron (Task 15). Maneja el caso de `syncToken` expirado (error 410 de Google, spec §7) haciendo una carga completa y reiniciando el token, sin intervención manual.

- [ ] **Step 1: Agregar `upsertActivityByGoogleEventId` al repositorio de activities**

Modificar `lib/db/repositories/activities.ts`, agregando al final del archivo:

```typescript
export async function upsertActivityByGoogleEventId(
  db: Db,
  googleEventId: string,
  data: Omit<NewActivity, "googleEventId">
): Promise<Activity> {
  const [existing] = await db
    .select()
    .from(activities)
    .where(eq(activities.googleEventId, googleEventId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(activities)
      .set({ ...data, googleEventId, updatedAt: new Date() })
      .where(eq(activities.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(activities)
    .values({ ...data, googleEventId })
    .returning();
  return created;
}
```

- [ ] **Step 2: Escribir test fallido para la actualización del repositorio en `lib/db/repositories/activities.test.ts`**

Agregar al final del `describe("activities repository", ...)`:

```typescript
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
```

Agregar el import correspondiente en la parte superior del archivo de test:

```typescript
import {
  createActivity,
  listActivitiesInRange,
  findConflicts,
  updateActivitySyncStatus,
  softDeleteActivity,
  getActivityByExternalId,
  upsertActivityByGoogleEventId,
} from "./activities";
```

- [ ] **Step 3: Ejecutar y verificar que este test falla, luego pasa**

Run: `pnpm vitest run lib/db/repositories/activities.test.ts`
Expected: primero FAIL ("upsertActivityByGoogleEventId is not a function" si Step 1 no se hizo antes; dado que Step 1 ya se aplicó, debería compilar) — ejecutar y confirmar PASS (9 tests en total).

- [ ] **Step 4: Commit del cambio al repositorio**

```bash
git add -A
git commit -m "feat: agrega upsert por google_event_id al repositorio de activities"
```

- [ ] **Step 5: Escribir tests fallidos en `lib/actions/sync-from-google.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig, getAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { syncFromGoogle } from "./sync-from-google";
import type { GoogleCalendarClient, GoogleCalendarEvent } from "@/lib/google-calendar/client";

const db = createTestDb();

function makeFakeGoogleClient(events: GoogleCalendarEvent[], nextSyncToken = "token-2"): GoogleCalendarClient {
  return {
    insertEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ events, nextSyncToken }),
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

describe("syncFromGoogle", () => {
  it("crea actividades nuevas provenientes de eventos confirmados de Google", async () => {
    const events: GoogleCalendarEvent[] = [
      {
        id: "google-evt-1",
        status: "confirmed",
        summary: "Reunión externa",
        start: { dateTime: "2026-08-25T10:00:00Z" },
        end: { dateTime: "2026-08-25T11:00:00Z" },
      },
    ];
    const googleClient = makeFakeGoogleClient(events);

    const result = await syncFromGoogle(db, () => googleClient);

    expect(result.created).toBe(1);
  });

  it("marca como eliminadas las actividades cuyo evento en Google tiene status 'cancelled'", async () => {
    const firstPass = makeFakeGoogleClient([
      {
        id: "google-evt-2",
        status: "confirmed",
        summary: "Reunión a cancelar",
        start: { dateTime: "2026-08-26T10:00:00Z" },
        end: { dateTime: "2026-08-26T11:00:00Z" },
      },
    ]);
    await syncFromGoogle(db, () => firstPass);

    const secondPass = makeFakeGoogleClient([
      { id: "google-evt-2", status: "cancelled" },
    ]);
    const result = await syncFromGoogle(db, () => secondPass);

    expect(result.deleted).toBe(1);
  });

  it("guarda el nextSyncToken en app_config tras sincronizar", async () => {
    const googleClient = makeFakeGoogleClient([], "new-sync-token");
    await syncFromGoogle(db, () => googleClient);

    const config = await getAppConfig(db);
    expect(config?.googleSyncToken).toBe("new-sync-token");
  });

  it("cuando el syncToken expiró (error 410), reintenta sin syncToken y reinicia el token guardado", async () => {
    await upsertAppConfig(db, { googleSyncToken: "expired-token" });

    let callCount = 0;
    const googleClient: GoogleCalendarClient = {
      insertEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      listEvents: vi.fn().mockImplementation(async (syncToken?: string) => {
        callCount += 1;
        if (syncToken === "expired-token") {
          const error = new Error("Sync token is no longer valid") as Error & { code?: number };
          error.code = 410;
          throw error;
        }
        return { events: [], nextSyncToken: "fresh-token" };
      }),
    };

    const result = await syncFromGoogle(db, () => googleClient);

    expect(callCount).toBe(2);
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0 });
    const config = await getAppConfig(db);
    expect(config?.googleSyncToken).toBe("fresh-token");
  });
});
```

- [ ] **Step 6: Ejecutar y verificar que fallan**

Run: `pnpm vitest run lib/actions/sync-from-google.test.ts`
Expected: FAIL — "Cannot find module './sync-from-google'"

- [ ] **Step 7: Implementar `lib/actions/sync-from-google.ts`**

```typescript
import type { db as dbType } from "@/lib/db/client";
import { getAppConfig, upsertAppConfig } from "@/lib/db/repositories/app-config";
import { upsertActivityByGoogleEventId, softDeleteActivity } from "@/lib/db/repositories/activities";
import { db as dbSchemaHelper } from "@/lib/db/client";
import { activities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { colorForStatus } from "@/lib/scheduling/color";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export interface SyncFromGoogleResult {
  created: number;
  updated: number;
  deleted: number;
}

export async function syncFromGoogle(
  db: Db,
  googleClientFactory: GoogleClientFactory
): Promise<SyncFromGoogleResult> {
  const config = await getAppConfig(db);
  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    return { created: 0, updated: 0, deleted: 0 };
  }

  const googleClient = googleClientFactory({
    calendarId: config.googleCalendarId,
    refreshToken: decryptToken(config.googleRefreshToken),
  });

  let listResult: { events: Awaited<ReturnType<GoogleCalendarClient["listEvents"]>>["events"]; nextSyncToken: string };
  try {
    listResult = await googleClient.listEvents(config.googleSyncToken ?? undefined);
  } catch (error) {
    const is410 = (error as { code?: number })?.code === 410;
    if (!is410) throw error;
    // syncToken expirado: carga completa sin syncToken y se reinicia el token (spec §7)
    listResult = await googleClient.listEvents(undefined);
  }
  const { events, nextSyncToken } = listResult;

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const event of events) {
    if (event.status === "cancelled") {
      const [existing] = await db.select().from(activities).where(eq(activities.googleEventId, event.id)).limit(1);
      if (existing) {
        await softDeleteActivity(db, existing.id);
        deleted += 1;
      }
      continue;
    }

    if (!event.start?.dateTime || !event.end?.dateTime) {
      continue;
    }

    const [existingBefore] = await db.select().from(activities).where(eq(activities.googleEventId, event.id)).limit(1);
    const status = "externa" as const;

    await upsertActivityByGoogleEventId(db, event.id, {
      source: "google_calendar",
      title: event.summary ?? "(Sin título)",
      activityType: "Evento de Google Calendar",
      status,
      color: colorForStatus(status),
      startDatetime: new Date(event.start.dateTime),
      endDatetime: new Date(event.end.dateTime),
      description: event.description,
      location: event.location,
      createdBy: "admin",
      syncStatus: "synced",
    });

    if (existingBefore) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  await upsertAppConfig(db, { googleSyncToken: nextSyncToken });

  return { created, updated, deleted };
}
```

- [ ] **Step 8: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/actions/sync-from-google.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: implementa sincronización entrante desde Google Calendar"
```

---

### Task 14: Endpoint de cron para sincronización periódica

**Files:**
- Create: `app/api/cron/sync-google/route.ts`
- Create: `vercel.json`
- Test: `app/api/cron/sync-google/route.test.ts`

**Interfaces:**
- Consumes: `syncFromGoogle` (Task 13), `db` de `lib/db/client.ts`, `createGoogleCalendarClient` (Task 10).
- Produces: endpoint `GET /api/cron/sync-google` protegido por header `Authorization: Bearer $CRON_SECRET`.

- [ ] **Step 1: Escribir test fallido en `app/api/cron/sync-google/route.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/actions/sync-from-google", () => ({
  syncFromGoogle: vi.fn().mockResolvedValue({ created: 1, updated: 0, deleted: 0 }),
}));

import { GET } from "./route";

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

describe("GET /api/cron/sync-google", () => {
  it("rechaza la petición sin el header de autorización correcto", async () => {
    const request = new Request("http://localhost/api/cron/sync-google");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("ejecuta la sincronización cuando el header de autorización es correcto", async () => {
    const request = new Request("http://localhost/api/cron/sync-google", {
      headers: { Authorization: "Bearer test-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ created: 1, updated: 0, deleted: 0 });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm vitest run app/api/cron/sync-google/route.test.ts`
Expected: FAIL — "Cannot find module './route'"

- [ ] **Step 3: Implementar `app/api/cron/sync-google/route.ts`**

```typescript
import { db } from "@/lib/db/client";
import { syncFromGoogle } from "@/lib/actions/sync-from-google";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await syncFromGoogle(db, createGoogleCalendarClient);
  return Response.json(result);
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `pnpm vitest run app/api/cron/sync-google/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Crear `vercel.json` con la programación del cron**

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-google",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] **Step 6: Agregar `CRON_SECRET` a `.env.example`**

Añadir la línea `CRON_SECRET=""` al final de `.env.example`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: agrega endpoint de cron para sincronización periódica con Google Calendar"
```

---

## Fase 7 — UI del panel privado

### Task 15: Layout del panel y página de login

**Files:**
- Create: `app/panel/layout.tsx`
- Create: `app/login/page.tsx`
- Create: `app/panel/page.tsx` (placeholder que redirige a `/panel/calendario`, completado en Task 16)

**Interfaces:**
- Consumes: `auth()` y `signIn`/`signOut` de `auth.ts` (Task 9).
- Produces: layout de `/panel/*` con navegación básica (Calendario, Bitácora, Configuración, Cerrar sesión).

- [ ] **Step 1: Crear `app/login/page.tsx`**

```tsx
import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="rounded-lg bg-white p-8 shadow-md text-center">
        <h1 className="mb-4 text-xl font-semibold">Calendario Operacional</h1>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/panel/calendario" });
          }}
        >
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Iniciar sesión con Google
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Crear `app/panel/layout.tsx`**

```tsx
import Link from "next/link";
import { signOut } from "@/auth";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex gap-6">
          <Link href="/panel/calendario" className="font-medium hover:text-blue-600">
            Calendario
          </Link>
          <Link href="/panel/bitacora" className="font-medium hover:text-blue-600">
            Bitácora
          </Link>
          <Link href="/panel/config" className="font-medium hover:text-blue-600">
            Configuración
          </Link>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm text-gray-500 hover:text-gray-700">
            Cerrar sesión
          </button>
        </form>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Crear `app/panel/page.tsx` como redirect**

```tsx
import { redirect } from "next/navigation";

export default function PanelIndexPage() {
  redirect("/panel/calendario");
}
```

- [ ] **Step 4: Verificar compilación**

Run: `pnpm tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: agrega layout del panel privado y página de login"
```

---

### Task 16: Vista de calendario con leyenda de colores

**Files:**
- Create: `app/panel/calendario/page.tsx`
- Create: `app/panel/calendario/calendar-view.tsx`
- Create: `lib/db/repositories/activities-view.ts`
- Test: `lib/db/repositories/activities-view.test.ts`

**Interfaces:**
- Consumes: `listActivitiesInRange` (Task 8), `Activity` type de `lib/db/schema.ts`.
- Produces: `toCalendarEvents(activities: Activity[]): CalendarEvent[]` donde `CalendarEvent = { id: string; title: string; start: Date; end: Date; color: string; syncStatus: "synced" | "pending" | "error" }`. Componente `CalendarView` que renderiza `react-big-calendar` con eventos coloreados y leyenda fija.

- [ ] **Step 1: Instalar `react-big-calendar` y `date-fns`**

```bash
pnpm add react-big-calendar date-fns
pnpm add -D @types/react-big-calendar
```

- [ ] **Step 2: Escribir test fallido en `lib/db/repositories/activities-view.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { toCalendarEvents } from "./activities-view";
import type { Activity } from "../schema";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    source: "manual",
    externalId: null,
    title: "Partido programado",
    activityType: "Partido",
    status: "programada",
    color: "azul",
    startDatetime: new Date("2026-08-20T15:00:00Z"),
    endDatetime: new Date("2026-08-20T17:30:00Z"),
    description: null,
    location: null,
    syncStatus: "synced",
    syncErrorMessage: null,
    createdBy: "admin",
    googleEventId: "google-evt-1",
    remindersConfigured: true,
    bookingToken: null,
    bookerName: null,
    bookerEmail: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("toCalendarEvents", () => {
  it("mapea una actividad al formato de evento de calendario", () => {
    const [event] = toCalendarEvents([makeActivity()]);
    expect(event).toEqual({
      id: "act-1",
      title: "Partido programado",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:30:00Z"),
      color: "azul",
      syncStatus: "synced",
    });
  });

  it("mapea múltiples actividades preservando el orden", () => {
    const activities = [
      makeActivity({ id: "act-1" }),
      makeActivity({ id: "act-2", title: "Otra actividad", color: "verde", status: "ejecutada" }),
    ];
    const events = toCalendarEvents(activities);
    expect(events).toHaveLength(2);
    expect(events[1].title).toBe("Otra actividad");
    expect(events[1].color).toBe("verde");
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `pnpm vitest run lib/db/repositories/activities-view.test.ts`
Expected: FAIL — "Cannot find module './activities-view'"

- [ ] **Step 4: Implementar `lib/db/repositories/activities-view.ts`**

```typescript
import type { Activity } from "../schema";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
  syncStatus: "synced" | "pending" | "error";
}

export function toCalendarEvents(activities: Activity[]): CalendarEvent[] {
  return activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
    start: activity.startDatetime,
    end: activity.endDatetime,
    color: activity.color,
    syncStatus: activity.syncStatus,
  }));
}
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

Run: `pnpm vitest run lib/db/repositories/activities-view.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Crear el componente cliente `app/panel/calendario/calendar-view.tsx`**

```tsx
"use client";

import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import format from "date-fns/format";
import parse from "date-fns/parse";
import startOfWeek from "date-fns/startOfWeek";
import getDay from "date-fns/getDay";
import es from "date-fns/locale/es";
import "react-big-calendar/lib/css/react-big-calendar.css";
import type { CalendarEvent } from "@/lib/db/repositories/activities-view";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: es }),
  getDay,
  locales: { es },
});

const COLOR_HEX: Record<string, string> = {
  verde: "#16a34a",
  azul: "#2563eb",
  naranjo: "#ea580c",
  plomo: "#6b7280",
};

const LEGEND_ITEMS: { label: string; color: string }[] = [
  { label: "Ejecutada", color: "verde" },
  { label: "Programada", color: "azul" },
  { label: "Pendiente", color: "naranjo" },
  { label: "Externa (Google)", color: "plomo" },
];

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  return (
    <div>
      <div className="mb-4 flex gap-4">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: COLOR_HEX[item.color] }}
            />
            {item.label}
          </div>
        ))}
      </div>
      <div style={{ height: 700 }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          eventPropGetter={(event: CalendarEvent) => ({
            style: {
              backgroundColor: COLOR_HEX[event.color] ?? "#6b7280",
              opacity: event.syncStatus === "error" ? 0.6 : 1,
              border: event.syncStatus === "error" ? "2px dashed red" : undefined,
            },
          })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Crear la página `app/panel/calendario/page.tsx`**

```tsx
import { db } from "@/lib/db/client";
import { listActivitiesInRange } from "@/lib/db/repositories/activities";
import { toCalendarEvents } from "@/lib/db/repositories/activities-view";
import { CalendarView } from "./calendar-view";

export default async function CalendarioPage() {
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const activities = await listActivitiesInRange(db, { start: rangeStart, end: rangeEnd });
  const events = toCalendarEvents(activities);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Calendario</h1>
      <CalendarView events={events} />
    </div>
  );
}
```

- [ ] **Step 8: Verificar compilación**

Run: `pnpm tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: agrega vista de calendario con leyenda de colores en el panel"
```

---

### Task 17: Formulario de nueva actividad manual (UI)

**Files:**
- Create: `app/panel/calendario/new-activity-modal.tsx`
- Create: `app/actions/manual-activity.ts`
- Modify: `app/panel/calendario/page.tsx`
- Modify: `app/panel/calendario/calendar-view.tsx`

**Interfaces:**
- Consumes: `createManualActivity` (Task 11), `createGoogleCalendarClient` (Task 10), `db` de `lib/db/client.ts`.
- Produces: Server Action `submitManualActivity(formData: FormData): Promise<{ status: "created" | "conflict" | "invalid"; message?: string }>` expuesto para el formulario cliente; componente `NewActivityModal`.

- [ ] **Step 1: Crear el Server Action `app/actions/manual-activity.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { createManualActivity } from "@/lib/actions/create-manual-activity";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export interface SubmitManualActivityState {
  status: "idle" | "created" | "conflict" | "invalid";
  message?: string;
}

export async function submitManualActivity(
  _prevState: SubmitManualActivityState,
  formData: FormData
): Promise<SubmitManualActivityState> {
  const title = String(formData.get("title") ?? "");
  const activityType = String(formData.get("activityType") ?? "");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));
  const description = formData.get("description") ? String(formData.get("description")) : undefined;
  const location = formData.get("location") ? String(formData.get("location")) : undefined;
  const confirmDespiteConflict = formData.get("confirmDespiteConflict") === "true";

  const result = await createManualActivity(db, createGoogleCalendarClient, {
    title,
    activityType,
    start,
    end,
    description,
    location,
    confirmDespiteConflict,
  });

  if (result.status === "created") {
    revalidatePath("/panel/calendario");
    return { status: "created" };
  }

  if (result.status === "conflict") {
    return { status: "conflict", message: "El horario elegido se superpone con otra actividad." };
  }

  return { status: "invalid", message: result.reason };
}
```

- [ ] **Step 2: Crear `app/panel/calendario/new-activity-modal.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { submitManualActivity, type SubmitManualActivityState } from "@/app/actions/manual-activity";

const initialState: SubmitManualActivityState = { status: "idle" };

export function NewActivityModal() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(submitManualActivity, initialState);

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Nueva actividad
      </button>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Nueva actividad</h2>
            <form action={formAction} className="space-y-3">
              <input name="title" placeholder="Título" required className="w-full rounded border p-2" />
              <input
                name="activityType"
                placeholder="Tipo de actividad (o escribe 'Otro')"
                required
                className="w-full rounded border p-2"
              />
              <label className="block text-sm">Inicio</label>
              <input name="start" type="datetime-local" required className="w-full rounded border p-2" />
              <label className="block text-sm">Término</label>
              <input name="end" type="datetime-local" required className="w-full rounded border p-2" />
              <textarea name="description" placeholder="Descripción" className="w-full rounded border p-2" />
              <input name="location" placeholder="Ubicación (opcional)" className="w-full rounded border p-2" />

              {state.status === "conflict" && (
                <div className="rounded bg-orange-100 p-2 text-sm text-orange-800">
                  {state.message}
                  <input type="hidden" name="confirmDespiteConflict" value="true" />
                </div>
              )}
              {state.status === "invalid" && (
                <div className="rounded bg-red-100 p-2 text-sm text-red-800">{state.message}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm">
                  Cancelar
                </button>
                <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
                  {state.status === "conflict" ? "Guardar de todos modos" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Integrar el modal en `app/panel/calendario/page.tsx`**

Modificar el `return` para incluir el modal junto al título:

```tsx
import { db } from "@/lib/db/client";
import { listActivitiesInRange } from "@/lib/db/repositories/activities";
import { toCalendarEvents } from "@/lib/db/repositories/activities-view";
import { CalendarView } from "./calendar-view";
import { NewActivityModal } from "./new-activity-modal";

export default async function CalendarioPage() {
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const activities = await listActivitiesInRange(db, { start: rangeStart, end: rangeEnd });
  const events = toCalendarEvents(activities);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendario</h1>
        <NewActivityModal />
      </div>
      <CalendarView events={events} />
    </div>
  );
}
```

- [ ] **Step 4: Verificar compilación**

Run: `pnpm tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: agrega formulario de nueva actividad manual con manejo de conflictos en UI"
```

---

### Task 18: Formulario de registro de Bitácora (UI)

**Files:**
- Create: `app/panel/bitacora/page.tsx`
- Create: `app/actions/bitacora-activity.ts`

**Interfaces:**
- Consumes: `createBitacoraActivity` (Task 12), `db` de `lib/db/client.ts`.
- Produces: Server Action `submitBitacoraActivity`.

- [ ] **Step 1: Crear el Server Action `app/actions/bitacora-activity.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { db } from "@/lib/db/client";
import { createBitacoraActivity } from "@/lib/actions/create-bitacora-activity";

export interface SubmitBitacoraState {
  status: "idle" | "created" | "duplicate";
}

export async function submitBitacoraActivity(
  _prevState: SubmitBitacoraState,
  formData: FormData
): Promise<SubmitBitacoraState> {
  const title = String(formData.get("title") ?? "");
  const activityType = String(formData.get("activityType") ?? "");
  const start = new Date(String(formData.get("start")));
  const end = new Date(String(formData.get("end")));
  const externalId = String(formData.get("externalId") || randomUUID());

  const result = await createBitacoraActivity(db, {
    title,
    activityType,
    start,
    end,
    externalId,
  });

  revalidatePath("/panel/calendario");
  return { status: result.status };
}
```

- [ ] **Step 2: Crear `app/panel/bitacora/page.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { submitBitacoraActivity, type SubmitBitacoraState } from "@/app/actions/bitacora-activity";

const initialState: SubmitBitacoraState = { status: "idle" };

export default function BitacoraPage() {
  const [state, formAction] = useActionState(submitBitacoraActivity, initialState);

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Registrar actividad de Bitácora</h1>
      <form action={formAction} className="space-y-3">
        <input name="title" placeholder="Título (ej. Corte de pasto)" required className="w-full rounded border p-2" />
        <input name="activityType" placeholder="Tipo (ej. Mantenimiento)" required className="w-full rounded border p-2" />
        <label className="block text-sm">Inicio</label>
        <input name="start" type="datetime-local" required className="w-full rounded border p-2" />
        <label className="block text-sm">Término</label>
        <input name="end" type="datetime-local" required className="w-full rounded border p-2" />
        <input name="externalId" placeholder="ID único (opcional, se genera si se deja vacío)" className="w-full rounded border p-2" />

        {state.status === "duplicate" && (
          <div className="rounded bg-yellow-100 p-2 text-sm text-yellow-800">
            Ya existía un registro con ese ID; no se creó un duplicado.
          </div>
        )}
        {state.status === "created" && (
          <div className="rounded bg-green-100 p-2 text-sm text-green-800">Actividad registrada.</div>
        )}

        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Registrar
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verificar compilación**

Run: `pnpm tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: agrega formulario de registro de Bitácora en el panel"
```

---

### Task 19: Página de configuración (horario laboral, política de conflicto, Calendar ID, estado de conexión)

**Files:**
- Create: `app/panel/config/page.tsx`
- Create: `app/actions/app-config.ts`

**Interfaces:**
- Consumes: `getAppConfig`/`upsertAppConfig` (Task 7), `db` de `lib/db/client.ts`.
- Produces: Server Action `submitAppConfig`; página que muestra estado de conexión Google (conectado si `googleRefreshToken` no es null, requiere reconexión si es null).

- [ ] **Step 1: Crear el Server Action `app/actions/app-config.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";

export async function submitAppConfig(formData: FormData): Promise<void> {
  await upsertAppConfig(db, {
    workHoursStart: String(formData.get("workHoursStart")),
    workHoursEnd: String(formData.get("workHoursEnd")),
    conflictPolicy: formData.get("conflictPolicy") === "warn" ? "warn" : "block",
    googleCalendarId: String(formData.get("googleCalendarId") || ""),
  });
  revalidatePath("/panel/config");
}
```

- [ ] **Step 2: Crear `app/panel/config/page.tsx`**

```tsx
import { db } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { submitAppConfig } from "@/app/actions/app-config";
import { signIn } from "@/auth";

export default async function ConfigPage() {
  const config = await getAppConfig(db);
  const isConnected = Boolean(config?.googleRefreshToken);

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold">Configuración</h1>

      <div className="rounded border p-4">
        <p className="mb-2 text-sm font-medium">Conexión con Google Calendar</p>
        {isConnected ? (
          <p className="text-sm text-green-700">Conectado</p>
        ) : (
          <div>
            <p className="mb-2 text-sm text-red-700">Requiere reconexión</p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/panel/config" });
              }}
            >
              <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">
                Reconectar con Google
              </button>
            </form>
          </div>
        )}
      </div>

      <form action={submitAppConfig} className="space-y-3">
        <label className="block text-sm">Horario laboral - inicio</label>
        <input
          name="workHoursStart"
          defaultValue={config?.workHoursStart ?? "08:00"}
          className="w-full rounded border p-2"
        />
        <label className="block text-sm">Horario laboral - término</label>
        <input
          name="workHoursEnd"
          defaultValue={config?.workHoursEnd ?? "19:00"}
          className="w-full rounded border p-2"
        />
        <label className="block text-sm">Política de conflicto</label>
        <select name="conflictPolicy" defaultValue={config?.conflictPolicy ?? "block"} className="w-full rounded border p-2">
          <option value="block">Bloquear superposiciones</option>
          <option value="warn">Advertir y permitir confirmación</option>
        </select>
        <label className="block text-sm">Calendar ID de Google</label>
        <input
          name="googleCalendarId"
          defaultValue={config?.googleCalendarId ?? ""}
          placeholder="ej. tu-correo@gmail.com o ID del calendario"
          className="w-full rounded border p-2"
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Guardar configuración
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verificar compilación**

Run: `pnpm tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: agrega página de configuración del panel privado"
```

---

### Task 20: Botón de reintento de sincronización en actividades con error

**Files:**
- Create: `app/actions/retry-sync.ts`
- Test: `lib/actions/retry-sync-activity.test.ts`
- Create: `lib/actions/retry-sync-activity.ts`
- Modify: `app/panel/calendario/calendar-view.tsx`

**Interfaces:**
- Consumes: `getAppConfig` (Task 7), `updateActivitySyncStatus` (Task 8), `decryptToken` (Task 9), `GoogleCalendarClient` (Task 10).
- Produces: `retrySyncActivity(db, googleClientFactory, activity: Activity): Promise<Activity>`. Server Action `retrySync(activityId: string)` para uso desde la UI.

- [ ] **Step 1: Escribir test fallido en `lib/actions/retry-sync-activity.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, truncateAll } from "@/lib/db/test-client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { createActivity } from "@/lib/db/repositories/activities";
import { encryptToken } from "@/lib/crypto/token-cipher";
import { retrySyncActivity } from "./retry-sync-activity";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  await upsertAppConfig(db, {
    googleCalendarId: "primary",
    googleRefreshToken: encryptToken("refresh-token"),
    timezone: "America/Santiago",
  });
});

describe("retrySyncActivity", () => {
  it("reintenta sincronizar una actividad con sync_status=error y la marca synced si Google responde bien", async () => {
    const activity = await createActivity(db, {
      source: "manual",
      title: "Actividad con error",
      activityType: "Otro",
      status: "programada",
      color: "azul",
      startDatetime: new Date("2026-08-22T10:00:00Z"),
      endDatetime: new Date("2026-08-22T11:00:00Z"),
      createdBy: "admin",
      syncStatus: "error",
      syncErrorMessage: "fallo previo",
    });

    const googleClient: GoogleCalendarClient = {
      insertEvent: vi.fn().mockResolvedValue({ googleEventId: "google-evt-retry" }),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      listEvents: vi.fn(),
    };

    const updated = await retrySyncActivity(db, () => googleClient, activity);

    expect(updated.syncStatus).toBe("synced");
    expect(updated.googleEventId).toBe("google-evt-retry");
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm vitest run lib/actions/retry-sync-activity.test.ts`
Expected: FAIL — "Cannot find module './retry-sync-activity'"

- [ ] **Step 3: Implementar `lib/actions/retry-sync-activity.ts`**

```typescript
import type { db as dbType } from "@/lib/db/client";
import { getAppConfig } from "@/lib/db/repositories/app-config";
import { updateActivitySyncStatus } from "@/lib/db/repositories/activities";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Activity } from "@/lib/db/schema";

type Db = typeof dbType;
type GoogleClientFactory = (config: { calendarId: string; refreshToken: string }) => GoogleCalendarClient;

export async function retrySyncActivity(
  db: Db,
  googleClientFactory: GoogleClientFactory,
  activity: Activity
): Promise<Activity> {
  const config = await getAppConfig(db);

  if (!config?.googleCalendarId || !config.googleRefreshToken) {
    return updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: "No hay Calendar ID o token de Google configurado",
    });
  }

  try {
    const googleClient = googleClientFactory({
      calendarId: config.googleCalendarId,
      refreshToken: decryptToken(config.googleRefreshToken),
    });
    const { googleEventId } = await googleClient.insertEvent({
      title: activity.title,
      description: activity.description ?? undefined,
      location: activity.location ?? undefined,
      start: activity.startDatetime,
      end: activity.endDatetime,
      timezone: config.timezone,
    });
    return updateActivitySyncStatus(db, activity.id, {
      syncStatus: "synced",
      googleEventId,
      remindersConfigured: true,
      syncErrorMessage: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al sincronizar con Google";
    return updateActivitySyncStatus(db, activity.id, {
      syncStatus: "error",
      syncErrorMessage: message,
    });
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm vitest run lib/actions/retry-sync-activity.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Crear el Server Action de UI `app/actions/retry-sync.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities } from "@/lib/db/schema";
import { retrySyncActivity } from "@/lib/actions/retry-sync-activity";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export async function retrySync(activityId: string): Promise<void> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, activityId)).limit(1);
  if (!activity) return;

  await retrySyncActivity(db, createGoogleCalendarClient, activity);
  revalidatePath("/panel/calendario");
}
```

- [ ] **Step 6: Agregar el botón de reintento a `app/panel/calendario/calendar-view.tsx`**

Modificar el componente para mostrar, debajo del calendario, la lista de actividades con error y su botón de reintento:

```tsx
"use client";

import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import format from "date-fns/format";
import parse from "date-fns/parse";
import startOfWeek from "date-fns/startOfWeek";
import getDay from "date-fns/getDay";
import es from "date-fns/locale/es";
import "react-big-calendar/lib/css/react-big-calendar.css";
import type { CalendarEvent } from "@/lib/db/repositories/activities-view";
import { retrySync } from "@/app/actions/retry-sync";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: es }),
  getDay,
  locales: { es },
});

const COLOR_HEX: Record<string, string> = {
  verde: "#16a34a",
  azul: "#2563eb",
  naranjo: "#ea580c",
  plomo: "#6b7280",
};

const LEGEND_ITEMS: { label: string; color: string }[] = [
  { label: "Ejecutada", color: "verde" },
  { label: "Programada", color: "azul" },
  { label: "Pendiente", color: "naranjo" },
  { label: "Externa (Google)", color: "plomo" },
];

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const errorEvents = events.filter((event) => event.syncStatus === "error");

  return (
    <div>
      <div className="mb-4 flex gap-4">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: COLOR_HEX[item.color] }}
            />
            {item.label}
          </div>
        ))}
      </div>

      {errorEvents.length > 0 && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3">
          <p className="mb-2 text-sm font-medium text-red-800">
            Actividades con error de sincronización:
          </p>
          <ul className="space-y-2">
            {errorEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between text-sm">
                <span>{event.title}</span>
                <button
                  onClick={() => retrySync(event.id)}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                >
                  Reintentar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ height: 700 }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          eventPropGetter={(event: CalendarEvent) => ({
            style: {
              backgroundColor: COLOR_HEX[event.color] ?? "#6b7280",
              opacity: event.syncStatus === "error" ? 0.6 : 1,
              border: event.syncStatus === "error" ? "2px dashed red" : undefined,
            },
          })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verificar compilación**

Run: `pnpm tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: agrega reintento manual de sincronización para actividades con error"
```

---

## Fase 8 — Verificación final

### Task 21: Suite completa y verificación end-to-end manual

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Ejecutar toda la suite de tests**

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" TEST_DATABASE_URL="postgres://test:test@localhost:5433/calendario_test" pnpm test
```

Expected: todos los tests (unitarios + integración) en PASS. Total esperado: ~41 tests entre las Tasks 4-20.

- [ ] **Step 2: Verificar tipos de todo el proyecto**

Run: `pnpm tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Levantar el servidor de desarrollo y verificar manualmente**

```bash
pnpm dev
```

Con `DATABASE_URL` apuntando a una base de datos real (o la de test) y credenciales `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` de un proyecto de Google Cloud de prueba configuradas en `.env.local`:

1. Visitar `http://localhost:3000/login`, iniciar sesión con Google.
2. Ir a `/panel/config`, verificar que muestra "Conectado", configurar horario laboral y Calendar ID.
3. Ir a `/panel/calendario`, crear una actividad manual, verificar que aparece con color azul y que el evento se crea en Google Calendar real.
4. Ir a `/panel/bitacora`, registrar una actividad, verificar que aparece en el calendario con color verde y NO se crea en Google Calendar.
5. Crear manualmente un evento en Google Calendar directamente (fuera de la app), esperar a que corra el cron (o invocar `GET /api/cron/sync-google` manualmente con el header `Authorization: Bearer $CRON_SECRET`), verificar que aparece en `/panel/calendario` con color plomo.
6. Intentar crear una actividad manual que se superponga con una existente, verificar que el sistema bloquea o advierte según la política configurada.

- [ ] **Step 4: Documentar cualquier hallazgo de la verificación manual**

Si algo falla en la verificación manual, no continuar al Plan 2 — reportar el hallazgo y corregirlo primero dentro de este mismo plan.

---

## Siguientes pasos

Al completar este plan, el sistema tendrá un panel privado completamente funcional con sincronización bidireccional a Google Calendar. El **Plan 2** (a escribir después de validar este) cubrirá: portal público de agendamiento (`/reservar`), cálculo de huecos disponibles, gestión pública de reservas vía `booking_token`, y envío de emails con Resend.
