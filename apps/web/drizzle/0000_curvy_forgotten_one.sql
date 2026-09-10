CREATE TYPE "public"."job_status" AS ENUM('draft', 'pending_approval', 'rejected', 'queued', 'slicing', 'slice_failed', 'ready', 'sending', 'printing', 'paused', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."printer_status" AS ENUM('offline', 'idle', 'printing', 'paused', 'error', 'finished');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'teacher', 'student');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TABLE "ams_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"ams_unit_id" text NOT NULL,
	"printer_id" text NOT NULL,
	"slot_index" integer NOT NULL,
	"filament_type" text,
	"filament_brand" text,
	"color_hex" text,
	"color_name" text,
	"tray_uuid" text,
	"remaining_pct" integer,
	"nominal_weight_g" integer,
	"empty" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ams_units" (
	"id" text PRIMARY KEY NOT NULL,
	"printer_id" text NOT NULL,
	"ams_index" integer NOT NULL,
	"humidity" integer,
	"temperature" numeric(5, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bambu_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"region" text DEFAULT 'us' NOT NULL,
	"bambu_user_id" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filaments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'PLA' NOT NULL,
	"brand" text DEFAULT 'Bambu' NOT NULL,
	"color_hex" text DEFAULT '#FF5B14' NOT NULL,
	"cost_per_kg" numeric(8, 2),
	"grams_in_stock" integer,
	"grams_used" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold_g" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"token" text NOT NULL,
	"role" "role" DEFAULT 'student' NOT NULL,
	"email" text,
	"monthly_gram_limit" integer,
	"monthly_job_limit" integer,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"format" text DEFAULT 'stl' NOT NULL,
	"file_key" text NOT NULL,
	"thumbnail_key" text,
	"size_bytes" integer,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"queue_enabled" boolean DEFAULT true NOT NULL,
	"approval_mode" boolean DEFAULT false NOT NULL,
	"default_monthly_gram_limit" integer,
	"default_monthly_job_limit" integer,
	"default_cost_per_kg" numeric(8, 2) DEFAULT '25.00' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text,
	"printer_id" text,
	"name" text NOT NULL,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"printer_model_target" text,
	"layer_height_mm" numeric(4, 2) DEFAULT '0.20',
	"infill_pct" integer DEFAULT 15,
	"supports" boolean DEFAULT false NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"color_request" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_grams" numeric(8, 2),
	"estimated_time_sec" integer,
	"actual_grams" numeric(8, 2),
	"gcode_key" text,
	"estimated_cost" numeric(8, 2),
	"approved_by" text,
	"approval_note" text,
	"submitted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bambu_account_id" text,
	"dev_id" text NOT NULL,
	"name" text NOT NULL,
	"model" text DEFAULT 'X1C' NOT NULL,
	"access_code" text,
	"ip_address" text,
	"location" text,
	"status" "printer_status" DEFAULT 'offline' NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"nozzle_diameter" numeric(3, 2) DEFAULT '0.40' NOT NULL,
	"has_ams" boolean DEFAULT false NOT NULL,
	"current_job_id" text,
	"progress_pct" integer,
	"nozzle_temp" numeric(5, 1),
	"bed_temp" numeric(5, 1),
	"remaining_time_min" integer,
	"last_seen_at" timestamp with time zone,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"monthly_gram_limit" integer,
	"monthly_job_limit" integer,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ams_slots" ADD CONSTRAINT "ams_slots_ams_unit_id_ams_units_id_fk" FOREIGN KEY ("ams_unit_id") REFERENCES "public"."ams_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ams_slots" ADD CONSTRAINT "ams_slots_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ams_units" ADD CONSTRAINT "ams_units_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bambu_accounts" ADD CONSTRAINT "bambu_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filaments" ADD CONSTRAINT "filaments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_print_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."print_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_bambu_account_id_bambu_accounts_id_fk" FOREIGN KEY ("bambu_account_id") REFERENCES "public"."bambu_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ams_slot_idx" ON "ams_slots" USING btree ("ams_unit_id","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "ams_printer_index_idx" ON "ams_units" USING btree ("printer_id","ams_index");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "print_jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "print_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_printer_idx" ON "print_jobs" USING btree ("printer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "printers_org_dev_idx" ON "printers" USING btree ("org_id","dev_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_idx" ON "users" USING btree ("org_id",lower("email"));