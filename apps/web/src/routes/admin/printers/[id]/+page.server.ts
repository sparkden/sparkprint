import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printers, amsUnits, amsSlots } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { BAMBU_BASIC } from '$lib/server/bambu';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const me = requireAdmin(locals.user);
	const [printer] = await db
		.select()
		.from(printers)
		.where(and(eq(printers.id, params.id), eq(printers.orgId, me.orgId)))
		.limit(1);
	if (!printer) throw error(404, 'Printer not found');

	const units = await db
		.select()
		.from(amsUnits)
		.where(eq(amsUnits.printerId, printer.id))
		.orderBy(asc(amsUnits.amsIndex));

	const unitsWithSlots = await Promise.all(
		units.map(async (u) => ({
			...u,
			slots: await db
				.select()
				.from(amsSlots)
				.where(eq(amsSlots.amsUnitId, u.id))
				.orderBy(asc(amsSlots.slotIndex))
		}))
	);

	return { printer, units: unitsWithSlots, palette: BAMBU_BASIC };
};

const slotSchema = z.object({
	slotId: z.string(),
	empty: z.coerce.boolean(),
	filamentType: z.string().max(20),
	filamentBrand: z.string().max(40),
	colorHex: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
	colorName: z.string().max(40),
	remainingPct: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).max(100).nullable())
});

export const actions: Actions = {
	saveSlot: async ({ request, params, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const parsed = slotSchema.safeParse({
			slotId: fd.get('slotId'),
			empty: fd.get('empty') === 'on' || fd.get('empty') === 'true',
			filamentType: fd.get('filamentType') ?? '',
			filamentBrand: fd.get('filamentBrand') ?? '',
			colorHex: fd.get('colorHex') ?? '#000000',
			colorName: fd.get('colorName') ?? '',
			remainingPct: fd.get('remainingPct')
		});
		if (!parsed.success) return fail(400, { error: 'Check the slot values.' });
		const d = parsed.data;

		// Ensure the slot belongs to a printer in this org.
		const [slot] = await db
			.select({ id: amsSlots.id })
			.from(amsSlots)
			.innerJoin(printers, eq(amsSlots.printerId, printers.id))
			.where(and(eq(amsSlots.id, d.slotId), eq(printers.orgId, me.orgId), eq(printers.id, params.id)))
			.limit(1);
		if (!slot) return fail(404, { error: 'Slot not found' });

		await db
			.update(amsSlots)
			.set({
				empty: d.empty,
				filamentType: d.empty ? null : d.filamentType || 'PLA',
				filamentBrand: d.empty ? null : d.filamentBrand || 'Bambu',
				colorHex: d.empty ? null : d.colorHex.startsWith('#') ? d.colorHex : `#${d.colorHex}`,
				colorName: d.empty ? null : d.colorName || null,
				remainingPct: d.empty ? null : d.remainingPct,
				updatedAt: new Date()
			})
			.where(eq(amsSlots.id, d.slotId));
		return { success: true };
	}
};
