import { redirect, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printers, printJobs, users, models, orgs } from '$lib/server/db/schema';
import { checkoutJob } from '$lib/server/jobs';
import { getSetting } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

// Resolve the org for a kiosk request (a physical lab display with no login) from its token.
async function kioskOrg(token: string | null): Promise<{ orgId: string; orgName: string } | null> {
	if (!token) return null;
	const stored = await getSetting('kiosk.token');
	if (!stored || token !== stored) return null;
	const orgId = await getSetting('kiosk.orgId');
	if (!orgId) return null;
	const [o] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
	return o ? { orgId, orgName: o.name } : null;
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
			modelName: models.name,
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
		kioskToken: kiosk ? (url.searchParams.get('kiosk') ?? '') : ''
	};
};

export const actions: Actions = {
	checkout: async ({ request, locals, url }) => {
		const user = locals.user;
		const fd = await request.formData();
		// Signed-in member, or the physical kiosk (token, carried in the URL or the form) — both can
		// check a finished print off the bed.
		let orgId: string | null = user?.orgId ?? null;
		let actorId: string | undefined = user?.id;
		if (!orgId) {
			const k = await kioskOrg(url.searchParams.get('kiosk') || String(fd.get('kiosk') || ''));
			if (k) { orgId = k.orgId; actorId = undefined; }
		}
		if (!orgId) return fail(401, { error: 'Sign in' });
		const r = await checkoutJob(String(fd.get('jobId')), orgId, actorId);
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true };
	}
};
