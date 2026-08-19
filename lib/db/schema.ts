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
