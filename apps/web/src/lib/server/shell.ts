/**
 * Admin web terminal — runs shell commands on the server and streams their output live.
 *
 * DANGER: this is a remote command executor. It is gated to admins only (see the route guards)
 * and can be turned off entirely with ADMIN_TERMINAL="off". Commands run as the OS user the app
 * runs as (the systemd unit runs it as "sparkprint", not root). For root, the operator can grant
 * passwordless sudo during install; then "run as root" wraps the command in sudo.
 *
 * No native deps, no WebSocket: a command is POSTed and its combined stdout/stderr streams back on
 * the response body. A per-user working directory persists between commands (so `cd` sticks).
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { env } from '$env/dynamic/private';

export function terminalEnabled(): boolean {
	return (env.ADMIN_TERMINAL ?? 'on').toLowerCase() !== 'off';
}

export function shellUser(): string {
	try { return os.userInfo().username; } catch { return 'app'; }
}
export function hostName(): string {
	try { return os.hostname(); } catch { return 'server'; }
}

const START_CWD = env.SPARKPRINT_DIR || process.cwd();
const cwds = new Map<string, string>(); // userId → current working directory
export function getCwd(userId: string): string { return cwds.get(userId) || START_CWD; }

/** True if this process can become root without a password (passwordless sudo configured). */
export function rootAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const p = spawn('sudo', ['-n', 'true'], { stdio: 'ignore' });
			p.on('error', () => resolve(false));
			p.on('close', (code) => resolve(code === 0));
		} catch { resolve(false); }
	});
}

// Sentinel appended after every command so we can recover the resulting cwd + exit code. It's
// streamed to the client too, which strips it for display and uses it to update the prompt.
export const TERM_MARK = '\x1e\x1eSPARKterm\x1e';

/** Run one command, streaming combined stdout+stderr. Persists cwd for the user across calls. */
export function runCommand(userId: string, command: string, asRoot: boolean, signal: AbortSignal): ReadableStream<Uint8Array> {
	const cwd = getCwd(userId);
	// After the command, print MARK + exit-code + cwd so both sides learn where we ended up.
	const inner = `${command}\n__rc=$?; printf '%s%s\\x1e%s\\x1e' "${TERM_MARK}" "$__rc" "$PWD"`;
	const bin = asRoot ? 'sudo' : 'bash';
	const args = asRoot ? ['-n', 'bash', '-lc', inner] : ['-lc', inner];
	const child = spawn(bin, args, { cwd, env: { ...process.env, TERM: 'xterm-256color', GIT_PAGER: 'cat', PAGER: 'cat' } });

	const enc = new TextEncoder();
	const dec = new TextDecoder();
	let tail = ''; // rolling buffer to find the end marker

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const onAbort = () => { try { child.kill('SIGKILL'); } catch { /* */ } };
			if (signal.aborted) onAbort();
			signal.addEventListener('abort', onAbort);

			const onData = (buf: Buffer) => {
				const s = dec.decode(buf, { stream: true });
				try { controller.enqueue(enc.encode(s)); } catch { /* closed */ }
				tail = (tail + s).slice(-8192);
			};
			child.stdout.on('data', onData);
			child.stderr.on('data', onData);
			child.on('error', (e) => {
				const msg = bin === 'sudo' ? `sudo unavailable: ${e.message}` : e.message;
				try { controller.enqueue(enc.encode(`\n[error: ${msg}]\n`)); } catch { /* */ }
			});
			child.on('close', () => {
				const i = tail.lastIndexOf(TERM_MARK);
				if (i !== -1) {
					const parts = tail.slice(i + TERM_MARK.length).split('\x1e');
					if (parts[1]) cwds.set(userId, parts[1]); // remember the new cwd
				}
				signal.removeEventListener('abort', onAbort);
				try { controller.close(); } catch { /* */ }
			});
		},
		cancel() { try { child.kill('SIGKILL'); } catch { /* */ } }
	});
}
