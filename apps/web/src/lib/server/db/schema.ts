import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/** Prefixed id helper, e.g. id('usr') -> "usr_V1StGXR8_Z5jdHi6B-myT" */
const id = (prefix: string) =>
	text('id')
		.primaryKey()
		.$defaultFn(() => `${prefix}_${nanoid(18)}`);

const createdAt = integer('created_at', { mode: 'timestamp' })
	.notNull()
	.$defaultFn(() => new Date());
const updatedAt = integer('updated_at', { mode: 'timestamp' })
	.notNull()
	.$defaultFn(() => new Date());

// Helpers to match the old Postgres semantics on SQLite.
const bool = (name: string) => integer(name, { mode: 'boolean' });
const ts = (name: string) => integer(name, { mode: 'timestamp' });
const num = (name: string) => text(name); // decimals kept as strings, as postgres numeric was

// ── Enum value sets (stored as CHECKed text on SQLite) ──────────────────────────
export const ROLE_VALUES = ['owner', 'admin', 'teacher', 'student'] as const;
export const USER_STATUS_VALUES = ['active', 'invited', 'suspended'] as const;
export const PRINTER_STATUS_VALUES = ['offline', 'idle', 'printing', 'paused', 'error', 'finished'] as const;
export const JOB_STATUS_VALUES = [
	'draft',
	'pending_approval',
	'rejected',
	'queued',
	'slicing',
	'slice_failed',
	'ready',
	'sending',
	'printing',
	'paused',
	'awaiting_pickup', // print done, still on the bed — must be checked out to free the printer
	'completed',
	'failed',
	'canceled'
] as const;

// Global key/value app settings (not org-scoped).
export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt
});

// ── Organizations (the single school/lab) ─────────────────────────────────────
export const orgs = sqliteTable('orgs', {
	id: id('org'),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	queueEnabled: bool('queue_enabled').notNull().default(true),
	approvalMode: bool('approval_mode').notNull().default(false),
	defaultMonthlyGramLimit: integer('default_monthly_gram_limit'),
	defaultMonthlyJobLimit: integer('default_monthly_job_limit'),
	defaultCostPerKg: num('default_cost_per_kg').notNull().default('25.00'),
	settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
	createdAt,
	updatedAt
});

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = sqliteTable(
	'users',
	{
		id: id('usr'),
		orgId: text('org_id')
			.notNull()
			.references(() => orgs.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		name: text('name').notNull(),
		passwordHash: text('password_hash'),
		role: text('role', { enum: ROLE_VALUES }).notNull().default('student'),
		status: text('status', { enum: USER_STATUS_VALUES }).notNull().default('active'),
		monthlyGramLimit: integer('monthly_gram_limit'),
		monthlyJobLimit: integer('monthly_job_limit'),
		lastLoginAt: ts('last_login_at'),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('users_org_email_idx').on(t.orgId, sql`lower(${t.email})`)]
);

// ── Sessions ──────────────────────────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(), // opaque token, stored hashed
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: ts('expires_at').notNull(),
	createdAt
});

// ── Invites ───────────────────────────────────────────────────────────────────
export const invites = sqliteTable('invites', {
	id: id('inv'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	token: text('token').notNull().unique(),
	role: text('role', { enum: ROLE_VALUES }).notNull().default('student'),
	email: text('email'),
	monthlyGramLimit: integer('monthly_gram_limit'),
	monthlyJobLimit: integer('monthly_job_limit'),
	maxUses: integer('max_uses'),
	uses: integer('uses').notNull().default(0),
	expiresAt: ts('expires_at'),
	createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt
});

// ── Printers ──────────────────────────────────────────────────────────────────
export const printers = sqliteTable(
	'printers',
	{
		id: id('prn'),
		orgId: text('org_id')
			.notNull()
			.references(() => orgs.id, { onDelete: 'cascade' }),
		bambuAccountId: text('bambu_account_id'), // legacy; unused (LAN-only)
		devId: text('dev_id').notNull(), // Bambu device serial
		name: text('name').notNull(),
		model: text('model').notNull().default('X1C'),
		accessCode: text('access_code'), // LAN access code
		ipAddress: text('ip_address'),
		location: text('location'),
		status: text('status', { enum: PRINTER_STATUS_VALUES }).notNull().default('offline'),
		online: bool('online').notNull().default(false),
		enabled: bool('enabled').notNull().default(true),
		priority: integer('priority').notNull().default(0),
		nozzleDiameter: num('nozzle_diameter').notNull().default('0.40'),
		hasAms: bool('has_ams').notNull().default(false),
		// live telemetry snapshot
		currentJobId: text('current_job_id'),
		progressPct: integer('progress_pct'),
		nozzleTemp: num('nozzle_temp'),
		bedTemp: num('bed_temp'),
		remainingTimeMin: integer('remaining_time_min'),
		lastSeenAt: ts('last_seen_at'),
		capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('printers_org_dev_idx').on(t.orgId, t.devId)]
);

// ── AMS units ──────────────────────────────────────────────────────────────────
export const amsUnits = sqliteTable(
	'ams_units',
	{
		id: id('ams'),
		printerId: text('printer_id')
			.notNull()
			.references(() => printers.id, { onDelete: 'cascade' }),
		amsIndex: integer('ams_index').notNull(),
		humidity: integer('humidity'),
		temperature: num('temperature'),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('ams_printer_index_idx').on(t.printerId, t.amsIndex)]
);

// ── AMS slots / trays ──────────────────────────────────────────────────────────
export const amsSlots = sqliteTable(
	'ams_slots',
	{
		id: id('slot'),
		amsUnitId: text('ams_unit_id')
			.notNull()
			.references(() => amsUnits.id, { onDelete: 'cascade' }),
		printerId: text('printer_id')
			.notNull()
			.references(() => printers.id, { onDelete: 'cascade' }),
		slotIndex: integer('slot_index').notNull(),
		filamentType: text('filament_type'),
		filamentBrand: text('filament_brand'),
		colorHex: text('color_hex'),
		colorName: text('color_name'),
		trayUuid: text('tray_uuid'),
		remainingPct: integer('remaining_pct'),
		nominalWeightG: integer('nominal_weight_g'),
		empty: bool('empty').notNull().default(false),
		// Set when an admin sets the color here → telemetry won't overwrite it (third-party filament
		// the printer can't identify). Cleared when the slot is cleared.
		manualColor: bool('manual_color').notNull().default(false),
		createdAt,
		updatedAt
	},
	(t) => [uniqueIndex('ams_slot_idx').on(t.amsUnitId, t.slotIndex)]
);

// ── Filament inventory / catalog ────────────────────────────────────────────────
export const filaments = sqliteTable('filaments', {
	id: id('fil'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type').notNull().default('PLA'),
	brand: text('brand').notNull().default('Bambu'),
	colorHex: text('color_hex').notNull().default('#FF5B14'),
	costPerKg: num('cost_per_kg'),
	gramsInStock: integer('grams_in_stock'),
	gramsUsed: integer('grams_used').notNull().default(0),
	lowStockThresholdG: integer('low_stock_threshold_g'),
	archived: bool('archived').notNull().default(false),
	createdAt,
	updatedAt
});

// ── Models (uploaded / imported designs) ───────────────────────────────────────
export const models = sqliteTable('models', {
	id: id('mdl'),
	orgId: text('org_id')
		.notNull()
		.references(() => orgs.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	format: text('format').notNull().default('stl'),
	fileKey: text('file_key').notNull(),
	thumbnailKey: text('thumbnail_key'),
	sizeBytes: integer('size_bytes'),
	meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
	createdAt,
	updatedAt
});

// ── Print jobs ─────────────────────────────────────────────────────────────────
export const printJobs = sqliteTable(
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
		status: text('status', { enum: JOB_STATUS_VALUES }).notNull().default('draft'),
		priority: integer('priority').notNull().default(0),
		printerModelTarget: text('printer_model_target'),
		layerHeightMm: num('layer_height_mm').default('0.20'),
		infillPct: integer('infill_pct').default(15),
		supports: bool('supports').notNull().default(false),
		copies: integer('copies').notNull().default(1),
		process: text('process', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
		colorRequest: text('color_request', { mode: 'json' }).$type<ColorRequest[]>().notNull().$defaultFn(() => []),
		colorMapping: text('color_mapping', { mode: 'json' }).$type<ColorMapping[]>().notNull().$defaultFn(() => []),
		estimatedGrams: num('estimated_grams'),
		estimatedTimeSec: integer('estimated_time_sec'),
		actualGrams: num('actual_grams'),
		gcodeKey: text('gcode_key'),
		finishPhotoKey: text('finish_photo_key'), // camera still taken near the end of the print
		estimatedCost: num('estimated_cost'),
		approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
		approvalNote: text('approval_note'),
		submittedAt: ts('submitted_at'),
		startedAt: ts('started_at'),
		finishedAt: ts('finished_at'),
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
export const jobEvents = sqliteTable(
	'job_events',
	{
		id: id('evt'),
		jobId: text('job_id')
			.notNull()
			.references(() => printJobs.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		message: text('message'),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
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
	any?: boolean; // "no preference" — match whatever color is most available
};
export type ColorMapping = {
	filamentIndex: number;
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
export type Role = (typeof ROLE_VALUES)[number];
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];
