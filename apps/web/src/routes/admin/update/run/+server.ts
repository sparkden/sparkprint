import { error } from '@sveltejs/kit';
import { hasRole } from '$lib/server/auth';
import { runUpdate, isUpdating } from '$lib/server/update';
import type { RequestHandler } from './$types';

// POST → streams update progress; on success the server exits and systemd restarts it.
export const POST: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user || !hasRole(user, 'admin')) throw error(403, 'Admins only.');
	if (isUpdating()) throw error(409, 'An update is already running.');

	console.log(`[update] triggered by ${user.email}`);
	return new Response(runUpdate(), {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }
	});
};
