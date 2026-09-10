import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { filaments } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireAdmin(locals.user);
	const rows = await db
		.select()
		.from(filaments)
		.where(and(eq(filaments.orgId, me.orgId), eq(filaments.archived, false)))
		.orderBy(asc(filaments.type), asc(filaments.name));
	return { filaments: rows };
};

const optInt = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).nullable());
const optNum = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().min(0).nullable());

const schema = z.object({
	name: z.string().min(1).max(60),
	type: z.string().min(1).max(20),
	brand: z.string().min(1).max(40),
	colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	costPerKg: optNum,
	gramsInStock: optInt,
	lowStockThresholdG: optInt
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;
		await db.insert(filaments).values({
			orgId: me.orgId,
			name: d.name,
			type: d.type,
			brand: d.brand,
			colorHex: d.colorHex,
			costPerKg: d.costPerKg != null ? d.costPerKg.toFixed(2) : null,
			gramsInStock: d.gramsInStock,
			lowStockThresholdG: d.lowStockThresholdG
		});
		return { success: true };
	},
	update: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const id = String(fd.get('id'));
		const parsed = schema.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;
		await db
			.update(filaments)
			.set({
				name: d.name,
				type: d.type,
				brand: d.brand,
				colorHex: d.colorHex,
				costPerKg: d.costPerKg != null ? d.costPerKg.toFixed(2) : null,
				gramsInStock: d.gramsInStock,
				lowStockThresholdG: d.lowStockThresholdG,
				updatedAt: new Date()
			})
			.where(and(eq(filaments.id, id), eq(filaments.orgId, me.orgId)));
		return { success: true };
	},
	remove: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const id = String((await request.formData()).get('id'));
		await db.update(filaments).set({ archived: true }).where(and(eq(filaments.id, id), eq(filaments.orgId, me.orgId)));
		return { success: true };
	}
};
