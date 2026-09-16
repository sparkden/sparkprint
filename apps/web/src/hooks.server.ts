import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getSessionToken, validateSession, hasRole } from '$lib/server/auth';
import { manager } from '$lib/server/bambu/manager';
import { startWorkers } from '$lib/server/workers';
import { isInitialized } from '$lib/server/setup';

// Boot once per server process: open local MQTT connections to configured printers.
manager()
	.ensureStarted()
	.catch((e) => console.error('[bambu] ensureStarted failed', e));
startWorkers().catch((e) => console.error('[queue] startWorkers failed', e));

// Route-prefix access rules (most specific first).
const RULES: { prefix: string; min: 'student' | 'teacher' | 'admin' | 'owner' }[] = [
	{ prefix: '/admin', min: 'teacher' },
	{ prefix: '/app', min: 'student' }
];

// A LAN-aware CSRF origin check (replaces SvelteKit's built-in one, disabled in svelte.config.js).
// Form POSTs are allowed when their Origin is the server's own configured origin (public URL behind
// the tunnel) OR a loopback/LAN address — so the no-login kiosk on http://localhost and LAN admins
// work — while genuine external cross-site POSTs are still blocked.
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
function isLanHost(host: string): boolean {
	const h = (host || '').split(':')[0].toLowerCase();
	if (!h) return false;
	if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local')) return true;
	if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true; // 10.0.0.0/8
	if (/^192\.168\.\d+\.\d+$/.test(h)) return true; // 192.168.0.0/16
	if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true; // 172.16.0.0/12
	return false;
}
function csrfForbidden(event: Parameters<Handle>[0]['event']): boolean {
	const method = event.request.method;
	if (method === 'GET' || method === 'HEAD') return false;
	const ct = (event.request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!FORM_CONTENT_TYPES.includes(ct)) return false; // non-form (JSON fetch) isn't cross-site CSRF-able
	const origin = event.request.headers.get('origin');
	if (!origin) return false; // browsers send Origin on cross-site POST; missing → same-origin/native
	let host = '';
	try { host = new URL(origin).host; } catch { return true; } // unparseable Origin → reject
	return !(host === event.url.host || isLanHost(host));
}

export const handle: Handle = async ({ event, resolve }) => {
	const token = getSessionToken(event.cookies);
	const user = token ? await validateSession(token) : null;
	event.locals.user = user;
	event.locals.sessionId = token;

	const path = event.url.pathname;

	// CSRF: reject external cross-site form POSTs (kiosk/LAN origins are allowed — see above).
	if (csrfForbidden(event)) {
		return new Response('Cross-site POST form submissions are forbidden', { status: 403 });
	}

	// First-run: until a lab exists, funnel everything into sign-up (the first user creates it).
	if (path !== '/healthz' && !path.startsWith('/signup')) {
		if (!(await isInitialized())) {
			throw redirect(303, '/signup');
		}
	}

	const rule = RULES.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
	if (rule) {
		if (!user) {
			throw redirect(303, `/login?next=${encodeURIComponent(path)}`);
		}
		if (!hasRole(user, rule.min)) {
			throw redirect(303, '/app');
		}
	}

	const response = await resolve(event);

	// Security headers.
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (process.env.NODE_ENV === 'production') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		response.headers.set(
			'Content-Security-Policy',
			[
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline'",
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
				"font-src 'self' https://fonts.gstatic.com data:",
				"img-src 'self' data: blob:",
				"connect-src 'self'",
				"frame-ancestors 'self'",
				"base-uri 'self'",
				"form-action 'self'"
			].join('; ')
		);
	}
	return response;
};
