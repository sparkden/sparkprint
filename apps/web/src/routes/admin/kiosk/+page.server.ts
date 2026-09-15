import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { hasRole } from '$lib/server/auth';
import { getSetting } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	if (!hasRole(user, 'admin')) throw redirect(303, '/app');
	const enabled = (await getSetting('kiosk.enabled')) === '1';
	const token = await getSetting('kiosk.token');
	const port = env.PORT || '3000';
	return {
		enabled,
		// The URL the kiosk display opens — also usable on any other screen on the LAN.
		url: token ? `/monitor?kiosk=${token}` : null,
		port
	};
};
