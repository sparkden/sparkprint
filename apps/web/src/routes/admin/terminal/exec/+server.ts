import { error } from '@sveltejs/kit';
import { hasRole } from '$lib/server/auth';
import { runCommand, terminalEnabled } from '$lib/server/shell';
import type { RequestHandler } from './$types';

// POST { command, asRoot? } → streams combined stdout/stderr on the response body.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user || !hasRole(user, 'admin')) throw error(403, 'Admins only.');
	if (!terminalEnabled()) throw error(403, 'The web terminal is disabled (ADMIN_TERMINAL=off).');

	let body: { command?: unknown; asRoot?: unknown };
	try { body = await request.json(); } catch { throw error(400, 'Bad request.'); }
	const command = typeof body.command === 'string' ? body.command : '';
	if (!command.trim()) throw error(400, 'Empty command.');
	const asRoot = body.asRoot === true;

	// Audit every command to the server log (who ran what).
	console.log(`[terminal] ${user.email}${asRoot ? ' (root)' : ''} $ ${command.replace(/\s+/g, ' ').slice(0, 500)}`);

	const stream = runCommand(user.id, command, asRoot, request.signal);
	return new Response(stream, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'x-accel-buffering': 'no' // don't let any proxy buffer the live stream
		}
	});
};
