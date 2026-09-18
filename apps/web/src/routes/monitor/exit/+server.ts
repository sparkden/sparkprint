import { json, error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import { env } from '$env/dynamic/private';
import { kioskOrgId, getSetting, setSetting } from '$lib/server/settings';
import type { RequestHandler } from './$types';

const APP_DIR = env.SPARKPRINT_DIR || process.cwd();

// Exit kiosk mode from the board itself, gated by a PIN. Stops the OS kiosk service (cage/Chromium),
// which restores the normal login/terminal on the display. Re-enabling is admin-only (Admin → Kiosk).
export const POST: RequestHandler = async ({ request, locals }) => {
	const { pin, kiosk } = (await request.json().catch(() => ({}))) as { pin?: string; kiosk?: string };

	// Allow a signed-in admin OR the trusted kiosk token to trigger this.
	const isAdmin = !!locals.user && ['owner', 'admin'].includes(locals.user.role);
	const kioskOk = !!(await kioskOrgId(kiosk ?? null));
	if (!isAdmin && !kioskOk) throw error(403, 'Not allowed.');

	const expected = (await getSetting('kiosk.pin')) || (await getSetting('kiosk.exitPin')) || '2010';
	if (String(pin ?? '').trim() !== expected) throw error(401, 'Wrong PIN.');

	// Mark disabled + stop the OS kiosk service. Detached + unref'd so it survives this request (and
	// since it kills the on-screen browser, the response may never be read — that's fine).
	await setSetting('kiosk.enabled', '0');
	try {
		const child = spawn('sudo', ['-n', 'bash', `${APP_DIR}/scripts/kiosk.sh`, 'disable'], {
			env: process.env,
			detached: true,
			stdio: 'ignore'
		});
		child.unref();
	} catch (e) {
		throw error(500, `Couldn't stop the kiosk: ${(e as Error).message}`);
	}
	return json({ ok: true });
};
