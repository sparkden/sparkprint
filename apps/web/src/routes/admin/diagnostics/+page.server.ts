import { redirect } from '@sveltejs/kit';
import { hasRole } from '$lib/server/auth';
import { runDiagnostics } from '$lib/server/diagnostics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	if (!hasRole(user, 'admin')) throw redirect(303, '/app');
	// Run once on load so the page shows results immediately; the button re-runs.
	return { report: await runDiagnostics(user.orgId) };
};
