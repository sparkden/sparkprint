CREATE TABLE `ams_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`ams_unit_id` text NOT NULL,
	`printer_id` text NOT NULL,
	`slot_index` integer NOT NULL,
	`filament_type` text,
	`filament_brand` text,
	`color_hex` text,
	`color_name` text,
	`tray_uuid` text,
	`remaining_pct` integer,
	`nominal_weight_g` integer,
	`empty` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`ams_unit_id`) REFERENCES `ams_units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ams_slot_idx` ON `ams_slots` (`ams_unit_id`,`slot_index`);--> statement-breakpoint
CREATE TABLE `ams_units` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`ams_index` integer NOT NULL,
	`humidity` integer,
	`temperature` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ams_printer_index_idx` ON `ams_units` (`printer_id`,`ams_index`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `filaments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'PLA' NOT NULL,
	`brand` text DEFAULT 'Bambu' NOT NULL,
	`color_hex` text DEFAULT '#FF5B14' NOT NULL,
	`cost_per_kg` text,
	`grams_in_stock` integer,
	`grams_used` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold_g` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`token` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`email` text,
	`monthly_gram_limit` integer,
	`monthly_job_limit` integer,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`type` text NOT NULL,
	`message` text,
	`data` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_events_job_idx` ON `job_events` (`job_id`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text DEFAULT 'stl' NOT NULL,
	`file_key` text NOT NULL,
	`thumbnail_key` text,
	`size_bytes` integer,
	`meta` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`queue_enabled` integer DEFAULT true NOT NULL,
	`approval_mode` integer DEFAULT false NOT NULL,
	`default_monthly_gram_limit` integer,
	`default_monthly_job_limit` integer,
	`default_cost_per_kg` text DEFAULT '25.00' NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_unique` ON `orgs` (`slug`);--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`model_id` text,
	`printer_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`printer_model_target` text,
	`layer_height_mm` text DEFAULT '0.20',
	`infill_pct` integer DEFAULT 15,
	`supports` integer DEFAULT false NOT NULL,
	`copies` integer DEFAULT 1 NOT NULL,
	`process` text NOT NULL,
	`color_request` text NOT NULL,
	`color_mapping` text NOT NULL,
	`estimated_grams` text,
	`estimated_time_sec` integer,
	`actual_grams` text,
	`gcode_key` text,
	`estimated_cost` text,
	`approved_by` text,
	`approval_note` text,
	`submitted_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `jobs_org_status_idx` ON `print_jobs` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_user_idx` ON `print_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `jobs_printer_idx` ON `print_jobs` (`printer_id`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`bambu_account_id` text,
	`dev_id` text NOT NULL,
	`name` text NOT NULL,
	`model` text DEFAULT 'X1C' NOT NULL,
	`access_code` text,
	`ip_address` text,
	`location` text,
	`status` text DEFAULT 'offline' NOT NULL,
	`online` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`nozzle_diameter` text DEFAULT '0.40' NOT NULL,
	`has_ams` integer DEFAULT false NOT NULL,
	`current_job_id` text,
	`progress_pct` integer,
	`nozzle_temp` text,
	`bed_temp` text,
	`remaining_time_min` integer,
	`last_seen_at` integer,
	`capabilities` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printers_org_dev_idx` ON `printers` (`org_id`,`dev_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'student' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`monthly_gram_limit` integer,
	`monthly_job_limit` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_org_email_idx` ON `users` (`org_id`,lower("email"));