import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printers, amsUnits, amsSlots } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { BAMBU_BASIC } from '$lib/server/bambu';
import { manager } from '$lib/server/bambu/manager';
import { freePrinter } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

async function ownedPrinter(orgId: string, id: string) {
	const [p] = await db.select().from(printers).where(and(eq(printers.id, id), eq(printers.orgId, orgId))).limit(1);
	return p ?? null;
}

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

	// The external spool lives as a pseudo-unit (amsIndex 254). Split it out from the AMS list.
	const externalUnit = unitsWithSlots.find((u) => u.amsIndex === 254);
	const amsOnly = unitsWithSlots.filter((u) => u.amsIndex !== 254);
	const externalSpool = externalUnit?.slots?.[0] ?? null;

	return { printer, units: amsOnly, externalSpool, palette: BAMBU_BASIC };
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
				manualColor: !d.empty, // admin-set → telemetry won't clobber it
				updatedAt: new Date()
			})
			.where(eq(amsSlots.id, d.slotId));
		return { success: true };
	},

	// Add an AMS unit (4 empty slots) to set colors manually.
	addAms: async ({ params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const existing = await db.select({ amsIndex: amsUnits.amsIndex }).from(amsUnits).where(eq(amsUnits.printerId, printer.id));
		const nextIndex = existing.length ? Math.max(...existing.map((u) => u.amsIndex)) + 1 : 0;
		db.transaction((tx) => {
			const unit = tx.insert(amsUnits).values({ printerId: printer.id, amsIndex: nextIndex }).returning().get()!;
			for (let s = 0; s < 4; s++) tx.insert(amsSlots).values({ amsUnitId: unit.id, printerId: printer.id, slotIndex: s, empty: true }).run();
			tx.update(printers).set({ hasAms: true, updatedAt: new Date() }).where(eq(printers.id, printer.id)).run();
		});
		return { success: true, message: `Added AMS ${nextIndex + 1}.` };
	},

	removeAms: async ({ request, params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const unitId = String((await request.formData()).get('unitId'));
		await db.delete(amsUnits).where(and(eq(amsUnits.id, unitId), eq(amsUnits.printerId, printer.id)));
		return { success: true };
	},

	// Ask the printer to push its live AMS/status over the local MQTT link.
	reloadAms: async ({ params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const ok = await manager().requestStatus(printer.id);
		return { success: true, message: ok ? 'Reloading from the printer…' : 'Printer not connected — check its LAN IP/access code.' };
	},

	// Unload the currently-loaded filament (works for AMS and the external spool).
	unloadFilament: async ({ params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const ok = await manager().unloadFilament(printer.id);
		return { success: true, message: ok ? 'Unloading filament… follow the prompt on the printer.' : 'Sent unload — the printer may be offline or blocking third-party control commands.' };
	},

	// Load the external spool (non-AMS printers). Heats the nozzle and feeds from the spool holder.
	loadSpool: async ({ params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const ok = await manager().loadExternal(printer.id);
		return { success: true, message: ok ? 'Loading the external spool… feed the filament when the printer prompts.' : 'Sent load — the printer may be offline or blocking third-party control commands.' };
	},

	// Set the external spool color for a printer without an AMS (single-color, prints use_ams=false).
	setSpool: async ({ request, params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const fd = await request.formData();
		const parsed = z
			.object({
				filamentType: z.string().min(1).max(20),
				colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
				colorName: z.string().max(40).optional(),
				clear: z.coerce.boolean().optional()
			})
			.safeParse({ filamentType: fd.get('filamentType') || 'PLA', colorHex: fd.get('colorHex'), colorName: fd.get('colorName') ?? undefined, clear: fd.get('clear') === 'true' });
		if (!parsed.success) return fail(400, { error: 'Pick a filament type and a valid color.' });
		const d = parsed.data;

		const EXT = 254;
		const [unit] = await db.select().from(amsUnits).where(and(eq(amsUnits.printerId, printer.id), eq(amsUnits.amsIndex, EXT))).limit(1);
		const unitId = unit?.id ?? (await db.insert(amsUnits).values({ printerId: printer.id, amsIndex: EXT }).returning())[0].id;
		const vals = d.clear
			? { printerId: printer.id, filamentType: null, colorHex: null, colorName: null, empty: true, manualColor: false, updatedAt: new Date() }
			: { printerId: printer.id, filamentType: d.filamentType, colorHex: d.colorHex.toUpperCase(), colorName: d.colorName || null, empty: false, remainingPct: 100, manualColor: true, updatedAt: new Date() };
		const [existing] = await db.select().from(amsSlots).where(and(eq(amsSlots.amsUnitId, unitId), eq(amsSlots.slotIndex, 0))).limit(1);
		if (existing) await db.update(amsSlots).set(vals).where(eq(amsSlots.id, existing.id));
		else await db.insert(amsSlots).values({ amsUnitId: unitId, slotIndex: 0, ...vals });
		return { success: true, message: d.clear ? 'External spool cleared.' : 'External spool color saved.' };
	},

	// Clear a stuck 'finished' printer (bed removed) so it can take new jobs again.
	markFree: async ({ params, locals }) => {
		const me = requireAdmin(locals.user);
		const printer = await ownedPrinter(me.orgId, params.id);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const res = await freePrinter(printer.id, me.orgId, me.id);
		if (!res.ok) return fail(400, { error: res.error });
		return { success: true, message: 'Printer marked as free.' };
	}
};
