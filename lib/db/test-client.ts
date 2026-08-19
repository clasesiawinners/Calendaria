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
