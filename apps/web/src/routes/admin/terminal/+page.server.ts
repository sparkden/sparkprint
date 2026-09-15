import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { hasRole } from '$lib/server/auth';
import { terminalEnabled, getCwd, shellUser, hostName, rootAvailable } from '$lib/server/shell';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	// Admins/owners only — never teachers or students.
	if (!hasRole(user, 'admin')) throw redirect(303, '/app');

	return {
		enabled: terminalEnabled(),
		cwd: getCwd(user.id),
		runAs: shellUser(),
		host: hostName(),
		rootAvailable: await rootAvailable(),
		// True when the app is published on a public URL (Cloudflare tunnel) → show a stronger warning.
		publicOrigin: !!(env.ORIGIN && env.ORIGIN.trim())
	};
};
