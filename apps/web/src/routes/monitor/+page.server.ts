import { redirect, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { printers, printJobs, users, models, orgs, amsUnits, amsSlots } from '$lib/server/db/schema';
import { checkoutJob, cancelJob, markDone } from '$lib/server/jobs';
import { manager } from '$lib/server/bambu/manager';
import { kioskOrgId } from '$lib/server/settings';
import { getWeather } from '$lib/server/weather';
import { qrSvg, DEFAULT_APP_URL } from '$lib/server/qr';
import type { Actions, PageServerLoad } from './$types';

const EXT_INDEX = 254; // the external spool lives as a pseudo-AMS unit at this index

// Resolve the org for a kiosk request (a physical lab display with no login) from its token.
async function kioskOrg(token: string | null): Promise<{ orgId: string; orgName: string } | null> {
	const orgId = await kioskOrgId(token);
	if (!orgId) return null;
	const [o] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
	return o ? { orgId, orgName: o.name } : null;
}

const STAFF_ROLES = ['owner', 'admin', 'teacher'];

// Who may CONTROL the board: staff (teacher/admin/owner) or the trusted no-login kiosk on the lab
// machine. A signed-in STUDENT is intentionally not a controller — they must not be able to stop,
// check out, or otherwise touch other people's prints from the shared monitor. Returns null when the
// caller isn't allowed, which the actions turn into a 403.
async function actor(locals: App.Locals, url: URL, fd?: FormData): Promise<{ orgId: string; actorId?: string } | null> {
	if (locals.user) {
		if (!STAFF_ROLES.includes(locals.user.role)) return null;
		return { orgId: locals.user.orgId, actorId: locals.user.id };
	}
	const k = await kioskOrg(url.searchParams.get('kiosk') || String(fd?.get('kiosk') || ''));
	return k ? { orgId: k.orgId } : null;
}

// Fullscreen lab monitor for the shared lab computer. Staff (teacher/admin/owner) can view + manage
// prints; students are redirected to their own dashboard. Also runs as a no-login kiosk via
// ?kiosk=<token> (the trusted Pi display), which has full control of the board.
export const load: PageServerLoad = async ({ locals, url }) => {
	let user = locals.user as { orgId: string; orgName: string; role: string } | null;
	let kiosk = false;
	if (!user) {
		const k = await kioskOrg(url.searchParams.get('kiosk'));
		if (k) { user = { orgId: k.orgId, orgName: k.orgName, role: 'student' }; kiosk = true; }
	}
	if (!user) throw redirect(303, '/login?next=/monitor');
	// The lab monitor is for staff and the physical kiosk only. Students have their own dashboard and
	// must not be able to control the shared board — send them there.
	if (!kiosk && !STAFF_ROLES.includes(user.role)) throw redirect(303, '/app');

	// QR to the public app so students can open it on their phones straight from the lab board.
	const [orgRow] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, user.orgId)).limit(1);
	const appUrl = ((orgRow?.settings as Record<string, unknown> | undefined)?.appUrl as string) || DEFAULT_APP_URL;
	const appQr = await qrSvg(appUrl);

	const rows = await db
		.select({
			id: printers.id,
			name: printers.name,
			model: printers.model,
			status: printers.status,
			online: printers.online,
			enabled: printers.enabled,
			progressPct: printers.progressPct,
			remainingTimeMin: printers.remainingTimeMin,
			jobId: printJobs.id,
			jobName: printJobs.name,
			jobStatus: printJobs.status,
			jobSpeed: printJobs.speedLevel,
			ownerName: users.name,
			modelId: printJobs.modelId,
			modelName: models.name,
			modelFormat: models.format,
			hasThumb: models.thumbnailKey,
			colorRequest: printJobs.colorRequest
		})
		.from(printers)
		.leftJoin(printJobs, eq(printers.currentJobId, printJobs.id))
		.leftJoin(users, eq(printJobs.userId, users.id))
		.leftJoin(models, eq(printJobs.modelId, models.id))
		.where(eq(printers.orgId, user.orgId))
		.orderBy(asc(printers.name));

	// Filament loaded in each printer (AMS slots + external spool) — shown as editable swatches.
	const slotRows = await db
		.select({
			printerId: amsSlots.printerId,
			slotId: amsSlots.id,
			amsIndex: amsUnits.amsIndex,
			slotIndex: amsSlots.slotIndex,
			empty: amsSlots.empty,
			filamentType: amsSlots.filamentType,
			colorHex: amsSlots.colorHex,
			colorName: amsSlots.colorName,
			remainingPct: amsSlots.remainingPct
		})
		.from(amsSlots)
		.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
		.innerJoin(printers, eq(amsSlots.printerId, printers.id))
		.where(eq(printers.orgId, user.orgId))
		.orderBy(asc(amsUnits.amsIndex), asc(amsSlots.slotIndex));

	const filamentsByPrinter = new Map<string, typeof slotRows>();
	for (const s of slotRows) {
		const arr = filamentsByPrinter.get(s.printerId) ?? [];
		arr.push(s);
		filamentsByPrinter.set(s.printerId, arr);
	}
	const withFilament = rows.map((r) => {
		const all = filamentsByPrinter.get(r.id) ?? [];
		return {
			...r,
			ams: all.filter((s) => s.amsIndex !== EXT_INDEX).map((s) => ({ ...s, external: false })),
			external: all.find((s) => s.amsIndex === EXT_INDEX) ?? null,
			multiAms: new Set(all.filter((s) => s.amsIndex !== EXT_INDEX).map((s) => s.amsIndex)).size > 1
		};
	});

	// Jobs waiting for a printer (queue depth shown on the board).
	const queue = await db
		.select({ id: printJobs.id, name: printJobs.name, ownerName: users.name, status: printJobs.status })
		.from(printJobs)
		.innerJoin(users, eq(printJobs.userId, users.id))
		.where(and(eq(printJobs.orgId, user.orgId), inArray(printJobs.status, ['queued', 'slicing', 'ready', 'sending', 'pending_approval'])))
		.orderBy(desc(printJobs.priority), asc(printJobs.createdAt))
		.limit(12);

	return {
		printers: withFilament,
		queue,
		orgName: user.orgName,
		isStaff: !kiosk && ['owner', 'admin', 'teacher'].includes(user.role),
		kiosk,
		kioskToken: kiosk ? (url.searchParams.get('kiosk') ?? '') : '',
		weather: await getWeather(),
		appUrl,
		appQr
	};
};

export const actions: Actions = {
	// Finished print pulled off the bed → completed + frees the printer.
	checkout: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const r = await checkoutJob(String(fd.get('jobId')), a.orgId, a.actorId);
		return r.ok ? { success: true } : fail(400, { error: r.error });
	},
	// Force a print completed + free the printer (telemetry missed the finish, or confirming done).
	complete: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const r = await markDone(String(fd.get('jobId')), a.orgId, a.actorId);
		return r.ok ? { success: true } : fail(400, { error: r.error });
	},
	// Stop a running print on the machine, then cancel the job + free the printer.
	stop: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const jobId = String(fd.get('jobId'));
		const [job] = await db.select({ printerId: printJobs.printerId }).from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, a.orgId))).limit(1);
		if (job?.printerId) { try { await manager().stop(job.printerId); } catch { /* offline */ } }
		const r = await cancelJob(jobId, a.orgId, a.actorId);
		return r.ok ? { success: true } : fail(400, { error: r.error });
	},

	// Edit the color/type of an AMS slot or the external spool directly from the board.
	saveSlot: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const parsed = slotSchema.safeParse({
			slotId: fd.get('slotId'),
			empty: fd.get('empty') === 'on' || fd.get('empty') === 'true',
			filamentType: fd.get('filamentType') ?? '',
			colorHex: fd.get('colorHex') ?? '#000000',
			colorName: fd.get('colorName') ?? '',
			remainingPct: fd.get('remainingPct')
		});
		if (!parsed.success) return fail(400, { error: 'Check the color values.' });
		const d = parsed.data;
		// Confirm the slot belongs to a printer in this org.
		const [slot] = await db
			.select({ id: amsSlots.id })
			.from(amsSlots)
			.innerJoin(printers, eq(amsSlots.printerId, printers.id))
			.where(and(eq(amsSlots.id, d.slotId), eq(printers.orgId, a.orgId)))
			.limit(1);
		if (!slot) return fail(404, { error: 'Slot not found' });
		const hex = d.colorHex.startsWith('#') ? d.colorHex : `#${d.colorHex}`;
		await db
			.update(amsSlots)
			.set({
				empty: d.empty,
				filamentType: d.empty ? null : d.filamentType || 'PLA',
				colorHex: d.empty ? null : hex.toUpperCase(),
				colorName: d.empty ? null : d.colorName || null,
				remainingPct: d.empty ? null : d.remainingPct ?? 100,
				manualColor: !d.empty, // set by a person → telemetry won't clobber it
				updatedAt: new Date()
			})
			.where(eq(amsSlots.id, d.slotId));
		return { success: true, message: d.empty ? 'Slot cleared.' : 'Color saved.' };
	},

	// Set (or clear) the external spool color for a non-AMS printer; creates the pseudo-unit if needed.
	setSpool: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const printerId = String(fd.get('printerId'));
		const [printer] = await db.select({ id: printers.id }).from(printers).where(and(eq(printers.id, printerId), eq(printers.orgId, a.orgId))).limit(1);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const parsed = z
			.object({
				filamentType: z.string().min(1).max(20),
				colorHex: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
				colorName: z.string().max(40).optional(),
				clear: z.coerce.boolean().optional()
			})
			.safeParse({ filamentType: fd.get('filamentType') || 'PLA', colorHex: fd.get('colorHex') ?? '#000000', colorName: fd.get('colorName') ?? undefined, clear: fd.get('clear') === 'true' });
		if (!parsed.success) return fail(400, { error: 'Pick a filament type and a valid color.' });
		const d = parsed.data;
		const [unit] = await db.select().from(amsUnits).where(and(eq(amsUnits.printerId, printer.id), eq(amsUnits.amsIndex, EXT_INDEX))).limit(1);
		const unitId = unit?.id ?? (await db.insert(amsUnits).values({ printerId: printer.id, amsIndex: EXT_INDEX }).returning())[0].id;
		const hex = d.colorHex.startsWith('#') ? d.colorHex : `#${d.colorHex}`;
		const vals = d.clear
			? { printerId: printer.id, filamentType: null, colorHex: null, colorName: null, empty: true, manualColor: false, updatedAt: new Date() }
			: { printerId: printer.id, filamentType: d.filamentType, colorHex: hex.toUpperCase(), colorName: d.colorName || null, empty: false, remainingPct: 100, manualColor: true, updatedAt: new Date() };
		const [existing] = await db.select().from(amsSlots).where(and(eq(amsSlots.amsUnitId, unitId), eq(amsSlots.slotIndex, 0))).limit(1);
		if (existing) await db.update(amsSlots).set(vals).where(eq(amsSlots.id, existing.id));
		else await db.insert(amsSlots).values({ amsUnitId: unitId, slotIndex: 0, ...vals });
		return { success: true, message: d.clear ? 'Spool cleared.' : 'Spool color saved.' };
	},

	// Change the print speed of a running job from the board (1 Silent · 2 Standard · 3 Sport · 4 Ludicrous).
	setSpeed: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const level = Number(fd.get('level'));
		if (![1, 2, 3, 4].includes(level)) return fail(400, { error: 'Invalid speed' });
		const jobId = String(fd.get('jobId'));
		const [job] = await db
			.select({ status: printJobs.status, printerId: printJobs.printerId })
			.from(printJobs)
			.where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, a.orgId)))
			.limit(1);
		if (!job) return fail(404, { error: 'Not found' });
		await db.update(printJobs).set({ speedLevel: level, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
		if (job.printerId && (job.status === 'printing' || job.status === 'paused')) {
			await manager().setSpeed(job.printerId, level as 1 | 2 | 3 | 4);
		}
		return { success: true };
	},

	// Recheck a printer's status (reconnect + pull fresh telemetry + clear a stuck error).
	recheck: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const printerId = String(fd.get('printerId'));
		const [printer] = await db.select({ id: printers.id }).from(printers).where(and(eq(printers.id, printerId), eq(printers.orgId, a.orgId))).limit(1);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const connected = await manager().recheck(printerId);
		return { success: true, message: connected ? 'Rechecked — printer is online.' : 'Printer is not responding on the network.' };
	},

	// Unload whatever filament is currently loaded (AMS active tray or the external spool).
	unloadFilament: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(403, { error: 'Only staff or the lab kiosk can manage the board.' });
		const printerId = String(fd.get('printerId'));
		const [printer] = await db.select({ id: printers.id }).from(printers).where(and(eq(printers.id, printerId), eq(printers.orgId, a.orgId))).limit(1);
		if (!printer) return fail(404, { error: 'Printer not found' });
		const ok = await manager().unloadFilament(printerId);
		return { success: true, message: ok ? 'Unloading… follow the prompt on the printer.' : 'Sent unload — the printer may be offline.' };
	}
};

const slotSchema = z.object({
	slotId: z.string(),
	empty: z.coerce.boolean(),
	filamentType: z.string().max(20),
	colorHex: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
	colorName: z.string().max(40),
	remainingPct: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).max(100).nullable())
});
