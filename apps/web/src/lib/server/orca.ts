/**
 * In-process OrcaSlicer — produces real Bambu-printable G-code (the same slicer engine and
 * profiles Bambu Studio ships). Runs headless via xvfb-run against the AppImage's extracted
 * `AppRun`, so there's no separate slicer service to launch.
 *
 * We pick the right machine/process/filament system profile for the target printer, then layer
 * a tiny generated override preset on top so the student's choices (supports, raft, infill,
 * layer height) are honoured. The override inherits the matching "@BBL <family>" process and
 * declares a broad `compatible_printers` list so Orca's compatibility check (-17) passes.
 *
 * Zero-config: if an OrcaSlicer AppRun is found (bundled path or $ORCA_APPRUN) and xvfb-run is
 * present, this is used automatically. Otherwise the caller falls back to Slic3r/size-estimate.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { env } from '$env/dynamic/private';

export type OrcaSettings = {
	layerHeightMm?: number;
	infillPct?: number;
	supports?: boolean;
	raft?: boolean;
	brim?: boolean;
	printerModel?: string; // our model code: X1C | X1 | X1E | P1S | P1P | A1 | A1M | H2D
	filamentType?: string; // 'PLA' | 'PLA Matte' | 'PETG' | 'ABS' | 'TPU'
};

export type OrcaResult = { gcodePath: string; grams: number; timeSec: number };

const APPRUN_CANDIDATES = [
	env.ORCA_APPRUN,
	'/home/coder/slicers/orca/squashfs-root/AppRun',
	'/opt/orca/squashfs-root/AppRun',
	'/opt/orcaslicer/AppRun'
].filter(Boolean) as string[];

// Our model code → OrcaSlicer machine profile name (0.4mm nozzle).
const MACHINE: Record<string, string> = {
	X1C: 'Bambu Lab X1 Carbon 0.4 nozzle',
	X1: 'Bambu Lab X1 0.4 nozzle',
	X1E: 'Bambu Lab X1E 0.4 nozzle',
	P1S: 'Bambu Lab P1S 0.4 nozzle',
	P1P: 'Bambu Lab P1P 0.4 nozzle',
	A1: 'Bambu Lab A1 0.4 nozzle',
	A1M: 'Bambu Lab A1 mini 0.4 nozzle',
	H2D: 'Bambu Lab H2D 0.4 nozzle'
};
// Which "@BBL <family>" process profiles a model uses (P1S/X1/X1E share the X1C processes).
const FAMILY: Record<string, string> = {
	X1C: 'X1C',
	X1: 'X1C',
	X1E: 'X1C',
	P1S: 'X1C',
	P1P: 'P1P',
	A1: 'A1',
	A1M: 'A1M',
	H2D: 'H2D'
};
const ALL_MACHINES = Object.values(MACHINE);

let cached: { apprun: string; profiles: string; xvfb: boolean } | null | undefined;

async function exists(p: string) {
	try {
		await access(p, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
function which(bin: string): Promise<string | null> {
	return new Promise((resolve) => {
		const p = spawn('sh', ['-c', `command -v ${bin} 2>/dev/null`]);
		let out = '';
		p.stdout.on('data', (d) => (out += d));
		p.on('close', () => resolve(out.trim() || null));
		p.on('error', () => resolve(null));
	});
}

async function locate() {
	if (cached !== undefined) return cached;
	for (const apprun of APPRUN_CANDIDATES) {
		if (!(await exists(apprun))) continue;
		const profiles = join(dirname(apprun), 'resources', 'profiles', 'BBL');
		try {
			await readdir(profiles); // confirm the bundled Bambu profiles are present
		} catch {
			continue;
		}
		cached = { apprun, profiles, xvfb: !!(await which('xvfb-run')) };
		return cached;
	}
	cached = null;
	return cached;
}

export async function orcaAvailable(): Promise<string | null> {
	const loc = await locate();
	if (!loc) return null;
	if (!loc.xvfb) return null; // headless GL needs xvfb
	return `OrcaSlicer (${loc.apprun})`;
}

/** Choose the "@BBL <family>" process profile whose layer height is closest to the request. */
async function pickProcess(profiles: string, model: string, layerHeightMm: number): Promise<string> {
	const family = FAMILY[model] ?? 'X1C';
	const files = await readdir(join(profiles, 'process'));
	const re = new RegExp(`^0\\.(\\d+)mm .*@BBL ${family}\\.json$`);
	const cands: { name: string; lh: number; standard: boolean }[] = [];
	for (const f of files) {
		const m = re.exec(f);
		if (!m) continue;
		cands.push({ name: f.replace(/\.json$/, ''), lh: Number(`0.${m[1]}`), standard: /Standard/i.test(f) });
	}
	if (!cands.length) {
		// Fall back to the X1C standard, which every Bambu machine can inherit.
		return '0.20mm Standard @BBL X1C';
	}
	cands.sort((a, b) => {
		const d = Math.abs(a.lh - layerHeightMm) - Math.abs(b.lh - layerHeightMm);
		if (Math.abs(d) > 1e-6) return d;
		return a.standard === b.standard ? 0 : a.standard ? -1 : 1; // prefer "Standard" on ties
	});
	return cands[0].name;
}

/** Choose a filament system profile for the requested material (Orca filaments cross-load). */
async function pickFilament(profiles: string, type = 'PLA'): Promise<string> {
	const files = await readdir(join(profiles, 'filament'));
	const wanted = [
		type, // exact, e.g. "PLA Matte"
		`Bambu ${type} Basic @BBL X1C.json`,
		`Bambu ${type} @BBL X1C.json`
	];
	// Prefer an exact "Bambu <type> ... @BBL X1C" main (0.4mm) profile.
	const norm = (f: string) => f.replace(/\.json$/, '');
	const mains = files.filter((f) => /@BBL X1C\.json$/.test(f) && !/0\.\d nozzle/.test(f));
	const byType = mains.find((f) => new RegExp(`Bambu ${type}( Basic)? @BBL X1C\\.json$`, 'i').test(f));
	if (byType) return norm(byType);
	const plaBasic = mains.find((f) => /Bambu PLA Basic @BBL X1C\.json$/.test(f));
	return norm(plaBasic ?? mains[0] ?? 'Bambu PLA Basic @BBL X1C');
}

function run(cmd: string, args: string[], timeoutMs = 300000): Promise<{ code: number; out: string }> {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { env: { ...process.env } });
		let out = '';
		const to = setTimeout(() => {
			p.kill('SIGKILL');
			reject(new Error('OrcaSlicer timed out'));
		}, timeoutMs);
		p.stdout.on('data', (d) => (out += d));
		p.stderr.on('data', (d) => (out += d));
		p.on('error', reject);
		p.on('close', (code) => {
			clearTimeout(to);
			resolve({ code: code ?? -1, out });
		});
	});
}

const DENSITY_G_CM3 = 1.24;
function parseMetrics(gcode: string, resultJson: string): { grams: number; timeSec: number } {
	let grams = parseFloat(/filament used\s*\[g\]\s*[:=]\s*([\d.]+)/i.exec(gcode)?.[1] ?? '') || 0;
	if (!grams) {
		const cm3 = parseFloat(/filament used\s*\[cm3\]\s*[:=]\s*([\d.]+)/i.exec(gcode)?.[1] ?? '');
		if (cm3) grams = Math.round(cm3 * DENSITY_G_CM3 * 10) / 10;
	}
	let timeSec = 0;
	const hms = /(?:estimated|model) printing time\D*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(gcode);
	if (hms) timeSec = +(hms[1] || 0) * 3600 + +(hms[2] || 0) * 60 + +(hms[3] || 0);
	// result.json may carry a machine-readable time as a fallback.
	if (!timeSec) timeSec = Number(/"prediction"\s*:\s*(\d+)/.exec(resultJson)?.[1] ?? 0);
	return { grams, timeSec };
}

export async function orcaSlice(modelPath: string, s: OrcaSettings = {}): Promise<OrcaResult | null> {
	const loc = await locate();
	if (!loc || !loc.xvfb) return null;

	const model = (s.printerModel && MACHINE[s.printerModel] ? s.printerModel : 'P1S') as string;
	const machineName = MACHINE[model] ?? MACHINE.P1S;
	const layerHeight = s.layerHeightMm && s.layerHeightMm > 0 ? s.layerHeightMm : 0.2;
	const baseProcess = await pickProcess(loc.profiles, model, layerHeight);
	const filament = await pickFilament(loc.profiles, s.filamentType || 'PLA');

	const outDir = await mkdtemp(join(tmpdir(), 'orca-'));
	const overridePath = join(outDir, 'override.json');
	const override: Record<string, unknown> = {
		type: 'process',
		name: 'sparkprint_override',
		from: 'User',
		instantiation: 'true',
		inherits: baseProcess,
		// Broad list so the compatibility check passes for whichever machine we load.
		compatible_printers: ALL_MACHINES,
		enable_support: s.supports ? '1' : '0'
	};
	if (s.raft) override.raft_layers = '4';
	if (s.brim) override.brim_type = 'outer_only';
	if (typeof s.infillPct === 'number' && s.infillPct >= 0) override.sparse_infill_density = `${Math.round(s.infillPct)}%`;
	await writeFile(overridePath, JSON.stringify(override));

	const machinePath = join(loc.profiles, 'machine', `${machineName}.json`);
	const filamentPath = join(loc.profiles, 'filament', `${filament}.json`);
	// --export-3mf produces a proper Bambu printable 3mf (Metadata/plate_1.gcode + md5 + plate
	// config) — that's what Bambu's cloud accepts. Its path is resolved relative to --outputdir,
	// so pass a bare filename. --slice 0 also drops plate_1.gcode, which we parse for metrics.
	const threeMfName = 'sparkprint.gcode.3mf';
	const args = [
		'-a',
		loc.apprun,
		'--load-settings',
		`${machinePath};${overridePath}`,
		'--load-filaments',
		filamentPath,
		'--slice',
		'0',
		'--export-3mf',
		threeMfName,
		'--outputdir',
		outDir,
		modelPath
	];
	const { code, out } = await run('xvfb-run', args);

	const resultJson = await readFile(join(outDir, 'result.json'), 'utf8').catch(() => '');
	if (resultJson) {
		const rc = Number(/"return_code"\s*:\s*(-?\d+)/.exec(resultJson)?.[1] ?? 0);
		if (rc !== 0) {
			const err = /"error_string"\s*:\s*"([^"]*)"/.exec(resultJson)?.[1] ?? `return_code ${rc}`;
			throw new Error(`OrcaSlicer failed: ${err}`);
		}
	}

	const files = await readdir(outDir).catch(() => [] as string[]);
	const threeMf = files.includes(threeMfName) ? join(outDir, threeMfName) : null;
	const plateGcode = files.find((f) => /^plate_\d+\.gcode$/.test(f)) || files.find((f) => f.endsWith('.gcode'));
	if (!threeMf) throw new Error(`OrcaSlicer produced no 3mf (exit ${code}): ${out.slice(-500)}`);

	// Metrics come from the plain plate gcode; the uploaded artifact is the printable 3mf.
	const gtext = plateGcode ? await readFile(join(outDir, plateGcode), 'utf8').then((t) => t.slice(-6000)).catch(() => '') : '';
	const m = parseMetrics(gtext, resultJson);
	return { gcodePath: threeMf, grams: m.grams, timeSec: m.timeSec };
}
