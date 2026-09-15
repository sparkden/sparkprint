import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { models } from '$lib/server/db/schema';
import { readStream, objectExists } from '$lib/server/storage';
import { kioskOrgId } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	// Signed-in member, or the no-login kiosk board via its token.
	const orgId = locals.user?.orgId ?? (await kioskOrgId(url.searchParams.get('kiosk')));
	if (!orgId) throw error(401);
	const [m] = await db
		.select({ thumbnailKey: models.thumbnailKey })
		.from(models)
		.where(and(eq(models.id, params.modelId), eq(models.orgId, orgId)))
		.limit(1);
	if (!m?.thumbnailKey || !objectExists(m.thumbnailKey)) throw error(404);
	const stream = readStream(m.thumbnailKey);
	return new Response(stream as any, {
		headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' }
	});
};
