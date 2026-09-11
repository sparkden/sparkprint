/**
 * Live camera MJPEG for one printer.
 *   • Staff (owner/admin/teacher): any printer in the lab.
 *   • Students: only a printer that's actively running *their* job (so they can watch their print).
 * Requires the printer's LAN IP + access code and LAN Live View enabled on the printer.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printers, printJobs } from '$lib/server/db/schema';
import { cameraStream, MJPEG_CONTENT_TYPE } from '$lib/server/bambu/camera';
import type { RequestHandler } from './$types';

const STAFF = ['owner', 'admin', 'teacher'];

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Sign in');

	const [p] = await db
		.select()
		.from(printers)
		.where(and(eq(printers.id, params.id), eq(printers.orgId, user.orgId)))
		.limit(1);
	if (!p) throw error(404, 'Printer not found');

	// Students may only watch a printer currently running their own job.
	if (!STAFF.includes(user.role)) {
		const [own] = await db
			.select({ id: printJobs.id })
			.from(printJobs)
			.where(
				and(
					eq(printJobs.printerId, p.id),
					eq(printJobs.userId, user.id),
					inArray(printJobs.status, ['sending', 'printing', 'paused'])
				)
			)
			.limit(1);
		if (!own) throw error(403, 'You can only watch a printer while it’s running your print.');
	}

	if (!p.ipAddress || !p.accessCode) throw error(409, 'This printer has no LAN camera configured.');

	const stream = cameraStream(p.model, p.ipAddress, p.accessCode);
	return new Response(stream, {
		headers: {
			'content-type': MJPEG_CONTENT_TYPE,
			'cache-control': 'no-store, no-cache, must-revalidate',
			'pragma': 'no-cache',
			connection: 'close'
		}
	});
};
