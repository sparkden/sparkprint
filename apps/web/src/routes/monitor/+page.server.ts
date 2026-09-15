import { redirect, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printers, printJobs, users, models, orgs } from '$lib/server/db/schema';
import { checkoutJob, cancelJob, markDone } from '$lib/server/jobs';
import { manager } from '$lib/server/bambu/manager';
import { kioskOrgId } from '$lib/server/settings';
import { getWeather } from '$lib/server/weather';
import type { Actions, PageServerLoad } from './$types';

// Resolve the org for a kiosk request (a physical lab display with no login) from its token.
async function kioskOrg(token: string | null): Promise<{ orgId: string; orgName: string } | null> {
	const orgId = await kioskOrgId(token);
	if (!orgId) return null;
	const [o] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
	return o ? { orgId, orgName: o.name } : null;
}

// Who is acting: a signed-in member or the kiosk token. Returns the org + actor (null for kiosk).
async function actor(locals: App.Locals, url: URL, fd?: FormData): Promise<{ orgId: string; actorId?: string } | null> {
	if (locals.user) return { orgId: locals.user.orgId, actorId: locals.user.id };
	const k = await kioskOrg(url.searchParams.get('kiosk') || String(fd?.get('kiosk') || ''));
	return k ? { orgId: k.orgId } : null;
}

// Fullscreen lab monitor for the shared lab computer. Any signed-in member can view + check out
// finished prints. Also runs as a no-login kiosk via ?kiosk=<token> (the Pi display).
export const load: PageServerLoad = async ({ locals, url }) => {
	let user = locals.user as { orgId: string; orgName: string; role: string } | null;
	let kiosk = false;
	if (!user) {
		const k = await kioskOrg(url.searchParams.get('kiosk'));
		if (k) { user = { orgId: k.orgId, orgName: k.orgName, role: 'student' }; kiosk = true; }
	}
	if (!user) throw redirect(303, '/login?next=/monitor');

	const rows = await db
		.select({
			id: printers.id,
			name: printers.name,
			model: printers.model,
			status: printers.status,
			online: printers.online,
			enabled: printers.enabled,
			progressPct: printers.progressPct,
			remainingTimeMin: printers.remainingTimeMin,
			jobId: printJobs.id,
			jobName: printJobs.name,
			jobStatus: printJobs.status,
			ownerName: users.name,
			modelId: printJobs.modelId,
			modelName: models.name,
			hasThumb: models.thumbnailKey,
			colorRequest: printJobs.colorRequest
		})
		.from(printers)
		.leftJoin(printJobs, eq(printers.currentJobId, printJobs.id))
		.leftJoin(users, eq(printJobs.userId, users.id))
		.leftJoin(models, eq(printJobs.modelId, models.id))
		.where(eq(printers.orgId, user.orgId))
		.orderBy(asc(printers.name));

	// Jobs waiting for a printer (queue depth shown on the board).
	const queue = await db
		.select({ id: printJobs.id, name: printJobs.name, ownerName: users.name, status: printJobs.status })
		.from(printJobs)
		.innerJoin(users, eq(printJobs.userId, users.id))
		.where(and(eq(printJobs.orgId, user.orgId), inArray(printJobs.status, ['queued', 'slicing', 'ready', 'sending', 'pending_approval'])))
		.orderBy(desc(printJobs.priority), asc(printJobs.createdAt))
		.limit(12);

	return {
		printers: rows,
		queue,
		orgName: user.orgName,
		isStaff: !kiosk && ['owner', 'admin', 'teacher'].includes(user.role),
		kiosk,
		kioskToken: kiosk ? (url.searchParams.get('kiosk') ?? '') : '',
		weather: await getWeather()
	};
};

export const actions: Actions = {
	// Finished print pulled off the bed → completed + frees the printer.
	checkout: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(401, { error: 'Sign in' });
		const r = await checkoutJob(String(fd.get('jobId')), a.orgId, a.actorId);
		return r.ok ? { success: true } : fail(400, { error: r.error });
	},
	// Force a print completed + free the printer (telemetry missed the finish, or confirming done).
	complete: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(401, { error: 'Sign in' });
		const r = await markDone(String(fd.get('jobId')), a.orgId, a.actorId);
		return r.ok ? { success: true } : fail(400, { error: r.error });
	},
	// Stop a running print on the machine, then cancel the job + free the printer.
	stop: async ({ request, locals, url }) => {
		const fd = await request.formData();
		const a = await actor(locals, url, fd);
		if (!a) return fail(401, { error: 'Sign in' });
		const jobId = String(fd.get('jobId'));
		const [job] = await db.select({ printerId: printJobs.printerId }).from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, a.orgId))).limit(1);
		if (job?.printerId) { try { await manager().stop(job.printerId); } catch { /* offline */ } }
		const r = await cancelJob(jobId, a.orgId, a.actorId);
		return r.ok ? { success: true } : fail(400, { error: r.error });
	}
};
