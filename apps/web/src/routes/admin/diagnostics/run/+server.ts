import { error, json } from '@sveltejs/kit';
import { hasRole } from '$lib/server/auth';
import { runDiagnostics } from '$lib/server/diagnostics';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user || !hasRole(user, 'admin')) throw error(403, 'Admins only.');
	return json(await runDiagnostics(user.orgId));
};
