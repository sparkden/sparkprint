import { redirect, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printers, printJobs, users, models } from '$lib/server/db/schema';
import { checkoutJob } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

// Fullscreen lab monitor for the shared lab computer. Any signed-in member can view + check out
// finished prints (physical kiosk — whoever is at the lab pulls a print off and checks it out).
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login?next=/monitor');

	const rows = await db
		.select({
			id: printers.id,
			name: printers.name,
			model: printers.model,
			status: printers.status,
			online: printers.online,
			enabled: printers.enabled,
			progressPct: printers.progressPct,
			remainingTimeMin: printers.remainingTimeMin,
			jobId: printJobs.id,
			jobName: printJobs.name,
			jobStatus: printJobs.status,
			ownerName: users.name,
			modelName: models.name,
			colorRequest: printJobs.colorRequest
		})
		.from(printers)
		.leftJoin(printJobs, eq(printers.currentJobId, printJobs.id))
		.leftJoin(users, eq(printJobs.userId, users.id))
		.leftJoin(models, eq(printJobs.modelId, models.id))
		.where(eq(printers.orgId, user.orgId))
		.orderBy(asc(printers.name));

	// Jobs waiting for a printer (queue depth shown on the board).
	const queue = await db
		.select({ id: printJobs.id, name: printJobs.name, ownerName: users.name, status: printJobs.status })
		.from(printJobs)
		.innerJoin(users, eq(printJobs.userId, users.id))
		.where(and(eq(printJobs.orgId, user.orgId), inArray(printJobs.status, ['queued', 'slicing', 'ready', 'sending', 'pending_approval'])))
		.orderBy(desc(printJobs.priority), asc(printJobs.createdAt))
		.limit(12);

	return { printers: rows, queue, orgName: user.orgName, isStaff: ['owner', 'admin', 'teacher'].includes(user.role) };
};

export const actions: Actions = {
	checkout: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) return fail(401, { error: 'Sign in' });
		const jobId = String((await request.formData()).get('jobId'));
		const r = await checkoutJob(jobId, user.orgId, user.id);
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	}
};
