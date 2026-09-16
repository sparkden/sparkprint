import { and, asc, desc, eq } from 'drizzle-orm';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printJobs, models, printers, users, jobEvents } from '$lib/server/db/schema';
import { cancelJob, completeJob, checkoutJob, reprintJob } from '$lib/server/jobs';
import { hasRole } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user!;
	const [row] = await db
		.select({
			job: printJobs,
			modelName: models.name,
			thumbnailKey: models.thumbnailKey,
			printerName: printers.name,
			ownerName: users.name
		})
		.from(printJobs)
		.leftJoin(models, eq(printJobs.modelId, models.id))
		.leftJoin(printers, eq(printJobs.printerId, printers.id))
		.innerJoin(users, eq(printJobs.userId, users.id))
		.where(and(eq(printJobs.id, params.id), eq(printJobs.orgId, user.orgId)))
		.limit(1);
	if (!row) throw error(404, 'Print not found');

	// Students can only view their own prints.
	const isStaff = hasRole(user, 'teacher');
	if (!isStaff && row.job.userId !== user.id) throw error(403, 'Not your print');

	const events = await db
		.select({ e: jobEvents, actorName: users.name })
		.from(jobEvents)
		.leftJoin(users, eq(jobEvents.actorId, users.id))
		.where(eq(jobEvents.jobId, params.id))
		.orderBy(desc(jobEvents.createdAt));

	return {
		job: row.job,
		modelName: row.modelName,
		thumbnailKey: row.thumbnailKey,
		printerName: row.printerName,
		ownerName: row.ownerName,
		events: events.map((x) => ({ ...x.e, actorName: x.actorName })),
		isStaff,
		isOwner: row.job.userId === user.id
	};
};

export const actions: Actions = {
	cancel: async ({ params, locals }) => {
		const user = locals.user!;
		const [job] = await db
			.select({ userId: printJobs.userId })
			.from(printJobs)
			.where(and(eq(printJobs.id, params.id), eq(printJobs.orgId, user.orgId)))
			.limit(1);
		if (!job) return fail(404, { error: 'Not found' });
		if (job.userId !== user.id && !hasRole(user, 'teacher'))
			return fail(403, { error: 'Not allowed' });
		const r = await cancelJob(params.id, user.orgId, user.id);
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	},

	// Mark the print finished (staff only) — moves it to "awaiting pickup".
	complete: async ({ params, locals }) => {
		const user = locals.user!;
		if (!hasRole(user, 'teacher')) return fail(403, { error: 'Not allowed' });
		const [job] = await db
			.select({ id: printJobs.id })
			.from(printJobs)
			.where(and(eq(printJobs.id, params.id), eq(printJobs.orgId, user.orgId)))
			.limit(1);
		if (!job) return fail(404, { error: 'Not found' });
		await completeJob(params.id);
		return { success: true };
	},

	// Check out a finished print (removed from the bed) → frees the printer. Owner or staff.
	checkout: async ({ params, locals }) => {
		const user = locals.user!;
		const [job] = await db
			.select({ userId: printJobs.userId })
			.from(printJobs)
			.where(and(eq(printJobs.id, params.id), eq(printJobs.orgId, user.orgId)))
			.limit(1);
		if (!job) return fail(404, { error: 'Not found' });
		if (job.userId !== user.id && !hasRole(user, 'teacher')) return fail(403, { error: 'Not allowed' });
		const r = await checkoutJob(params.id, user.orgId, user.id);
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	},

	// Re-queue this print again (same model/color/settings, same printer model). Owner or staff.
	reprint: async ({ params, locals }) => {
		const user = locals.user!;
		const [job] = await db
			.select({ userId: printJobs.userId })
			.from(printJobs)
			.where(and(eq(printJobs.id, params.id), eq(printJobs.orgId, user.orgId)))
			.limit(1);
		if (!job) return fail(404, { error: 'Not found' });
		if (job.userId !== user.id && !hasRole(user, 'teacher')) return fail(403, { error: 'Not allowed' });
		const r = await reprintJob(params.id, user.orgId, user.id);
		if (!r.ok) return fail(400, { error: r.error });
		throw redirect(303, `/app/jobs/${r.jobId}`);
	}
};
