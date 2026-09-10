import { sql } from 'drizzle-orm';
import { db } from './db';
import { orgs } from './db/schema';

// Whether the instance has been set up (at least one org/lab exists). Cached once true,
// since orgs are never removed down to zero in normal operation.
let _initialized = false;

export async function isInitialized(): Promise<boolean> {
	if (_initialized) return true;
	const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(orgs);
	_initialized = Number(n) > 0;
	return _initialized;
}

export function markInitialized() {
	_initialized = true;
}
