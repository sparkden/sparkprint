import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { invites, users } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { inviteToken } from '$lib/server/util';
import { qrSvg } from '$lib/server/qr';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const me = requireAdmin(locals.user);
	const rows = await db
		.select({
			id: invites.id,
			token: invites.token,
			role: invites.role,
			email: invites.email,
			monthlyGramLimit: invites.monthlyGramLimit,
			monthlyJobLimit: invites.monthlyJobLimit,
			maxUses: invites.maxUses,
			uses: invites.uses,
			expiresAt: invites.expiresAt,
			createdAt: invites.createdAt,
			createdByName: users.name
		})
		.from(invites)
		.leftJoin(users, eq(invites.createdBy, users.id))
		.where(eq(invites.orgId, me.orgId))
		.orderBy(desc(invites.createdAt));
	// A scannable QR for each join link (points at the public origin so phones can reach it).
	const withQr = await Promise.all(
		rows.map(async (r) => ({ ...r, qr: await qrSvg(`${url.origin}/join/${r.token}`) }))
	);
	return { invites: withQr, origin: url.origin };
};

const optInt = z.preprocess(
	(v) => (v === '' || v == null ? null : Number(v)),
	z.number().int().min(0).nullable()
);

const schema = z.object({
	role: z.enum(['admin', 'teacher', 'student']),
	email: z.preprocess((v) => (v ? String(v) : null), z.string().email().nullable()),
	monthlyGramLimit: optInt,
	monthlyJobLimit: optInt,
	maxUses: optInt,
	expiresInDays: optInt
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;
		const expiresAt = d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 864e5) : null;
		await db.insert(invites).values({
			orgId: me.orgId,
			token: inviteToken(),
			role: d.role,
			email: d.email,
			monthlyGramLimit: d.monthlyGramLimit,
			monthlyJobLimit: d.monthlyJobLimit,
			maxUses: d.maxUses,
			expiresAt,
			createdBy: me.id
		});
		return { success: true };
	},

	revoke: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const id = String((await request.formData()).get('id'));
		await db.delete(invites).where(and(eq(invites.id, id), eq(invites.orgId, me.orgId)));
		return { success: true };
	}
};
