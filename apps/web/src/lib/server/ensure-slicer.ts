/**
 * Guarantees a working CLI slicer with ZERO configuration: bundles Slic3r (a small,
 * headless, CLI-only slicer that slices STL with sane defaults) into the app's data dir on
 * first use, and returns the path to its runner. No SLICER_CMD/SLICER_BIN needed.
 *
 * (For Bambu-printable output you can still override with SLICER_CMD pointing at OrcaSlicer
 * + your profiles; that takes precedence — see slicer-cli.ts.)
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, chmod, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { env } from '$env/dynamic/private';

const SLIC3R_URL = 'https://github.com/slic3r/Slic3r/releases/download/1.3.0/slic3r-1.3.0-linux-x64.tar.bz2';

function slicerDir() {
	return resolve(env.STORAGE_DIR || './.data/storage', '../slicer');
}
function runnerPath() {
	return join(slicerDir(), 'slic3r-run');
}
async function exists(p: string) {
	try { await access(p, constants.X_OK); return true; } catch { return false; }
}
function sh(cmd: string, args: string[]) {
	return new Promise<void>((res, rej) => {
		const p = spawn(cmd, args);
		let err = '';
		p.stderr.on('data', (d) => (err += d));
		p.on('error', rej);
		p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err.slice(-200)}`))));
	});
}

const g = globalThis as unknown as { __sparkSlicer?: Promise<string | null> };

/** Returns the path to the bundled Slic3r runner (installing it if needed), or null. */
export function ensureSlicer(): Promise<string | null> {
	if (!g.__sparkSlicer) g.__sparkSlicer = install();
	return g.__sparkSlicer;
}

async function install(): Promise<string | null> {
	const runner = runnerPath();
	if (await exists(runner)) return runner;
	if (process.platform !== 'linux' || process.arch !== 'x64') return null; // bundled build is linux-x64
	try {
		const dir = slicerDir();
		await mkdir(dir, { recursive: true });
		const tarball = join(dir, 'slic3r.tar.bz2');
		console.log('[slicer] installing bundled Slic3r…');
		const resp = await fetch(SLIC3R_URL);
		if (!resp.ok || !resp.body) throw new Error(`download HTTP ${resp.status}`);
		await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(tarball));
		await sh('tar', ['xjf', tarball, '-C', dir]); // → <dir>/Slic3r/
		await rm(tarball).catch(() => {});
		// The stock launcher uses readlink($0) which breaks unless symlinked; write our own.
		const wrapper = `#!/bin/bash\nD="${join(dir, 'Slic3r')}"\nexport LD_LIBRARY_PATH="$D/bin"\nexec "$D/perl-local" -I"$D/local-lib/lib/perl5" "$D/slic3r.pl" "$@"\n`;
		await writeFile(runner, wrapper);
		await chmod(runner, 0o755);
		console.log('[slicer] Slic3r ready at', runner);
		return runner;
	} catch (e) {
		console.error('[slicer] could not install Slic3r:', (e as Error).message);
		return null;
	}
}
