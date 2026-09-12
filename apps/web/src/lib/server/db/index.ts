import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import { mkdirSync } from 'node:fs';
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
