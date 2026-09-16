import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users, orgs, printJobs } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireAdmin(locals.user);
	const [org] = await db.select().from(orgs).where(eq(orgs.id, me.orgId)).limit(1);
	const members = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			role: users.role,
			status: users.status,
			monthlyGramLimit: users.monthlyGramLimit,
			monthlyJobLimit: users.monthlyJobLimit,
			lastLoginAt: users.lastLoginAt,
			createdAt: users.createdAt
		})
		.from(users)
		.where(eq(users.orgId, me.orgId))
		.orderBy(desc(users.createdAt));

	// Lifetime print stats per user (prints that actually consumed material).
	const stats = await db
		.select({
			userId: printJobs.userId,
			prints: sql<number>`count(*)`,
			grams: sql<number>`coalesce(sum(coalesce(${printJobs.actualGrams}, ${printJobs.estimatedGrams}, 0)), 0)`
		})
		.from(printJobs)
		.where(and(eq(printJobs.orgId, me.orgId), inArray(printJobs.status, ['printing', 'paused', 'awaiting_pickup', 'completed'])))
		.groupBy(printJobs.userId);

	const costPerKg = Number(org?.defaultCostPerKg ?? 25);
	const byUser = new Map(stats.map((s) => [s.userId, s]));
	const withStats = members.map((m) => {
		const s = byUser.get(m.id);
		const grams = Math.round(Number(s?.grams ?? 0));
		return { ...m, prints: Number(s?.prints ?? 0), grams, cost: (grams / 1000) * costPerKg };
	});

	return { org, members: withStats, costPerKg, meId: me.id, myRole: me.role };
};

async function target(orgId: string, userId: string) {
	const [u] = await db
		.select()
		.from(users)
		.where(and(eq(users.id, userId), eq(users.orgId, orgId)))
		.limit(1);
	return u ?? null;
}

const optInt = z.preprocess(
	(v) => (v === '' || v == null ? null : Number(v)),
	z.number().int().min(0).nullable()
);

export const actions: Actions = {
	updateRole: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const userId = String(fd.get('userId'));
		const role = z.enum(['owner', 'admin', 'teacher', 'student']).safeParse(fd.get('role'));
		if (!role.success) return fail(400, { error: 'Invalid role' });

		const u = await target(me.orgId, userId);
		if (!u) return fail(404, { error: 'Member not found' });
		// Only owners can grant/revoke owner or admin.
		if ((u.role === 'owner' || role.data === 'owner') && me.role !== 'owner')
			return fail(403, { error: 'Only an owner can change owners.' });

		// Don't allow removing the last owner.
		if (u.role === 'owner' && role.data !== 'owner') {
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)` })
				.from(users)
				.where(and(eq(users.orgId, me.orgId), eq(users.role, 'owner')));
			if (Number(n) <= 1) return fail(400, { error: 'Your lab needs at least one owner.' });
		}
		await db.update(users).set({ role: role.data, updatedAt: new Date() }).where(eq(users.id, userId));
		return { success: true };
	},

	updateQuota: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const userId = String(fd.get('userId'));
		const g = optInt.safeParse(fd.get('monthlyGramLimit'));
		const j = optInt.safeParse(fd.get('monthlyJobLimit'));
		if (!g.success || !j.success) return fail(400, { error: 'Invalid quota' });
		const u = await target(me.orgId, userId);
		if (!u) return fail(404, { error: 'Member not found' });
		await db
			.update(users)
			.set({ monthlyGramLimit: g.data, monthlyJobLimit: j.data, updatedAt: new Date() })
			.where(eq(users.id, userId));
		return { success: true };
	},

	setStatus: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const userId = String(fd.get('userId'));
		const status = z.enum(['active', 'suspended']).safeParse(fd.get('status'));
		if (!status.success) return fail(400, { error: 'Invalid status' });
		if (userId === me.id) return fail(400, { error: "You can't change your own status." });
		const u = await target(me.orgId, userId);
		if (!u) return fail(404, { error: 'Member not found' });
		if (u.role === 'owner') return fail(403, { error: "You can't suspend an owner." });
		await db.update(users).set({ status: status.data, updatedAt: new Date() }).where(eq(users.id, userId));
		return { success: true };
	},

	remove: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const userId = String(fd.get('userId'));
		if (userId === me.id) return fail(400, { error: "You can't remove yourself." });
		const u = await target(me.orgId, userId);
		if (!u) return fail(404, { error: 'Member not found' });
		if (u.role === 'owner') return fail(403, { error: "You can't remove an owner." });
		await db.delete(users).where(eq(users.id, userId));
		return { success: true };
	}
};
