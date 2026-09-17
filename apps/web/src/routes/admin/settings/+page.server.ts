import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { orgs } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.user);
	const [org] = await db.select().from(orgs).where(eq(orgs.id, locals.user!.orgId)).limit(1);
	return { org };
};

const optInt = z.preprocess(
	(v) => (v === '' || v == null ? null : Number(v)),
	z.number().int().min(0).nullable()
);

const schema = z.object({
	name: z.string().min(2).max(80),
	queueEnabled: z.coerce.boolean(),
	approvalMode: z.coerce.boolean(),
	defaultMonthlyGramLimit: optInt,
	defaultMonthlyJobLimit: optInt,
	defaultCostPerKg: z.coerce.number().min(0).max(9999),
	// Staff/admin default quota (applies to staff, admins & owners instead of the student default).
	staffGramLimit: optInt,
	staffJobLimit: optInt,
	// Let staff & admins skip the approval queue even when approval mode is on.
	bypassApprovalStaff: z.coerce.boolean(),
	// Public URL students scan on the kiosk QR to reach the app on their phones.
	appUrl: z.preprocess(
		(v) => (v ? String(v).trim() : ''),
		z.string().url('Enter a full URL like https://print.ethans.app').or(z.literal(''))
	)
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireAdmin(locals.user);
		const raw = Object.fromEntries(await request.formData());
		const form = {
			...raw,
			queueEnabled: raw.queueEnabled === 'on',
			approvalMode: raw.approvalMode === 'on',
			bypassApprovalStaff: raw.bypassApprovalStaff === 'on'
		};
		const parsed = schema.safeParse(form);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const d = parsed.data;
		const [org] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, locals.user!.orgId)).limit(1);
		const settings = {
			...(org?.settings ?? {}),
			appUrl: d.appUrl || undefined,
			staffGramLimit: d.staffGramLimit ?? undefined,
			staffJobLimit: d.staffJobLimit ?? undefined,
			bypassApprovalStaff: d.bypassApprovalStaff
		};
		await db
			.update(orgs)
			.set({
				name: d.name,
				queueEnabled: d.queueEnabled,
				approvalMode: d.approvalMode,
				defaultMonthlyGramLimit: d.defaultMonthlyGramLimit,
				defaultMonthlyJobLimit: d.defaultMonthlyJobLimit,
				defaultCostPerKg: d.defaultCostPerKg.toFixed(2),
				settings,
				updatedAt: new Date()
			})
			.where(eq(orgs.id, locals.user!.orgId));

		return { success: true };
	}
};
