import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { printJobs, users, orgs } from './db/schema';
import { monthStart } from './util';

// Statuses that consume quota (material has been / will be committed).
export const QUOTA_STATUSES = [
	'queued',
	'slicing',
	'ready',
	'sending',
	'printing',
	'paused',
	'completed'
] as const;

export type QuotaUsage = {
	gramsUsed: number;
	jobsUsed: number;
	gramLimit: number | null; // null = unlimited
	jobLimit: number | null;
	gramsRemaining: number | null;
	jobsRemaining: number | null;
	periodStart: Date;
};

/** Effective limits: user override wins, else org default, else unlimited. */
export function effectiveLimits(
	user: { monthlyGramLimit: number | null; monthlyJobLimit: number | null },
	org: { defaultMonthlyGramLimit: number | null; defaultMonthlyJobLimit: number | null }
) {
	return {
		gramLimit: user.monthlyGramLimit ?? org.defaultMonthlyGramLimit ?? null,
		jobLimit: user.monthlyJobLimit ?? org.defaultMonthlyJobLimit ?? null
	};
}

export async function getUsage(userId: string): Promise<QuotaUsage> {
	const periodStart = monthStart();

	const [u] = await db
		.select({
			role: users.role,
			monthlyGramLimit: users.monthlyGramLimit,
			monthlyJobLimit: users.monthlyJobLimit,
			defG: orgs.defaultMonthlyGramLimit,
			defJ: orgs.defaultMonthlyJobLimit,
			settings: orgs.settings
		})
		.from(users)
		.innerJoin(orgs, eq(users.orgId, orgs.id))
		.where(eq(users.id, userId))
		.limit(1);

	const [agg] = await db
		.select({
			grams: sql<number>`coalesce(sum(coalesce(${printJobs.actualGrams}, ${printJobs.estimatedGrams}, 0)), 0)`,
			jobs: sql<number>`count(*)`
		})
		.from(printJobs)
		.where(
			and(
				eq(printJobs.userId, userId),
				gte(printJobs.submittedAt, periodStart),
				inArray(printJobs.status, QUOTA_STATUSES)
			)
		);

	// Staff/admins/owners use the "staff default" quota (from org settings) instead of the student
	// default. An individual per-person override still wins; blank staff default = unlimited.
	const isStaff = ['owner', 'admin', 'teacher'].includes(u?.role ?? 'student');
	const st = (u?.settings ?? {}) as Record<string, unknown>;
	const staffG = typeof st.staffGramLimit === 'number' ? st.staffGramLimit : null;
	const staffJ = typeof st.staffJobLimit === 'number' ? st.staffJobLimit : null;
	const gramLimit = u?.monthlyGramLimit ?? (isStaff ? staffG : u?.defG) ?? null;
	const jobLimit = u?.monthlyJobLimit ?? (isStaff ? staffJ : u?.defJ) ?? null;
	const gramsUsed = Math.round(Number(agg?.grams ?? 0));
	const jobsUsed = Number(agg?.jobs ?? 0);

	return {
		gramsUsed,
		jobsUsed,
		gramLimit,
		jobLimit,
		gramsRemaining: gramLimit == null ? null : Math.max(0, gramLimit - gramsUsed),
		jobsRemaining: jobLimit == null ? null : Math.max(0, jobLimit - jobsUsed),
		periodStart
	};
}

/** Check whether a user can submit a job of `grams`. */
export async function canSubmit(
	userId: string,
	grams: number
): Promise<{ ok: boolean; reason?: string; usage: QuotaUsage }> {
	const usage = await getUsage(userId);
	if (usage.jobLimit != null && usage.jobsUsed >= usage.jobLimit) {
		return { ok: false, reason: 'Monthly print limit reached', usage };
	}
	if (usage.gramLimit != null && usage.gramsUsed + grams > usage.gramLimit) {
		return { ok: false, reason: 'This print would exceed your monthly filament quota', usage };
	}
	return { ok: true, usage };
}
