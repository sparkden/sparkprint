import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printers, amsUnits, amsSlots } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { upsertLanPrinter } from '$lib/server/printers';
import { isCloudPrintable } from '$lib/server/jobs';
import { manager } from '$lib/server/bambu/manager';
import { MODEL_IDS } from '$lib/bambuModels';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = requireAdmin(locals.user);

	const printerRows = await db
		.select()
		.from(printers)
		.where(eq(printers.orgId, me.orgId))
		.orderBy(asc(printers.name));

	// Attach AMS slot color chips + live-connection state per printer.
	const withColors = await Promise.all(
		printerRows.map(async (p) => {
			const slots = await db
				.select({
					colorHex: amsSlots.colorHex,
					colorName: amsSlots.colorName,
					filamentType: amsSlots.filamentType,
					empty: amsSlots.empty,
					amsIndex: amsUnits.amsIndex,
					slotIndex: amsSlots.slotIndex
				})
				.from(amsSlots)
				.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
				.where(eq(amsSlots.printerId, p.id))
				.orderBy(asc(amsUnits.amsIndex), asc(amsSlots.slotIndex));
			// Don't ship the raw LAN access code to the browser — just whether one is set.
			const { accessCode, ...safe } = p;
			return { ...safe, slots, hasAccessCode: !!accessCode, live: manager().isConnected(p.id), printable: isCloudPrintable(p.model) };
		})
	);

	return { printers: withColors };
};

export const actions: Actions = {
	// Live printer controls.
	pauseCmd: async ({ request, locals }) => {
		requireAdmin(locals.user);
		const ok = await manager().pause(String((await request.formData()).get('id')));
		return ok ? { success: true } : fail(400, { error: 'Printer not connected.' });
	},
	resumeCmd: async ({ request, locals }) => {
		requireAdmin(locals.user);
		const ok = await manager().resume(String((await request.formData()).get('id')));
		return ok ? { success: true } : fail(400, { error: 'Printer not connected.' });
	},
	stopCmd: async ({ request, locals }) => {
		requireAdmin(locals.user);
		const ok = await manager().stop(String((await request.formData()).get('id')));
		return ok ? { success: true } : fail(400, { error: 'Printer not connected.' });
	},

	// Recheck a printer's status: reconnect if needed, pull fresh telemetry, and clear a stuck error.
	recheck: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const id = String((await request.formData()).get('id'));
		const [p] = await db.select({ id: printers.id }).from(printers).where(and(eq(printers.id, id), eq(printers.orgId, me.orgId))).limit(1);
		if (!p) return fail(404, { error: 'Printer not found.' });
		const connected = await manager().recheck(id);
		return { success: true, message: connected ? 'Rechecked — printer is online.' : 'Printer is not responding on the network.' };
	},

	addManual: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const parsed = z
			.object({
				name: z.string().min(1).max(60),
				model: z.enum(MODEL_IDS),
				devId: z.string().min(3).max(40),
				ipAddress: z.preprocess((v) => (v ? String(v).trim() : ''), z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Enter a valid IPv4 address').or(z.literal('')).optional()),
				accessCode: z.preprocess((v) => (v ? String(v).trim() : null), z.string().min(6).max(16).nullable())
			})
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the printer details.' });
		const d = parsed.data;

		const dupe = await db
			.select({ id: printers.id })
			.from(printers)
			.where(and(eq(printers.orgId, me.orgId), eq(printers.devId, d.devId)))
			.limit(1);
		if (dupe.length) return fail(400, { error: 'A printer with that serial already exists.' });

		const { id } = await upsertLanPrinter(me.orgId, { devId: d.devId, name: d.name, model: d.model, ip: d.ipAddress || null, accessCode: d.accessCode });
		if (d.ipAddress && d.accessCode) manager().connectLanPrinter(id).catch(() => {});
		return { success: true, message: 'Printer added.' };
	},

	setPriority: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const id = String(fd.get('id'));
		const priority = Math.max(0, Math.min(999, Math.round(Number(fd.get('priority')) || 0)));
		await db.update(printers).set({ priority, updatedAt: new Date() }).where(and(eq(printers.id, id), eq(printers.orgId, me.orgId)));
		return { success: true };
	},

	toggleEnabled: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const id = String(fd.get('id'));
		const enabled = fd.get('enabled') === 'true';
		await db.update(printers).set({ enabled, updatedAt: new Date() }).where(and(eq(printers.id, id), eq(printers.orgId, me.orgId)));
		return { success: true };
	},

	remove: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const id = String((await request.formData()).get('id'));
		await db.delete(printers).where(and(eq(printers.id, id), eq(printers.orgId, me.orgId)));
		return { success: true };
	},

	// Save a printer's LAN details (local IP + access code) for direct FTPS/MQTT printing.
	setLan: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const id = String(fd.get('id'));
		const ip = String(fd.get('ipAddress') ?? '').trim();
		const code = String(fd.get('accessCode') ?? '').trim();
		if (ip && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return fail(400, { error: 'Enter a valid IPv4 address, e.g. 192.168.1.50.' });
		if (code && !/^[a-zA-Z0-9]{6,16}$/.test(code)) return fail(400, { error: 'Access code looks off — it’s the 8-character LAN code from the printer screen.' });
		const patch: Record<string, unknown> = { ipAddress: ip || null, updatedAt: new Date() };
		if (code) patch.accessCode = code; // don't wipe a synced code when the field is left blank
		await db.update(printers).set(patch).where(and(eq(printers.id, id), eq(printers.orgId, me.orgId)));
		// Bring up (or refresh) the local MQTT connection so status/AMS/control start immediately.
		if (ip) manager().connectLanPrinter(id).catch(() => {});
		else manager().disconnectLanPrinter(id);
		return { success: true, lanSaved: true };
	},

	// Test the FTPS connection to a printer so setup problems surface immediately.
	testLan: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const id = String((await request.formData()).get('id'));
		const [p] = await db.select().from(printers).where(and(eq(printers.id, id), eq(printers.orgId, me.orgId))).limit(1);
		if (!p) return fail(404, { error: 'Printer not found.' });
		if (!p.ipAddress || !p.accessCode) return fail(400, { error: 'Set the IP and access code first.' });
		try {
			const { Client } = await import('basic-ftp');
			const c = new Client(12000);
			await c.access({ host: p.ipAddress, port: 990, user: 'bblp', password: p.accessCode, secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
			c.close();
			return { success: true, lanTest: `Connected to ${p.name} at ${p.ipAddress}. LAN printing is ready.` };
		} catch (e) {
			return fail(400, { error: `Couldn't reach ${p.name} at ${p.ipAddress}: ${(e as Error).message}. Check the IP, access code, and that this server is on the same network.` });
		}
	},

	// Discover printers on the LAN via SSDP: add new ones and fill in IPs for known ones.
	discoverLan: async ({ locals }) => {
		const me = requireAdmin(locals.user);
		const { discoverPrinters } = await import('$lib/server/bambu/discover');
		const { ssdpModelToCode } = await import('$lib/bambuModels');
		const found = await discoverPrinters(4500);
		let added = 0;
		for (const d of found) {
			const res = await upsertLanPrinter(me.orgId, {
				devId: d.serial,
				name: d.name || `Printer ${d.serial.slice(-4)}`,
				model: ssdpModelToCode(d.model),
				ip: d.ip
			});
			if (res.created) added++;
		}
		return {
			success: true,
			discover: found.length
				? `Found ${found.length} printer(s); added ${added} new. Set each printer's access code to finish.`
				: 'No printers found on the network. Make sure this server is on the same LAN/VLAN as the printers.'
		};
	}
};
