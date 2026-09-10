/**
 * Unauthenticated download of a job's sliced 3mf, for the Bambu printer to fetch during a cloud
 * print. The URL is HMAC-signed (token = "<jobId>.<sig>"), so only jobs we've dispatched can be
 * pulled, and the printer needs no login. Bambu's cloud forwards this URL to the printer verbatim
 * (verified: /my/task accepts arbitrary URLs), and the printer verifies the file against the md5
 * we sent with the task.
 */
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { verifyId } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { printJobs } from '$lib/server/db/schema';
import { objectExists, readBuffer } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	// Token may carry a ".gcode.3mf" suffix for printers that key on the extension — strip it.
	const raw = params.token.replace(/\.gcode\.3mf$/i, '').replace(/\.3mf$/i, '');
	const jobId = verifyId(raw);
	if (!jobId) throw error(404, 'Not found');

	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job || !job.gcodeKey || !objectExists(job.gcodeKey)) throw error(404, 'Not found');

	const buf = await readBuffer(job.gcodeKey);
	return new Response(new Uint8Array(buf), {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(buf.length),
			'content-disposition': `attachment; filename="${jobId}.gcode.3mf"`,
			'cache-control': 'no-store'
		}
	});
};
