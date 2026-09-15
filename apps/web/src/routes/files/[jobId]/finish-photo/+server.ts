import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printJobs } from '$lib/server/db/schema';
import { readStream, objectExists } from '$lib/server/storage';
import { kioskOrgId } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const orgId = locals.user?.orgId ?? (await kioskOrgId(url.searchParams.get('kiosk')));
	if (!orgId) throw error(401);
	const [j] = await db
		.select({ key: printJobs.finishPhotoKey })
		.from(printJobs)
		.where(and(eq(printJobs.id, params.jobId), eq(printJobs.orgId, orgId)))
		.limit(1);
	if (!j?.key || !objectExists(j.key)) throw error(404);
	return new Response(readStream(j.key) as unknown as BodyInit, {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' }
	});
};
