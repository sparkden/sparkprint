import { redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printJobs } from '$lib/server/db/schema';
import { hasRole } from '$lib/server/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');

	// Staff see the approvals badge in the shared sidebar.
	let pendingApprovals = 0;
	if (hasRole(user, 'teacher')) {
		const pending = await db
			.select({ id: printJobs.id })
			.from(printJobs)
			.where(and(eq(printJobs.orgId, user.orgId), eq(printJobs.status, 'pending_approval')));
		pendingApprovals = pending.length;
	}
	return { user, pendingApprovals };
};
