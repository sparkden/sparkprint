/**
 * Where the app is publicly reachable — used to build download URLs the Bambu printer can fetch
 * the sliced 3mf from (the printer isn't logged into our app, so these URLs are token-signed but
 * unauthenticated).
 *
 * The printer needs an internet-reachable URL. In production that's the deploy origin; in dev it's
 * the Cloudflare tunnel URL. The dev tunnel rewrites the Host header to localhost, so the server
 * can't learn its own public URL from requests — but the browser can (its address bar shows the
 * real URL), so the client reports `window.location.origin` to /api/public-origin. We cache it in
 * a global and persist it to app_settings so it survives restarts and is inspectable.
 *
 * Resolution order at dispatch time: PRINT_PUBLIC_ORIGIN env → ORIGIN env → last known origin
 * (memory, loaded from the DB at startup). An explicit env always wins so prod is deterministic.
 */
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { appSettings } from './db/schema';

const SETTING_KEY = 'public_origin';
const g = globalThis as unknown as { __sparkPublicOrigin?: string };

function normalize(origin: string): string | null {
	try {
		const u = new URL(origin.trim());
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
		// Reject loopback — a printer can't reach those, and the dev tunnel rewrites Host to
		// localhost, so a localhost value here would be the useless rewritten one.
		if (/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(u.hostname)) return null;
		return u.origin;
	} catch {
		return null;
	}
}

/** Record the public origin the browser sees (from /api/public-origin). Persists it for reuse. */
export function reportPublicOrigin(origin: string): boolean {
	const n = normalize(origin);
	if (!n) return false;
	if (g.__sparkPublicOrigin === n) return true; // unchanged
	g.__sparkPublicOrigin = n;
	db.insert(appSettings)
		.values({ key: SETTING_KEY, value: n, updatedAt: new Date() })
		.onConflictDoUpdate({ target: appSettings.key, set: { value: n, updatedAt: new Date() } })
		.catch((e) => console.error('[public-origin] persist failed', e));
	return true;
}

/** Load the last persisted origin into memory (call once at startup). */
export async function loadPublicOrigin(): Promise<void> {
	try {
		const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
		if (row?.value && !g.__sparkPublicOrigin) g.__sparkPublicOrigin = row.value;
	} catch {
		/* table may not exist yet before migrations run */
	}
}

/** Best-known public origin, or null if we can't build a reachable URL yet.
 * env → app_settings (kept current by start.sh / the browser) → last in-memory value. Reads the
 * DB each call (one tiny row) so a freshly-seeded tunnel URL takes effect without a restart. */
export async function publicOrigin(): Promise<string | null> {
	const fromEnv = normalize(env.PRINT_PUBLIC_ORIGIN || env.ORIGIN || '');
	if (fromEnv) return fromEnv;
	try {
		const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
		if (row?.value) {
			g.__sparkPublicOrigin = row.value;
			return row.value;
		}
	} catch {
		/* fall back to memory */
	}
	return g.__sparkPublicOrigin ?? null;
}
