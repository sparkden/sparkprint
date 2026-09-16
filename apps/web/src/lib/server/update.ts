/**
 * One-click self-update for the admin UI: fetch the latest code, rebuild, and restart.
 *
 * The restart is done by exiting the process — the systemd unit runs with Restart=always, so it
 * comes straight back on the freshly built code. No sudo required (the app user owns the checkout
 * and the build output). If it's ever run outside systemd, the operator just restarts it manually.
 */
import { spawn } from 'node:child_process';
import { env } from '$env/dynamic/private';

const APP_DIR = env.SPARKPRINT_DIR || process.cwd();
const BRANCH = env.SPARKPRINT_BRANCH || 'main';

let updating = false;
export function isUpdating() { return updating; }

/** Short current version: "<sha>  <subject>", best-effort. */
export function currentVersion(): Promise<string> {
	return new Promise((resolve) => {
		const p = spawn('git', ['-C', APP_DIR, 'log', '--oneline', '-1'], { stdio: ['ignore', 'pipe', 'ignore'] });
		let out = '';
		p.stdout.on('data', (d) => (out += d));
		p.on('error', () => resolve('unknown'));
		p.on('close', () => resolve(out.trim() || 'unknown'));
	});
}

// The client watches for these sentinels to know whether to wait for the restart.
export const OK_MARK = '__UPDATE_OK__';
export const FAIL_MARK = '__UPDATE_FAIL__';

/** Run the update, streaming progress. On success, exits the process so systemd restarts it. */
export function runUpdate(): ReadableStream<Uint8Array> {
	updating = true;
	const enc = new TextEncoder();
	// Fetch newest tip (works on the shallow clone), hard-reset to it, then rebuild the web app.
	// Note: `npm install` (not `ci`) — it reconciles in place instead of wiping node_modules, so a
	// hiccup can't leave the app unbootable. Only run it when the lockfile actually changed.
	//
	// The service runs with NODE_ENV=production, under which `npm install` omits (and prunes!)
	// devDependencies — but the build tooling (vite, @sveltejs/kit, tailwind) lives there. So we force
	// `--include=dev` and run the install/build with NODE_ENV unset, or the build dies with
	// "vite: not found". The running server still only needs the prod deps at runtime.
	const script = [
		`cd ${JSON.stringify(APP_DIR)}`,
		`echo "→ Fetching latest (${BRANCH})…"`,
		`before=$(git rev-parse HEAD)`,
		`git fetch --depth 1 origin ${BRANCH}`,
		`git reset --hard FETCH_HEAD`,
		`echo "→ Now at: $(git log --oneline -1)"`,
		`if ! git diff --quiet "$before" HEAD -- package-lock.json package.json apps/web/package.json 2>/dev/null; then echo "→ Dependencies changed — installing…"; NODE_ENV=development npm install --include=dev --no-audit --no-fund; else echo "→ Dependencies unchanged."; fi`,
		`echo "→ Building…"`,
		`NODE_ENV=production npm run build -w @sparkprint/web`,
		`echo "→ Build complete."`
	].join(' && ');

	const child = spawn('bash', ['-lc', script], { cwd: APP_DIR, env: process.env });

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { /* closed */ } };
			child.stdout.on('data', (d: Buffer) => send(d.toString()));
			child.stderr.on('data', (d: Buffer) => send(d.toString()));
			child.on('error', (e) => send(`\n[error: ${e.message}]\n`));
			child.on('close', (code) => {
				if (code === 0) {
					send(`\n${OK_MARK} Update complete — restarting the server…\n`);
					// Give the response time to flush, then exit; systemd (Restart=always) restarts us.
					setTimeout(() => process.exit(0), 1500);
					// Intentionally leave the stream open; the client detects the drop and waits for /healthz.
				} else {
					updating = false;
					send(`\n${FAIL_MARK} Update failed (exit ${code}). The running version is unchanged.\n`);
					try { controller.close(); } catch { /* */ }
				}
			});
		},
		cancel() { /* don't kill a build/restart just because the client navigated away */ }
	});
}
