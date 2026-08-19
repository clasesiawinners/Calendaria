CREATE TYPE "public"."conflict_policy" AS ENUM('block', 'warn');--> statement-breakpoint
CREATE TYPE "public"."created_by" AS ENUM('admin', 'public', 'bitacora');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('bitacora', 'manual', 'google_calendar');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('ejecutada', 'programada', 'pendiente', 'externa');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('synced', 'pending', 'error');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"activity_type" text NOT NULL,
	"status" "status" NOT NULL,
	"color" text NOT NULL,
	"start_datetime" timestamp with time zone NOT NULL,
	"end_datetime" timestamp with time zone NOT NULL,
	"description" text,
	"location" text,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"sync_error_message" text,
	"created_by" "created_by" NOT NULL,
	"google_event_id" text,
	"reminders_configured" boolean DEFAULT false NOT NULL,
	"booking_token" uuid,
	"booker_name" text,
	"booker_email" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_hours_start" text DEFAULT '08:00' NOT NULL,
	"work_hours_end" text DEFAULT '19:00' NOT NULL,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"conflict_policy" "conflict_policy" DEFAULT 'block' NOT NULL,
	"google_calendar_id" text,
	"google_refresh_token" text,
	"admin_email" text,
	"google_sync_token" text
);
