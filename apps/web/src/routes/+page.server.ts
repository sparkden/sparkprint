import { redirect } from '@sveltejs/kit';
import { isInitialized } from '$lib/server/setup';
import type { PageServerLoad } from './$types';

// No marketing landing page on a self-hosted instance: send people straight to the right place.
//   • no lab yet        → sign up (first user creates the lab + becomes owner)
//   • signed in (staff) → admin dashboard; (student) → the app
//   • otherwise         → log in
export const load: PageServerLoad = async ({ locals }) => {
	if (!(await isInitialized())) throw redirect(303, '/signup');
	if (locals.user) {
		const staff = ['owner', 'admin', 'teacher'].includes(locals.user.role);
		throw redirect(303, staff ? '/admin' : '/app');
	}
	throw redirect(303, '/login');
};
