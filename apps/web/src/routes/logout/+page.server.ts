import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	throw redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ cookies }) => {
		await destroySession(cookies);
		throw redirect(303, '/');
	}
};
