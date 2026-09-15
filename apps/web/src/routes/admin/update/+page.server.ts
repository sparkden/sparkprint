import { redirect } from '@sveltejs/kit';
import { hasRole } from '$lib/server/auth';
import { currentVersion } from '$lib/server/update';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	if (!hasRole(user, 'admin')) throw redirect(303, '/app');
	return { version: await currentVersion() };
};
