import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printers, amsUnits, amsSlots, printJobs } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const orgId = locals.user!.orgId;
	const rows = await db
		.select()
		.from(printers)
		.where(and(eq(printers.orgId, orgId), eq(printers.enabled, true)))
		.orderBy(asc(printers.name));

	const result = await Promise.all(
		rows.map(async (p) => {
			const slots = await db
				.select({ colorHex: amsSlots.colorHex, colorName: amsSlots.colorName, filamentType: amsSlots.filamentType, empty: amsSlots.empty })
				.from(amsSlots)
				.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
				.where(eq(amsSlots.printerId, p.id))
				.orderBy(asc(amsUnits.amsIndex), asc(amsSlots.slotIndex));
			let current = null;
			if (p.currentJobId) {
				const [j] = await db.select({ name: printJobs.name }).from(printJobs).where(eq(printJobs.id, p.currentJobId)).limit(1);
				current = j?.name ?? null;
			}
			return { ...p, slots, current };
		})
	);
	return { printers: result };
};
