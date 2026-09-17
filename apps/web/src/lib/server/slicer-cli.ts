/**
 * Real slicing via a CLI slicer, run in-process with the app. Zero config by default:
 * a bundled Slic3r (installed on demand by ensure-slicer.ts) slices with real support/raft/
 * infill/layer-height settings. Override with SLICER_CMD (e.g. OrcaSlicer + Bambu profiles)
 * for Bambu-printable output — that takes precedence.
 *
 * Resolution order:
 *   1. SLICER_CMD  — full command template with {model} {outdir} placeholders (any slicer)
 *   2. SLICER_BIN  — a slicer binary
 *   3. a slicer detected on PATH
 *   4. the bundled Slic3r (auto-installed)
 * If none is available, returns null and the caller falls back to the size estimate.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { ensureSlicer } from './ensure-slicer';
import { orcaAvailable, orcaSlice } from './orca';

export type SliceSettings = {
	layerHeightMm?: number;
	infillPct?: number;
	supports?: boolean;
	raft?: boolean;
	adhesion?: string; // 'none' | 'skirt' | 'brim' | 'raft'
	printerModel?: string; // X1C | P1S | … — selects the OrcaSlicer machine profile
	filamentType?: string; // 'PLA' | 'PETG' | 'ABS' — selects the filament profile
	filamentTypes?: string[]; // one per color for multicolor (AMS)
	bedTempC?: number; // override the bed temperature (°C)
};

const CANDIDATES = ['orca-slicer', 'OrcaSlicer', 'prusa-slicer', 'prusa-slicer-console', 'superslicer', 'slic3r', 'bambu-studio', 'CuraEngine'];

async function onPath(bin: string): Promise<string | null> {
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

type Resolved = { kind: 'cmd' } | { kind: 'slic3r' | 'prusa' | 'cura'; bin: string };

async function resolveSlicer(): Promise<Resolved | null> {
	if (env.SLICER_CMD) return { kind: 'cmd' };
	if (env.SLICER_BIN) {
		const b = await onPath(env.SLICER_BIN);
		if (b) return { kind: /slic3r/i.test(b) ? 'slic3r' : /cura/i.test(b) ? 'cura' : 'prusa', bin: b };
	}
	for (const c of CANDIDATES) {
		const b = await onPath(c);
		if (b) return { kind: /slic3r/i.test(c) ? 'slic3r' : /cura/i.test(c) ? 'cura' : 'prusa', bin: b };
	}
	const bundled = await ensureSlicer(); // bundled Slic3r (installs on demand)
	if (bundled) return { kind: 'slic3r', bin: bundled };
	return null;
}

/** Human-readable description of the active slicer, or null. */
export async function slicerAvailable(): Promise<string | null> {
	// SLICER_CMD is an explicit user override and wins over auto-detection.
	if (!env.SLICER_CMD) {
		const orca = await orcaAvailable();
		if (orca) return orca;
	}
	const r = await resolveSlicer();
	if (!r) return null;
	return r.kind === 'cmd' ? 'SLICER_CMD' : `${r.kind} (${r.bin})`;
}

function buildCommand(r: Resolved, modelPath: string, outDir: string, s: SliceSettings): { cmd: string; args: string[] } {
	if (r.kind === 'cmd') {
		const parts = env.SLICER_CMD!.replace(/\{model\}/g, modelPath).replace(/\{outdir\}/g, outDir).split(' ').filter(Boolean);
		return { cmd: parts[0], args: parts.slice(1) };
	}
	if (r.kind === 'cura') {
		return { cmd: r.bin, args: ['slice', '-l', modelPath, '-o', join(outDir, 'out.gcode')] };
	}
	// Slic3r / PrusaSlicer / SuperSlicer share most CLI flags.
	const args = [modelPath, '--output', join(outDir, 'out.gcode')];
	if (s.layerHeightMm) args.push('--layer-height', String(s.layerHeightMm));
	if (s.infillPct != null) args.push('--fill-density', `${s.infillPct}%`);
	if (s.supports) args.push('--support-material');
	if (s.raft || s.adhesion === 'raft') args.push('--raft-layers', '4');
	if (s.adhesion === 'brim') args.push('--brim-width', '5');
	if (r.kind === 'prusa') args.unshift('--export-gcode'); // PrusaSlicer needs an action
	return { cmd: r.bin, args };
}

function run(cmd: string, args: string[], timeoutMs = 240000): Promise<{ code: number; out: string }> {
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

const DENSITY_G_CM3 = 1.24;
function parseMetrics(text: string): { grams: number; timeSec: number } {
	let grams =
		parseFloat(/filament used\s*\[g\]\s*[:=]\s*([\d.]+)/i.exec(text)?.[1] ?? '') ||
		parseFloat(/total filament used\D*([\d.]+)\s*g/i.exec(text)?.[1] ?? '') ||
		0;
	if (!grams) {
		const cm3 = parseFloat(/([\d.]+)\s*cm3/i.exec(text)?.[1] ?? '');
		if (cm3) grams = Math.round(cm3 * DENSITY_G_CM3 * 10) / 10;
	}
	let timeSec = 0;
	const hms = /(?:estimated|model) printing time\D*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(text);
	if (hms) timeSec = +(hms[1] || 0) * 3600 + +(hms[2] || 0) * 60 + +(hms[3] || 0);
	return { grams, timeSec };
}

export type SliceOutput = { gcodePath: string; grams: number; timeSec: number };

export async function realSlice(modelPath: string, settings: SliceSettings = {}): Promise<SliceOutput | null> {
	// Prefer OrcaSlicer (real Bambu-printable G-code) when available, unless the operator set an
	// explicit SLICER_CMD override. Falls through to Slic3r/Prusa/Cura otherwise.
	if (!env.SLICER_CMD && (await orcaAvailable())) {
		const o = await orcaSlice(modelPath, settings);
		if (o) return o;
	}
	const r = await resolveSlicer();
	if (!r) return null;
	const outDir = await mkdtemp(join(tmpdir(), 'spark-slice-'));
	const { cmd, args } = buildCommand(r, modelPath, outDir, settings);
	const { code, out } = await run(cmd, args);
	if (code !== 0) throw new Error(`slicer exited ${code}: ${out.slice(-400)}`);

	const files = await readdir(outDir).catch(() => []);
	const gcode = files.find((f) => f.endsWith('.gcode')) || files.find((f) => f.endsWith('.gcode.3mf')) || files.find((f) => f.endsWith('.3mf'));
	if (!gcode) throw new Error('slicer produced no gcode');
	const gcodePath = join(outDir, gcode);
	let text = out;
	try { text += '\n' + (await readFile(gcodePath, 'utf8')).slice(-4000); } catch { /* binary */ }
	const m = parseMetrics(text);
	return { gcodePath, grams: m.grams, timeSec: m.timeSec };
}
