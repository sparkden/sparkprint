// Applies generated SQL migrations from ./drizzle to the local SQLite database.
try {
	await import('dotenv/config');
} catch {
	/* dotenv is a dev dependency */
}
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve((process.env.DATABASE_URL || './.data/sparkprint.db').replace(/^file:/, ''));
mkdirSync(dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);

console.log('Applying migrations…');
migrate(db, { migrationsFolder: './drizzle' });
console.log('✔ Migrations applied.');
sqlite.close();
