import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { printers } from './db/schema';

/**
 * Create or update a printer from LAN discovery / manual entry. AMS units, colors, and live status
 * arrive over local MQTT (see report.ts), so this only manages the printer's identity + LAN details.
 */
export async function upsertLanPrinter(
	orgId: string,
	d: { devId: string; name: string; model: string; ip?: string | null; accessCode?: string | null }
): Promise<{ id: string; created: boolean }> {
	const [existing] = await db
		.select()
		.from(printers)
		.where(and(eq(printers.orgId, orgId), eq(printers.devId, d.devId)))
		.limit(1);

	if (existing) {
		await db
			.update(printers)
			.set({
				name: d.name || existing.name,
				model: d.model || existing.model,
				ipAddress: d.ip ?? existing.ipAddress,
				accessCode: d.accessCode ?? existing.accessCode,
				lastSeenAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(printers.id, existing.id));
		return { id: existing.id, created: false };
	}

	const [created] = await db
		.insert(printers)
		.values({
			orgId,
			devId: d.devId,
			name: d.name,
			model: d.model,
			ipAddress: d.ip ?? null,
			accessCode: d.accessCode ?? null,
			status: 'offline',
			lastSeenAt: new Date()
		})
		.returning({ id: printers.id });
	return { id: created.id, created: true };
}
