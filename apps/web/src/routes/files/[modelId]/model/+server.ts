import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { models } from '$lib/server/db/schema';
import { readStream, objectExists } from '$lib/server/storage';
import { kioskOrgId } from '$lib/server/settings';
import type { RequestHandler } from './$types';

// Serve the raw model file (STL/OBJ/3MF) for the 3D viewer. Signed-in member or the no-login kiosk.
export const GET: RequestHandler = async ({ params, locals, url }) => {
	const orgId = locals.user?.orgId ?? (await kioskOrgId(url.searchParams.get('kiosk')));
	if (!orgId) throw error(401);
	const [m] = await db
		.select({ fileKey: models.fileKey, format: models.format })
		.from(models)
		.where(and(eq(models.id, params.modelId), eq(models.orgId, orgId)))
		.limit(1);
	if (!m?.fileKey || !objectExists(m.fileKey)) throw error(404);
	const stream = readStream(m.fileKey);
	return new Response(stream as unknown as ReadableStream, {
		headers: {
			'content-type': 'application/octet-stream',
			'x-model-format': m.format ?? 'stl',
			'cache-control': 'private, max-age=3600'
		}
	});
};
