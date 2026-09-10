// Applies generated SQL migrations from ./drizzle to the database.
// In dev we load apps/web/.env via dotenv (optional); in prod the container injects env.
try {
	await import('dotenv/config');
} catch {
	/* dotenv is a dev dependency; in production env comes from the environment */
}
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log('Applying migrations…');
await migrate(db, { migrationsFolder: './drizzle' });
console.log('✔ Migrations applied.');
await client.end();
