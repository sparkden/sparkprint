/**
 * Real slicing via a CLI slicer, run in-process with the app (started by the slice
 * worker in workers.ts). Tries, in order:
 *   1. SLICER_CMD  — a full command template with {model} {outdir} placeholders (any slicer)
 *   2. SLICER_BIN  — a slicer binary; invoked PrusaSlicer/OrcaSlicer-style
 *   3. a detected binary on PATH (orca-slicer, prusa-slicer, superslicer, CuraEngine, bambu-studio)
 * If none is available it returns null and the caller falls back to the size estimate, so
 * the queue never gets stuck.
 *
 * Slicer config/profiles: OrcaSlicer/PrusaSlicer need machine+process+filament settings to
 * produce real gcode. Point SLICER_CMD at an invocation that loads your profiles, e.g.
 *   SLICER_CMD='/opt/orca/orca-slicer --load-settings "/profiles/x1c.json;/profiles/0.2.json" --load-filaments /profiles/pla.json --slice 1 --outputdir {outdir} {model}'
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

const CANDIDATES = ['orca-slicer', 'OrcaSlicer', 'prusa-slicer', 'prusa-slicer-console', 'superslicer', 'bambu-studio', 'CuraEngine'];

async function onPath(bin: string): Promise<string | null> {
	// absolute path?
	if (bin.includes('/')) {
		try { await access(bin, constants.X_OK); return bin; } catch { return null; }
	}
	return new Promise((resolve) => {
		const p = spawn('sh', ['-c', `command -v ${bin} 2>/dev/null`]);
		let out = '';
		p.stdout.on('data', (d) => (out += d));
		p.on('close', () => resolve(out.trim() || null));
		p.on('error', () => resolve(null));
	});
}

/** Human-readable description of the configured/detected slicer, or null. */
export async function slicerAvailable(): Promise<string | null> {
	if (env.SLICER_CMD) return 'SLICER_CMD';
	const bin = env.SLICER_BIN;
	if (bin && (await onPath(bin))) return bin;
	for (const c of CANDIDATES) {
		const found = await onPath(c);
		if (found) return found;
	}
	return null;
}

function buildCommand(modelPath: string, outDir: string, bin: string): { cmd: string; args: string[] } {
	if (env.SLICER_CMD) {
		const parts = env.SLICER_CMD.replace(/\{model\}/g, modelPath).replace(/\{outdir\}/g, outDir).split(' ').filter(Boolean);
		return { cmd: parts[0], args: parts.slice(1) };
	}
	if (/curaengine/i.test(bin)) {
		// CuraEngine needs a definition json; operator should use SLICER_CMD for real configs.
		return { cmd: bin, args: ['slice', '-l', modelPath, '-o', join(outDir, 'out.gcode')] };
	}
	// PrusaSlicer / OrcaSlicer / SuperSlicer family
	return { cmd: bin, args: ['--slice', '--outputdir', outDir, modelPath] };
}

function run(cmd: string, args: string[], timeoutMs = 180000): Promise<{ code: number; out: string }> {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { env: { ...process.env } });
		let out = '';
		const to = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('slicer timed out')); }, timeoutMs);
		p.stdout.on('data', (d) => (out += d));
		p.stderr.on('data', (d) => (out += d));
		p.on('error', reject);
		p.on('close', (code) => { clearTimeout(to); resolve({ code: code ?? -1, out }); });
	});
}

function parseMetrics(text: string): { grams: number; timeSec: number } {
	const grams =
		parseFloat(/filament used\s*\[g\]\s*[:=]\s*([\d.]+)/i.exec(text)?.[1] ?? '') ||
		parseFloat(/total filament used\D*([\d.]+)\s*g/i.exec(text)?.[1] ?? '') || 0;
	let timeSec = 0;
	const hms = /(?:estimated|model) printing time\D*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(text);
	if (hms) timeSec = +(hms[1] || 0) * 3600 + +(hms[2] || 0) * 60 + +(hms[3] || 0);
	return { grams, timeSec };
}

export type SliceOutput = { gcodePath: string; grams: number; timeSec: number };

/** Slice a model file; returns the produced gcode path + metrics, or null if no slicer. */
export async function realSlice(modelPath: string): Promise<SliceOutput | null> {
	const bin = (await slicerAvailable());
	if (!bin) return null;
	const outDir = await mkdtemp(join(tmpdir(), 'spark-slice-'));
	const { cmd, args } = buildCommand(modelPath, outDir, env.SLICER_BIN || bin);
	const { code, out } = await run(cmd, args);
	if (code !== 0) throw new Error(`slicer exited ${code}: ${out.slice(-400)}`);

	// Find produced gcode (or gcode.3mf), parse its header + stdout for metrics.
	const files = await readdir(outDir).catch(() => []);
	const gcode = files.find((fl) => fl.endsWith('.gcode')) || files.find((fl) => fl.endsWith('.gcode.3mf')) || files.find((fl) => fl.endsWith('.3mf'));
	if (!gcode) throw new Error('slicer produced no gcode');
	const gcodePath = join(outDir, gcode);
	let header = '';
	try { header = (await readFile(gcodePath, 'utf8')).slice(0, 4000); } catch { /* binary 3mf */ }
	const m = parseMetrics(out + '\n' + header);
	return { gcodePath, grams: m.grams, timeSec: m.timeSec };
}
