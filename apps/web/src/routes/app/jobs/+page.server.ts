import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printJobs, models, printers } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const jobs = await db
		.select({
			id: printJobs.id,
			name: printJobs.name,
			status: printJobs.status,
			createdAt: printJobs.createdAt,
			estimatedGrams: printJobs.estimatedGrams,
			estimatedTimeSec: printJobs.estimatedTimeSec,
			estimatedCost: printJobs.estimatedCost,
			modelId: printJobs.modelId,
			thumbnailKey: models.thumbnailKey,
			printerName: printers.name,
			colorRequest: printJobs.colorRequest
		})
		.from(printJobs)
		.leftJoin(models, eq(printJobs.modelId, models.id))
		.leftJoin(printers, eq(printJobs.printerId, printers.id))
		.where(eq(printJobs.userId, user.id))
		.orderBy(desc(printJobs.createdAt));
	return { jobs };
};
