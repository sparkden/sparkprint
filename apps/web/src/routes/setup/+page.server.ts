import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { orgs, users, invites } from '$lib/server/db/schema';
import { hashPassword, createSession } from '$lib/server/auth';
import { slugify, inviteToken } from '$lib/server/util';
import { markInitialized } from '$lib/server/setup';
import { login, sendEmailCode, loginWithCode } from '$lib/server/bambu/cloud';
import { createCloudAccount } from '$lib/server/printers';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	let org = null;
	if (locals.user) {
		[org] = await db.select().from(orgs).where(eq(orgs.id, locals.user.orgId)).limit(1);
	}
	return { user: locals.user, org: org ?? null };
};

const optInt = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).nullable());

export const actions: Actions = {
	// Step 1 — create the lab + owner, sign in.
	createLab: async ({ request, cookies }) => {
		const form = Object.fromEntries(await request.formData());
		const parsed = z
			.object({
				schoolName: z.string().min(2, 'Enter your lab name').max(80),
				name: z.string().min(2, 'Enter your name').max(80),
				email: z.string().email('Enter a valid email'),
				password: z.string().min(8, 'Use at least 8 characters')
			})
			.safeParse(form);
		if (!parsed.success) return fail(400, { step: 1, values: form, error: parsed.error.issues[0].message });
		const { schoolName, name, email, password } = parsed.data;

		let slug = slugify(schoolName) || 'lab';
		const exists = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
		if (exists.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
		const passwordHash = await hashPassword(password);

		let userId: string;
		try {
			userId = await db.transaction(async (tx) => {
				const [org] = await tx.insert(orgs).values({ name: schoolName, slug }).returning();
				const [u] = await tx
					.insert(users)
					.values({ orgId: org.id, email, name, passwordHash, role: 'owner', status: 'active' })
					.returning();
				return u.id;
			});
		} catch {
			return fail(400, { step: 1, values: form, error: 'Could not create the lab — that email may be in use.' });
		}
		markInitialized();
		await createSession(userId, cookies);
		return { step: 1, created: true };
	},

	// Step 2 — lab policies.
	savePolicies: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { step: 2, error: 'Not signed in' });
		const raw = Object.fromEntries(await request.formData());
		const parsed = z
			.object({
				queueEnabled: z.coerce.boolean(),
				approvalMode: z.coerce.boolean(),
				defaultMonthlyGramLimit: optInt,
				defaultMonthlyJobLimit: optInt,
				defaultCostPerKg: z.coerce.number().min(0).max(9999)
			})
			.safeParse({
				queueEnabled: raw.queueEnabled === 'on',
				approvalMode: raw.approvalMode === 'on',
				defaultMonthlyGramLimit: raw.defaultMonthlyGramLimit,
				defaultMonthlyJobLimit: raw.defaultMonthlyJobLimit,
				defaultCostPerKg: raw.defaultCostPerKg
			});
		if (!parsed.success) return fail(400, { step: 2, error: 'Check the policy values.' });
		const d = parsed.data;
		await db
			.update(orgs)
			.set({
				queueEnabled: d.queueEnabled,
				approvalMode: d.approvalMode,
				defaultMonthlyGramLimit: d.defaultMonthlyGramLimit,
				defaultMonthlyJobLimit: d.defaultMonthlyJobLimit,
				defaultCostPerKg: d.defaultCostPerKg.toFixed(2),
				updatedAt: new Date()
			})
			.where(eq(orgs.id, locals.user.orgId));
		return { step: 2, saved: true };
	},

	// Step 3 — connect Bambu (two-step, optional).
	bambuLogin: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { step: 3, error: 'Not signed in' });
		const fd = await request.formData();
		const parsed = z
			.object({ email: z.string().email(), password: z.string().min(1), region: z.enum(['us', 'eu', 'cn']) })
			.safeParse({ email: fd.get('email'), password: fd.get('password'), region: fd.get('region') });
		if (!parsed.success) return fail(400, { step: 3, error: 'Enter your Bambu email, password, and region.' });
		const { email, password, region } = parsed.data;
		const r = await login(email, password, region);
		if (r.status === 'ok') {
			const { imported } = await createCloudAccount(locals.user.orgId, { email, region, uid: r.uid, accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt });
			return { step: 3, connected: true, imported };
		}
		if (r.status === 'needCode') {
			await sendEmailCode(email, region);
			return { step: 3, needCode: true, email, region };
		}
		if (r.status === 'needTfa') return fail(400, { step: 3, error: 'This account uses app-based 2FA, which isn’t supported yet. Use an email-code account.' });
		return fail(400, { step: 3, error: r.message });
	},

	bambuVerify: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { step: 3, error: 'Not signed in' });
		const fd = await request.formData();
		const parsed = z
			.object({ email: z.string().email(), region: z.enum(['us', 'eu', 'cn']), code: z.string().min(4).max(10) })
			.safeParse({ email: fd.get('email'), region: fd.get('region'), code: fd.get('code') });
		if (!parsed.success) return fail(400, { step: 3, error: 'Enter the verification code.' });
		const { email, region, code } = parsed.data;
		const r = await loginWithCode(email, code, region);
		if (r.status !== 'ok') return fail(400, { step: 3, needCode: true, email, region, error: r.status === 'error' ? r.message : 'Verification failed.' });
		const { imported } = await createCloudAccount(locals.user.orgId, { email, region, uid: r.uid, accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt });
		return { step: 3, connected: true, imported };
	},

	// Step 4 — create a student invite link.
	createInvite: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { step: 4, error: 'Not signed in' });
		const fd = await request.formData();
		const role = z.enum(['admin', 'teacher', 'student']).catch('student').parse(fd.get('role'));
		const token = inviteToken();
		await db.insert(invites).values({ orgId: locals.user.orgId, token, role, createdBy: locals.user.id });
		return { step: 4, inviteToken: token };
	}
};
