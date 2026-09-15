import { error, json } from '@sveltejs/kit';
import { hasRole } from '$lib/server/auth';
import { freePrinter } from '$lib/server/jobs';
import type { RequestHandler } from './$types';

// POST { printerId } → clear a stuck 'finished' printer so it can take new jobs.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user || !hasRole(user, 'admin')) throw error(403, 'Admins only.');
	const { printerId } = await request.json().catch(() => ({ printerId: '' }));
	if (typeof printerId !== 'string' || !printerId) throw error(400, 'printerId required.');
	const res = await freePrinter(printerId, user.orgId, user.id);
	if (!res.ok) throw error(400, res.error ?? 'Could not free the printer.');
	return json({ ok: true });
};
