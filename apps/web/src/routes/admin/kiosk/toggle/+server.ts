import { error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { hasRole } from '$lib/server/auth';
import { getSetting, setSetting } from '$lib/server/settings';
import type { RequestHandler } from './$types';

const APP_DIR = env.SPARKPRINT_DIR || process.cwd();
const PORT = env.PORT || '3000';

// POST { enable: boolean } → configures the OS kiosk service, streaming the script output.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user || !hasRole(user, 'admin')) throw error(403, 'Admins only.');
	const { enable } = (await request.json().catch(() => ({ enable: false }))) as { enable?: boolean };

	let args: string[];
	if (enable) {
		let token = await getSetting('kiosk.token');
		if (!token) { token = randomUUID().replace(/-/g, ''); await setSetting('kiosk.token', token); }
		await setSetting('kiosk.orgId', user.orgId);
		await setSetting('kiosk.enabled', '1');
		const url = `http://localhost:${PORT}/monitor?kiosk=${token}`;
		args = ['-n', 'bash', `${APP_DIR}/scripts/kiosk.sh`, 'enable', url];
	} else {
		await setSetting('kiosk.enabled', '0');
		args = ['-n', 'bash', `${APP_DIR}/scripts/kiosk.sh`, 'disable'];
	}

	const child = spawn('sudo', args, { env: process.env });
	const enc = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { /* */ } };
			child.stdout.on('data', (d: Buffer) => send(d.toString()));
			child.stderr.on('data', (d: Buffer) => send(d.toString()));
			child.on('error', (e) => send(`\n[cannot run kiosk.sh: ${e.message}]\n`));
			child.on('close', (code) => {
				if (code !== 0) send(`\n[exit ${code}] If this says "sudo: a password is required", enable passwordless sudo for the ${'`'}sparkprint${'`'} user (installer → root terminal prompt), or run the printed command yourself.\n`);
				try { controller.close(); } catch { /* */ }
			});
		},
		cancel() { try { child.kill('SIGKILL'); } catch { /* */ } }
	});
	return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
};
