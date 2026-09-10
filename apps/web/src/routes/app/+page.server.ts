import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printJobs, printers } from '$lib/server/db/schema';
import { getUsage } from '$lib/server/quota';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const [usage, recent, printerRows] = await Promise.all([
		getUsage(user.id),
		db
			.select({
				id: printJobs.id,
				name: printJobs.name,
				status: printJobs.status,
				createdAt: printJobs.createdAt,
				estimatedGrams: printJobs.estimatedGrams
			})
			.from(printJobs)
			.where(eq(printJobs.userId, user.id))
			.orderBy(desc(printJobs.createdAt))
			.limit(6),
		db
			.select({ id: printers.id, status: printers.status, online: printers.online, enabled: printers.enabled })
			.from(printers)
			.where(and(eq(printers.orgId, user.orgId), eq(printers.enabled, true)))
	]);

	const available = printerRows.filter(
		(p) => p.online && (p.status === 'idle' || p.status === 'finished')
	).length;

	const activeMine = await db
		.select({ id: printJobs.id })
		.from(printJobs)
		.where(
			and(
				eq(printJobs.userId, user.id),
				inArray(printJobs.status, ['queued', 'slicing', 'ready', 'sending', 'printing', 'pending_approval'])
			)
		);

	return {
		usage,
		recent,
		printerCount: printerRows.length,
		available,
		activeCount: activeMine.length
	};
};
