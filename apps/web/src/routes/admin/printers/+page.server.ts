import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { printers, amsUnits, amsSlots, bambuAccounts } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/guards';
import { createCloudAccount, refreshCloudAccounts } from '$lib/server/printers';
import { login, sendEmailCode, loginWithCode } from '$lib/server/bambu/cloud';
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

	// Attach AMS slot color chips per printer.
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
			return { ...p, slots };
		})
	);

	const accountRows = await db
		.select({ id: bambuAccounts.id, email: bambuAccounts.email, region: bambuAccounts.region, status: bambuAccounts.status })
		.from(bambuAccounts)
		.where(eq(bambuAccounts.orgId, me.orgId));
	const accounts = accountRows.map((a) => ({ ...a, live: manager().isConnected(a.id) }));

	return { printers: withColors, accounts };
};

export const actions: Actions = {
	// Step 1: password login. May require an emailed verification code.
	bambuLogin: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const parsed = z
			.object({ email: z.string().email(), password: z.string().min(1), region: z.enum(['us', 'eu', 'cn']) })
			.safeParse({ email: fd.get('email'), password: fd.get('password'), region: fd.get('region') });
		if (!parsed.success) return fail(400, { error: 'Enter your Bambu email, password, and region.' });
		const { email, password, region } = parsed.data;

		const r = await login(email, password, region);
		if (r.status === 'ok') {
			const { imported } = await createCloudAccount(me.orgId, { email, region, uid: r.uid, accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt });
			return {
				success: true,
				message:
					imported === 0
						? 'Connected — but Bambu reports no printers on this account yet. In the Bambu Handy app or Bambu Studio (signed in as this same account), make sure your printers are added to it, then click Refresh.'
						: `Connected — imported ${imported} printer${imported === 1 ? '' : 's'}.`
			};
		}
		if (r.status === 'needCode') {
			await sendEmailCode(email, region);
			return { needCode: true, email, region, message: 'We emailed a verification code to that account.' };
		}
		if (r.status === 'needTfa') {
			return fail(400, { error: 'This account uses an authenticator app (2FA), which isn’t supported yet. Use an account with email-code verification, or a dedicated lab account.' });
		}
		return fail(400, { error: r.message });
	},

	// CLOUD mode, step 2: complete login with the emailed code.
	bambuVerify: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const parsed = z
			.object({ email: z.string().email(), region: z.enum(['us', 'eu', 'cn']), code: z.string().min(4).max(10) })
			.safeParse({ email: fd.get('email'), region: fd.get('region'), code: fd.get('code') });
		if (!parsed.success) return fail(400, { error: 'Enter the verification code.' });
		const { email, region, code } = parsed.data;

		const r = await loginWithCode(email, code, region);
		if (r.status !== 'ok') return fail(400, { needCode: true, email, region, error: r.status === 'error' ? r.message : 'Verification failed.' });
		const { imported } = await createCloudAccount(me.orgId, { email, region, uid: r.uid, accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt });
		return { success: true, message: `Connected — imported ${imported} printer${imported === 1 ? '' : 's'}.` };
	},

	refresh: async ({ locals }) => {
		const me = requireAdmin(locals.user);
		const n = await refreshCloudAccounts(me.orgId);
		return { success: true, message: `Refreshed ${n} printer${n === 1 ? '' : 's'}.` };
	},

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

	addManual: async ({ request, locals }) => {
		const me = requireAdmin(locals.user);
		const fd = await request.formData();
		const parsed = z
			.object({
				name: z.string().min(1).max(60),
				model: z.enum(MODEL_IDS),
				devId: z.string().min(3).max(40),
				location: z.preprocess((v) => (v ? String(v) : null), z.string().nullable()),
				accessCode: z.preprocess((v) => (v ? String(v) : null), z.string().nullable()),
				amsCount: z.coerce.number().int().min(0).max(4)
			})
			.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { error: 'Check the printer details.' });
		const d = parsed.data;

		const dupe = await db
			.select({ id: printers.id })
			.from(printers)
			.where(and(eq(printers.orgId, me.orgId), eq(printers.devId, d.devId)))
			.limit(1);
		if (dupe.length) return fail(400, { error: 'A printer with that serial already exists.' });

		await db.transaction(async (tx) => {
			const [p] = await tx
				.insert(printers)
				.values({
					orgId: me.orgId,
					devId: d.devId,
					name: d.name,
					model: d.model,
					location: d.location,
					accessCode: d.accessCode,
					hasAms: d.amsCount > 0,
					status: 'offline'
				})
				.returning();
			for (let a = 0; a < d.amsCount; a++) {
				const [ams] = await tx.insert(amsUnits).values({ printerId: p.id, amsIndex: a }).returning();
				for (let s = 0; s < 4; s++) {
					await tx.insert(amsSlots).values({ amsUnitId: ams.id, printerId: p.id, slotIndex: s, empty: true });
				}
			}
		});
		return { success: true, message: 'Printer added.' };
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
	}
};
