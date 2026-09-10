import { and, asc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printJobs, models, users } from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/guards';
import { approveJob, rejectJob } from '$lib/server/jobs';
import { getUsage } from '$lib/server/quota';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireStaff(locals.user);
	const rows = await db
		.select({
			job: printJobs,
			modelId: models.id,
			thumbnailKey: models.thumbnailKey,
			ownerName: users.name,
			ownerId: users.id
		})
		.from(printJobs)
		.leftJoin(models, eq(printJobs.modelId, models.id))
		.innerJoin(users, eq(printJobs.userId, users.id))
		.where(and(eq(printJobs.orgId, me.orgId), eq(printJobs.status, 'pending_approval')))
		.orderBy(asc(printJobs.submittedAt));

	// Attach each requester's current usage so approvers have context.
	const pending = await Promise.all(
		rows.map(async (r) => ({ ...r, usage: await getUsage(r.ownerId) }))
	);
	return { pending };
};

export const actions: Actions = {
	approve: async ({ request, locals }) => {
		const me = requireStaff(locals.user);
		const fd = await request.formData();
		const r = await approveJob(String(fd.get('jobId')), me.orgId, me.id, String(fd.get('note') ?? ''));
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	},
	reject: async ({ request, locals }) => {
		const me = requireStaff(locals.user);
		const fd = await request.formData();
		const note = String(fd.get('note') ?? '');
		const r = await rejectJob(String(fd.get('jobId')), me.orgId, me.id, note);
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	}
};
