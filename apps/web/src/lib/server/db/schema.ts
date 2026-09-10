import {
	pgTable,
	pgEnum,
	text,
	integer,
	boolean,
	timestamp,
	numeric,
	jsonb,
	uniqueIndex,
	index
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/** Prefixed id helper, e.g. id('usr') -> "usr_V1StGXR8_Z5jdHi6B-myT" */
const id = (prefix: string) =>
	text('id')
		.primaryKey()
		.$defaultFn(() => `${prefix}_${nanoid(18)}`);

const createdAt = timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

// ── Enums ───────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum('role', ['owner', 'admin', 'teacher', 'student']);
export const userStatusEnum = pgEnum('user_status', ['active', 'invited', 'suspended']);
export const printerStatusEnum = pgEnum('printer_status', [
	'offline',
	'idle',
	'printing',
	'paused',
	'error',
	'finished'
]);
export const jobStatusEnum = pgEnum('job_status', [
	'draft', // being designed, not submitted
	'pending_approval', // waiting on admin/teacher sign-off
	'rejected', // approval denied
	'queued', // approved / no-approval-needed, waiting for a printer
	'slicing', // slicer worker processing
	'slice_failed',
	'ready', // sliced, awaiting dispatch to a printer
	'sending', // uploading to printer
	'printing',
	'paused',
	'completed',
	'failed',
	'canceled'
]);

// ── Organizations (schools) ───────────────────────────────────────────────────
export const orgs = pgTable('orgs', {
	id: id('org'),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	// Org-wide policy & feature flags
	queueEnabled: boolean('queue_enabled').notNull().default(true),
	approvalMode: boolean('approval_mode').notNull().default(false),
	// Defaults applied to new members (grams/month, jobs/month; null = unlimited)
	defaultMonthlyGramLimit: integer('default_monthly_gram_limit'),
	defaultMonthlyJobLimit: integer('default_monthly_job_limit'),
	// Estimated material cost used for accounting ($/kg), overridable per filament
	defaultCostPerKg: numeric('default_cost_per_kg', { precision: 8, scale: 2 })
		.notNull()
		.default('25.00'),
	settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
	createdAt,
	updatedAt
});

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = pgTable(
	'users',
	{
		id: id('usr'),
		orgId: text('org_id')
			.notNull()
			.references(() => orgs.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		name: text('name').notNull(),
		passwordHash: text('password_hash'), // null until an invited user sets a password
		role: roleEnum('role').notNull().default('student'),
		status: userStatusEnum('status').notNull().default('active'),
		// Per-user quota overrides (null = inherit org default; 0 = blocked)
		monthlyGramLimit: integer('monthly_gram_limit'),
		monthlyJobLimit: integer('monthly_job_limit'),
		lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('users_org_email_idx').on(t.orgId, sql`lower(${t.email})`)]
);

// ── Sessions ──────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(), // opaque random token (stored hashed in prod; raw here for dev)
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt
});

// ── Invites ───────────────────────────────────────────────────────────────────
export const invites = pgTable('invites', {
	id: id('inv'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	token: text('token').notNull().unique(),
	role: roleEnum('role').notNull().default('student'),
	email: text('email'), // optional lock to a specific email
	// Quota presets applied to users who redeem this invite
	monthlyGramLimit: integer('monthly_gram_limit'),
	monthlyJobLimit: integer('monthly_job_limit'),
	maxUses: integer('max_uses'), // null = unlimited
	uses: integer('uses').notNull().default(0),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt
});

// ── Bambu account binding (school connects one Bambu Lab account) ──────────────
export const bambuAccounts = pgTable('bambu_accounts', {
	id: id('bam'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	email: text('email').notNull(),
	region: text('region').notNull().default('us'), // us | eu | cn
	bambuUserId: text('bambu_user_id'),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
	status: text('status').notNull().default('connected'), // connected | expired | error
	lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
	createdAt,
	updatedAt
});

// ── Printers ──────────────────────────────────────────────────────────────────
export const printers = pgTable(
	'printers',
	{
		id: id('prn'),
		orgId: text('org_id')
			.notNull()
			.references(() => orgs.id, { onDelete: 'cascade' }),
		bambuAccountId: text('bambu_account_id').references(() => bambuAccounts.id, {
			onDelete: 'set null'
		}),
		devId: text('dev_id').notNull(), // Bambu device serial
		name: text('name').notNull(),
		model: text('model').notNull().default('X1C'), // X1C | P1S | P1P | A1 | A1M ...
		accessCode: text('access_code'), // for LAN mode
		ipAddress: text('ip_address'),
		location: text('location'),
		status: printerStatusEnum('status').notNull().default('offline'),
		online: boolean('online').notNull().default(false),
		enabled: boolean('enabled').notNull().default(true), // admin can take a printer out of the pool
		priority: integer('priority').notNull().default(0), // higher = picked first when dispatching
		nozzleDiameter: numeric('nozzle_diameter', { precision: 3, scale: 2 }).notNull().default('0.40'),
		hasAms: boolean('has_ams').notNull().default(false),
		// live telemetry snapshot
		currentJobId: text('current_job_id'),
		progressPct: integer('progress_pct'),
		nozzleTemp: numeric('nozzle_temp', { precision: 5, scale: 1 }),
		bedTemp: numeric('bed_temp', { precision: 5, scale: 1 }),
		remainingTimeMin: integer('remaining_time_min'),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		capabilities: jsonb('capabilities').$type<Record<string, unknown>>().notNull().default({}),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('printers_org_dev_idx').on(t.orgId, t.devId)]
);

// ── AMS units (one printer can have multiple AMS) ──────────────────────────────
export const amsUnits = pgTable(
	'ams_units',
	{
		id: id('ams'),
		printerId: text('printer_id')
			.notNull()
			.references(() => printers.id, { onDelete: 'cascade' }),
		amsIndex: integer('ams_index').notNull(), // 0-based
		humidity: integer('humidity'),
		temperature: numeric('temperature', { precision: 5, scale: 1 }),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('ams_printer_index_idx').on(t.printerId, t.amsIndex)]
);

// ── AMS slots / trays (the mapped colors) ──────────────────────────────────────
export const amsSlots = pgTable(
	'ams_slots',
	{
		id: id('slot'),
		amsUnitId: text('ams_unit_id')
			.notNull()
			.references(() => amsUnits.id, { onDelete: 'cascade' }),
		printerId: text('printer_id')
			.notNull()
			.references(() => printers.id, { onDelete: 'cascade' }),
		slotIndex: integer('slot_index').notNull(), // 0-3 within the AMS
		filamentType: text('filament_type'), // PLA | PETG | ABS | TPU ...
		filamentBrand: text('filament_brand'),
		colorHex: text('color_hex'), // #RRGGBB(AA)
		colorName: text('color_name'),
		trayUuid: text('tray_uuid'), // Bambu RFID tray identifier
		remainingPct: integer('remaining_pct'), // estimated remaining %
		nominalWeightG: integer('nominal_weight_g'),
		empty: boolean('empty').notNull().default(false),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('ams_slot_idx').on(t.amsUnitId, t.slotIndex)]
);

// ── Filament inventory / catalog (org-level, for cost & stock tracking) ─────────
export const filaments = pgTable('filaments', {
	id: id('fil'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type').notNull().default('PLA'),
	brand: text('brand').notNull().default('Bambu'),
	colorHex: text('color_hex').notNull().default('#FF5B14'),
	costPerKg: numeric('cost_per_kg', { precision: 8, scale: 2 }),
	gramsInStock: integer('grams_in_stock'), // null = not tracked
	gramsUsed: integer('grams_used').notNull().default(0),
	lowStockThresholdG: integer('low_stock_threshold_g'),
	archived: boolean('archived').notNull().default(false),
	createdAt,
	updatedAt
});

// ── Models (uploaded / imported designs) ───────────────────────────────────────
export const models = pgTable('models', {
	id: id('mdl'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	format: text('format').notNull().default('stl'), // stl | 3mf | obj | step
	fileKey: text('file_key').notNull(), // storage key
	thumbnailKey: text('thumbnail_key'),
	sizeBytes: integer('size_bytes'),
	// bounding box in mm, triangle count etc.
	meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
	createdAt,
	updatedAt
});

// ── Print jobs ─────────────────────────────────────────────────────────────────
export const printJobs = pgTable(
	'print_jobs',
	{
		id: id('job'),
		orgId: text('org_id')
			.notNull()
			.references(() => orgs.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
		printerId: text('printer_id').references(() => printers.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		status: jobStatusEnum('status').notNull().default('draft'),
		priority: integer('priority').notNull().default(0), // higher = sooner
		// Slicing settings chosen by the student
		printerModelTarget: text('printer_model_target'), // e.g. "X1C" — restrict to compatible printers
		layerHeightMm: numeric('layer_height_mm', { precision: 4, scale: 2 }).default('0.20'),
		infillPct: integer('infill_pct').default(15),
		supports: boolean('supports').notNull().default(false),
		copies: integer('copies').notNull().default(1),
		// Full slicing/process settings (walls, pattern, supports type, brim, seam, …)
		process: jsonb('process').$type<Record<string, unknown>>().notNull().default({}),
		// Requested color(s): array of { filamentType, colorHex, colorName }
		colorRequest: jsonb('color_request').$type<ColorRequest[]>().notNull().default([]),
		// Resolved AMS slot mapping once assigned to a printer: [{ extruder/filamentIdx -> amsSlotId }]
		colorMapping: jsonb('color_mapping').$type<ColorMapping[]>().notNull().default([]),
		// Slice results
		estimatedGrams: numeric('estimated_grams', { precision: 8, scale: 2 }),
		estimatedTimeSec: integer('estimated_time_sec'),
		actualGrams: numeric('actual_grams', { precision: 8, scale: 2 }),
		gcodeKey: text('gcode_key'), // sliced 3mf/gcode storage key
		estimatedCost: numeric('estimated_cost', { precision: 8, scale: 2 }),
		// Approval workflow
		approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
		approvalNote: text('approval_note'),
		// Lifecycle timestamps
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		failureReason: text('failure_reason'),
		createdAt,
		updatedAt
	},
	(t) => [
		index('jobs_org_status_idx').on(t.orgId, t.status),
		index('jobs_user_idx').on(t.userId),
		index('jobs_printer_idx').on(t.printerId)
	]
);

// ── Job events (audit trail / timeline) ────────────────────────────────────────
export const jobEvents = pgTable(
	'job_events',
	{
		id: id('evt'),
		jobId: text('job_id')
			.notNull()
			.references(() => printJobs.id, { onDelete: 'cascade' }),
		type: text('type').notNull(), // status_change | approval | slice | dispatch | error | note
		message: text('message'),
		data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
		actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt
	},
	(t) => [index('job_events_job_idx').on(t.jobId)]
);

// ── Shared JSON shapes ─────────────────────────────────────────────────────────
export type ColorRequest = {
	filamentType: string;
	colorHex: string;
	colorName?: string;
};
export type ColorMapping = {
	filamentIndex: number; // paint/extruder index in the model
	amsSlotId: string;
	amsIndex: number;
	slotIndex: number;
	colorHex: string;
};

// ── Relations ──────────────────────────────────────────────────────────────────
export const orgRelations = relations(orgs, ({ many }) => ({
	users: many(users),
	printers: many(printers),
	invites: many(invites),
	filaments: many(filaments),
	jobs: many(printJobs)
}));
export const userRelations = relations(users, ({ one, many }) => ({
	org: one(orgs, { fields: [users.orgId], references: [orgs.id] }),
	jobs: many(printJobs),
	models: many(models)
}));
export const printerRelations = relations(printers, ({ one, many }) => ({
	org: one(orgs, { fields: [printers.orgId], references: [orgs.id] }),
	bambuAccount: one(bambuAccounts, {
		fields: [printers.bambuAccountId],
		references: [bambuAccounts.id]
	}),
	amsUnits: many(amsUnits)
}));
export const amsUnitRelations = relations(amsUnits, ({ one, many }) => ({
	printer: one(printers, { fields: [amsUnits.printerId], references: [printers.id] }),
	slots: many(amsSlots)
}));
export const amsSlotRelations = relations(amsSlots, ({ one }) => ({
	amsUnit: one(amsUnits, { fields: [amsSlots.amsUnitId], references: [amsUnits.id] })
}));
export const jobRelations = relations(printJobs, ({ one, many }) => ({
	org: one(orgs, { fields: [printJobs.orgId], references: [orgs.id] }),
	user: one(users, { fields: [printJobs.userId], references: [users.id] }),
	model: one(models, { fields: [printJobs.modelId], references: [models.id] }),
	printer: one(printers, { fields: [printJobs.printerId], references: [printers.id] }),
	events: many(jobEvents)
}));

// Convenience type exports
export type Org = typeof orgs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Printer = typeof printers.$inferSelect;
export type AmsUnit = typeof amsUnits.$inferSelect;
export type AmsSlot = typeof amsSlots.$inferSelect;
export type Filament = typeof filaments.$inferSelect;
export type Model = typeof models.$inferSelect;
export type PrintJob = typeof printJobs.$inferSelect;
export type JobEvent = typeof jobEvents.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
