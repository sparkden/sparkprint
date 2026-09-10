import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printJobs, users, printers } from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/guards';
import { cancelJob, completeJob } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

const ACTIVE = ['pending_approval', 'queued', 'slicing', 'ready', 'sending', 'printing', 'paused'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireStaff(locals.user);
	const base = db
		.select({
			id: printJobs.id,
			name: printJobs.name,
			status: printJobs.status,
			estimatedGrams: printJobs.estimatedGrams,
			estimatedTimeSec: printJobs.estimatedTimeSec,
			submittedAt: printJobs.submittedAt,
			finishedAt: printJobs.finishedAt,
			colorRequest: printJobs.colorRequest,
			ownerName: users.name,
			printerName: printers.name,
			progressPct: printers.progressPct
		})
		.from(printJobs)
		.innerJoin(users, eq(printJobs.userId, users.id))
		.leftJoin(printers, eq(printJobs.printerId, printers.id));

	const active = await base
		.where(and(eq(printJobs.orgId, me.orgId), inArray(printJobs.status, ACTIVE)))
		.orderBy(asc(printJobs.priority), asc(printJobs.submittedAt));

	const recent = await db
		.select({
			id: printJobs.id,
			name: printJobs.name,
			status: printJobs.status,
			finishedAt: printJobs.finishedAt,
			actualGrams: printJobs.actualGrams,
			estimatedGrams: printJobs.estimatedGrams,
			ownerName: users.name
		})
		.from(printJobs)
		.innerJoin(users, eq(printJobs.userId, users.id))
		.where(and(eq(printJobs.orgId, me.orgId), inArray(printJobs.status, ['completed', 'failed', 'canceled', 'rejected'])))
		.orderBy(desc(printJobs.updatedAt))
		.limit(10);

	return {
		printing: active.filter((j) => ['printing', 'sending', 'paused'].includes(j.status)),
		queued: active.filter((j) => ['queued', 'slicing', 'ready'].includes(j.status)),
		pending: active.filter((j) => j.status === 'pending_approval'),
		recent,
		queueEnabled: me.queueEnabled
	};
};

export const actions: Actions = {
	cancel: async ({ request, locals }) => {
		const me = requireStaff(locals.user);
		const r = await cancelJob(String((await request.formData()).get('jobId')), me.orgId, me.id);
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	},
	complete: async ({ request, locals }) => {
		const me = requireStaff(locals.user);
		await completeJob(String((await request.formData()).get('jobId')));
		return { success: true };
	}
};
