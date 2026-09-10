import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { printers, amsUnits, amsSlots, bambuAccounts } from './db/schema';
import type { DiscoveredPrinter } from './bambu';
import { listDevices as cloudListDevices } from './bambu/cloud';
import { manager } from './bambu/manager';
import { encrypt, decrypt } from './crypto';

/** Upsert a discovered printer + its AMS units/slots for an org. */
export async function upsertDiscovered(
	orgId: string,
	accountId: string | null,
	d: DiscoveredPrinter
) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(printers)
			.where(and(eq(printers.orgId, orgId), eq(printers.devId, d.devId)))
			.limit(1);

		let printerId: string;
		if (existing) {
			await tx
				.update(printers)
				.set({
					model: d.model,
					online: d.online,
					status: d.online ? 'idle' : 'offline',
					hasAms: d.ams.length > 0,
					nozzleDiameter: d.nozzleDiameter.toFixed(2),
					bambuAccountId: accountId ?? existing.bambuAccountId,
					lastSeenAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(printers.id, existing.id));
			printerId = existing.id;
		} else {
			const [created] = await tx
				.insert(printers)
				.values({
					orgId,
					bambuAccountId: accountId,
					devId: d.devId,
					name: d.name,
					model: d.model,
					online: d.online,
					status: d.online ? 'idle' : 'offline',
					hasAms: d.ams.length > 0,
					nozzleDiameter: d.nozzleDiameter.toFixed(2),
					lastSeenAt: new Date()
				})
				.returning();
			printerId = created.id;
		}

		// Sync AMS units + slots.
		for (const ams of d.ams) {
			const [existingAms] = await tx
				.select()
				.from(amsUnits)
				.where(and(eq(amsUnits.printerId, printerId), eq(amsUnits.amsIndex, ams.amsIndex)))
				.limit(1);
			let amsId: string;
			if (existingAms) {
				await tx
					.update(amsUnits)
					.set({ humidity: ams.humidity, temperature: ams.temperature?.toFixed(1), updatedAt: new Date() })
					.where(eq(amsUnits.id, existingAms.id));
				amsId = existingAms.id;
			} else {
				const [createdAms] = await tx
					.insert(amsUnits)
					.values({
						printerId,
						amsIndex: ams.amsIndex,
						humidity: ams.humidity,
						temperature: ams.temperature?.toFixed(1)
					})
					.returning();
				amsId = createdAms.id;
			}
			for (const slot of ams.slots) {
				const [existingSlot] = await tx
					.select()
					.from(amsSlots)
					.where(and(eq(amsSlots.amsUnitId, amsId), eq(amsSlots.slotIndex, slot.slotIndex)))
					.limit(1);
				const values = {
					printerId,
					filamentType: slot.filamentType,
					filamentBrand: slot.filamentBrand,
					colorHex: slot.colorHex,
					colorName: slot.colorName,
					remainingPct: slot.remainingPct,
					empty: slot.empty,
					updatedAt: new Date()
				};
				if (existingSlot) {
					await tx.update(amsSlots).set(values).where(eq(amsSlots.id, existingSlot.id));
				} else {
					await tx.insert(amsSlots).values({ amsUnitId: amsId, slotIndex: slot.slotIndex, ...values });
				}
			}
		}
		return printerId;
	});
}

/** Create a real cloud-connected account from a completed login, import its devices, and
 *  start the live MQTT telemetry connection. */
export async function createCloudAccount(
	orgId: string,
	creds: {
		email: string;
		region: string;
		uid: string;
		accessToken: string;
		refreshToken: string | null;
		expiresAt: Date | null;
	}
) {
	const [account] = await db
		.insert(bambuAccounts)
		.values({
			orgId,
			email: creds.email,
			region: creds.region,
			bambuUserId: creds.uid,
			accessToken: encrypt(creds.accessToken),
			refreshToken: creds.refreshToken ? encrypt(creds.refreshToken) : null,
			tokenExpiresAt: creds.expiresAt,
			status: 'connected',
			lastSyncedAt: new Date()
		})
		.returning();

	const devices = await cloudListDevices(creds.accessToken, creds.region);
	for (const d of devices) await upsertDiscovered(orgId, account.id, d);
	// Open the persistent MQTT connection for live telemetry + control.
	await manager().connectAccount(account.id);
	return { account, imported: devices.length };
}

/** Re-list devices for all cloud accounts of an org and ensure MQTT is connected. */
export async function refreshCloudAccounts(orgId: string) {
	const accounts = await db.select().from(bambuAccounts).where(eq(bambuAccounts.orgId, orgId));
	let n = 0;
	for (const a of accounts) {
		const token = decrypt(a.accessToken);
		if (!token) continue;
		try {
			const devices = await cloudListDevices(token, a.region);
			for (const d of devices) {
				await upsertDiscovered(orgId, a.id, d);
				n++;
			}
			await db.update(bambuAccounts).set({ lastSyncedAt: new Date() }).where(eq(bambuAccounts.id, a.id));
			await manager().connectAccount(a.id);
		} catch (e) {
			console.error('[bambu] refresh failed', (e as Error).message);
		}
	}
	return n;
}
