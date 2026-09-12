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

export const handle: Handle = async ({ event, resolve }) => {
	const token = getSessionToken(event.cookies);
	const user = token ? await validateSession(token) : null;
	event.locals.user = user;
	event.locals.sessionId = token;

	const path = event.url.pathname;

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
