import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users, orgs, printJobs, printers } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import type { PageServerLoad } from './$types';

const COUNTED = ['printing', 'paused', 'awaiting_pickup', 'completed'] as const;

export const load: PageServerLoad = async ({ params, locals }) => {
	const me = requireAdmin(locals.user);
	const [member] = await db
		.select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt })
		.from(users)
		.where(and(eq(users.id, params.id), eq(users.orgId, me.orgId)))
		.limit(1);
	if (!member) throw error(404, 'Member not found');

	const [org] = await db.select().from(orgs).where(eq(orgs.id, me.orgId)).limit(1);
	const costPerKg = Number(org?.defaultCostPerKg ?? 25);

	const jobs = await db
		.select({
			id: printJobs.id,
			name: printJobs.name,
			status: printJobs.status,
			grams: sql<number>`coalesce(${printJobs.actualGrams}, ${printJobs.estimatedGrams}, 0)`,
			colorRequest: printJobs.colorRequest,
			printerName: printers.name,
			createdAt: printJobs.createdAt,
			finishedAt: printJobs.finishedAt
		})
		.from(printJobs)
		.leftJoin(printers, eq(printJobs.printerId, printers.id))
		.where(and(eq(printJobs.orgId, me.orgId), eq(printJobs.userId, params.id)))
		.orderBy(desc(printJobs.createdAt));

	const counted = jobs.filter((j) => (COUNTED as readonly string[]).includes(j.status));
	const grams = Math.round(counted.reduce((s, j) => s + Number(j.grams), 0));
	return {
		member,
		jobs,
		stats: { prints: counted.length, grams, cost: (grams / 1000) * costPerKg }
	};
};
