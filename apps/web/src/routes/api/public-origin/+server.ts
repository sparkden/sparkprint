/**
 * The browser reports the public URL it's actually loaded from (window.location.origin), so the
 * server can build printer-reachable download URLs even when a dev tunnel hides the real Host.
 * Any authenticated app user may report it; an explicit PRINT_PUBLIC_ORIGIN/ORIGIN env still wins.
 */
import { json } from '@sveltejs/kit';
import { reportPublicOrigin } from '$lib/server/public-origin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ ok: false }, { status: 401 });
	const origin = (await request.text()).trim();
	return json({ ok: reportPublicOrigin(origin) });
};
