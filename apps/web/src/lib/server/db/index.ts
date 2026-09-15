import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

// Local SQLite file — single-school, self-hosted. DATABASE_URL may be a path or file: URL;
// defaults to ./.data/sparkprint.db next to the app.
const file = resolve((env.DATABASE_URL || './.data/sparkprint.db').replace(/^file:/, ''));
mkdirSync(dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export { schema };
export type DB = typeof db;

// Auto-initialize the schema on boot so the app "just works" with no separate migrate step.
// Idempotent: drizzle only applies migrations not already recorded. Runs from dev (cwd=apps/web)
// and prod (cwd=repo root) alike by probing the likely migrations folders.
const g = globalThis as unknown as { __sparkMigrated?: boolean };
if (!g.__sparkMigrated) {
	const folder = ['./drizzle', './apps/web/drizzle', resolve(process.cwd(), 'apps/web/drizzle')].find((p) => existsSync(p));
	if (folder) {
		try {
			migrate(db, { migrationsFolder: folder });
		} catch (e) {
			console.error('[db] auto-migrate failed:', (e as Error).message);
		}
	} else {
		console.warn('[db] no migrations folder found — run `npm run db:migrate`');
	}
	// Additive columns added after the baseline migration — applied idempotently so we don't have to
	// hand-edit the drizzle journal. Re-runs throw "duplicate column name", which we ignore.
	for (const stmt of ['ALTER TABLE ams_slots ADD COLUMN manual_color integer DEFAULT 0 NOT NULL']) {
		try { sqlite.exec(stmt); } catch { /* column already exists */ }
	}
	g.__sparkMigrated = true;
}
