import { redirect } from '@sveltejs/kit';
import { isInitialized } from '$lib/server/setup';
import type { PageServerLoad } from './$types';

// Single-org, self-hosted: account + lab creation happens on the sign-up page (the first user
// becomes owner). This wizard is retired so there's never a second org — it just forwards. Bambu
// connect and invites live in the admin area (Admin → Printers / Admin → Invites).
export const load: PageServerLoad = async ({ locals }) => {
	if (!(await isInitialized())) throw redirect(303, '/signup');
	throw redirect(303, locals.user ? '/admin' : '/login');
};
