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
