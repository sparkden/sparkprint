import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printers, users, printJobs } from '$lib/server/db/schema';
import { monthStart } from '$lib/server/util';
import { QUOTA_STATUSES } from '$lib/server/quota';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const orgId = locals.user!.orgId;
	const periodStart = monthStart();

	const [printerRows, memberCount, monthAgg, recentJobs] = await Promise.all([
		db
			.select({
				id: printers.id,
				name: printers.name,
				model: printers.model,
				status: printers.status,
				online: printers.online,
				enabled: printers.enabled,
				progressPct: printers.progressPct,
				location: printers.location
			})
			.from(printers)
			.where(eq(printers.orgId, orgId))
			.orderBy(printers.name),
		db
			.select({ n: sql<number>`count(*)` })
			.from(users)
			.where(eq(users.orgId, orgId)),
		db
			.select({
				grams: sql<number>`coalesce(sum(coalesce(${printJobs.actualGrams}, ${printJobs.estimatedGrams}, 0)), 0)`,
				jobs: sql<number>`count(*)`
			})
			.from(printJobs)
			.where(
				and(
					eq(printJobs.orgId, orgId),
					gte(printJobs.submittedAt, periodStart),
					inArray(printJobs.status, QUOTA_STATUSES)
				)
			),
		db
			.select({
				id: printJobs.id,
				name: printJobs.name,
				status: printJobs.status,
				createdAt: printJobs.createdAt,
				userName: users.name
			})
			.from(printJobs)
			.innerJoin(users, eq(printJobs.userId, users.id))
			.where(eq(printJobs.orgId, orgId))
			.orderBy(desc(printJobs.createdAt))
			.limit(8)
	]);

	return {
		printers: printerRows,
		onlinePrinters: printerRows.filter((p) => p.online).length,
		memberCount: Number(memberCount[0]?.n ?? 0),
		gramsThisMonth: Math.round(Number(monthAgg[0]?.grams ?? 0)),
		jobsThisMonth: Number(monthAgg[0]?.jobs ?? 0),
		recentJobs
	};
};
