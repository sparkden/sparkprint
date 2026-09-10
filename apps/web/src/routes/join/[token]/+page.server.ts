import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { invites, orgs, users } from '$lib/server/db/schema';
import { hashPassword, createSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

async function loadInvite(token: string) {
	const [row] = await db
		.select({ invite: invites, orgName: orgs.name })
		.from(invites)
		.innerJoin(orgs, eq(invites.orgId, orgs.id))
		.where(eq(invites.token, token))
		.limit(1);
	return row ?? null;
}

function inviteState(inv: typeof invites.$inferSelect) {
	if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return 'expired';
	if (inv.maxUses != null && inv.uses >= inv.maxUses) return 'exhausted';
	return 'ok';
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const row = await loadInvite(params.token);
	if (!row) return { status: 'invalid' as const };
	const state = inviteState(row.invite);
	return {
		status: state,
		orgName: row.orgName,
		role: row.invite.role,
		lockedEmail: row.invite.email,
		alreadyLoggedIn: !!locals.user
	};
};

const schema = z.object({
	name: z.string().min(2, 'Enter your name').max(80),
	email: z.string().email('Enter a valid email'),
	password: z.string().min(8, 'Use at least 8 characters')
});

export const actions: Actions = {
	default: async ({ params, request, cookies }) => {
		const row = await loadInvite(params.token);
		if (!row) return fail(400, { error: 'This invite is no longer valid.' });
		if (inviteState(row.invite) !== 'ok') return fail(400, { error: 'This invite has expired or been used up.' });

		const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const { name, email, password } = parsed.data;

		if (row.invite.email && row.invite.email.toLowerCase() !== email.toLowerCase()) {
			return fail(400, { error: `This invite is for ${row.invite.email}.` });
		}

		// Duplicate email within this org?
		const existing = await db
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.orgId, row.invite.orgId), sql`lower(${users.email}) = ${email.toLowerCase()}`))
			.limit(1);
		if (existing.length) return fail(400, { error: 'You already have an account — please log in.' });

		const passwordHash = await hashPassword(password);
		let userId: string;
		try {
			userId = await db.transaction(async (tx) => {
				const [u] = await tx
					.insert(users)
					.values({
						orgId: row.invite.orgId,
						email,
						name,
						passwordHash,
						role: row.invite.role,
						status: 'active',
						monthlyGramLimit: row.invite.monthlyGramLimit,
						monthlyJobLimit: row.invite.monthlyJobLimit
					})
					.returning();
				await tx
					.update(invites)
					.set({ uses: sql`${invites.uses} + 1` })
					.where(eq(invites.id, row.invite.id));
				return u.id;
			});
		} catch {
			return fail(400, { error: 'Could not create your account. Try a different email.' });
		}

		await createSession(userId, cookies);
		const dest = row.invite.role === 'student' || row.invite.role === 'teacher' ? '/app' : '/admin';
		throw redirect(303, dest);
	}
};
