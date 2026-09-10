/**
 * Where the app is publicly reachable — used to build download URLs the Bambu printer can fetch
 * the sliced 3mf from (the printer isn't logged into our app, so these URLs are token-signed but
 * unauthenticated).
 *
 * The printer needs an internet-reachable URL. In production that's the deploy origin; in dev it's
 * the Cloudflare tunnel URL. The dev tunnel rewrites the Host header to localhost, so the server
 * can't learn its own public URL from requests — but the browser can (its address bar shows the
 * real URL), so the client reports `window.location.origin` to /api/public-origin, and we cache it
 * here in-process (the dispatch worker runs in the same process, so it sees this value).
 *
 * Resolution order at dispatch time: PRINT_PUBLIC_ORIGIN env → ORIGIN env → last browser-reported
 * origin. An explicit env always wins so prod is deterministic.
 */
import { env } from '$env/dynamic/private';

const g = globalThis as unknown as { __sparkPublicOrigin?: string };

function normalize(origin: string): string | null {
	try {
		const u = new URL(origin);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
		// Reject loopback — a printer can't reach those, and the dev tunnel rewrites Host to
		// localhost, so a localhost value here would be the useless rewritten one.
		if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)) return null;
		return u.origin;
	} catch {
		return null;
	}
}

/** Record the public origin the browser sees (from /api/public-origin). */
export function reportPublicOrigin(origin: string): boolean {
	const n = normalize(origin);
	if (!n) return false;
	g.__sparkPublicOrigin = n;
	return true;
}

/** Best-known public origin, or null if we can't build a reachable URL yet. */
export function publicOrigin(): string | null {
	const fromEnv = normalize(env.PRINT_PUBLIC_ORIGIN || env.ORIGIN || '');
	return fromEnv ?? g.__sparkPublicOrigin ?? null;
}
