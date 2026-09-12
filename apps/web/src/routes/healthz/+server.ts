import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Liveness + DB readiness probe.
export const GET: RequestHandler = async () => {
	try {
		db.get(sql`select 1`);
		return new Response(JSON.stringify({ status: 'ok' }), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	} catch {
		return new Response(JSON.stringify({ status: 'degraded', db: false }), {
			status: 503,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}
};
