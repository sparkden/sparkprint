import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const connectionString = env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Single shared client. `prepare: false` keeps things simple across poolers.
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
