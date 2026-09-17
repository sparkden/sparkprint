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
	filamentTypes?: string[]; // one per color for multicolor (AMS) — overrides filamentType
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

// Real Bambu build-plate sizes (mm). The bed is corner-origin (0,0)→(w,d); centre is (w/2, d/2).
// Used to place models deterministically (see centerStlOnBed) — more reliable than parsing the
// machine profile, which inherits printable_area from a parent and so doesn't declare it directly.
const BED: Record<string, { w: number; d: number }> = {
	X1C: { w: 256, d: 256 },
	X1: { w: 256, d: 256 },
	X1E: { w: 256, d: 256 },
	P1S: { w: 256, d: 256 },
	P1P: { w: 256, d: 256 },
	A1: { w: 256, d: 256 },
	A1M: { w: 180, d: 180 },
	H2D: { w: 350, d: 320 }
};

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
	const norm = (f: string) => f.replace(/\.json$/, '');
	// 0.4mm ("main") @BBL X1C filament profiles — broadly compatible across Bambu machines.
	const mains = files.filter((f) => /@BBL X1C\.json$/.test(f) && !/0\.\d nozzle/.test(f));
	const has = (re: RegExp) => mains.find((f) => re.test(f));
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	// Material from the requested type, e.g. "Generic PETG" → "PETG", "PLA Matte" → "PLA Matte".
	const generic = /generic/i.test(type);
	const mat = type.replace(/generic/i, '').trim() || 'PLA';
	const m = esc(mat);

	// Try, in order: exact brand match, generic match, then a sensible default.
	const candidates = generic
		? [new RegExp(`^Generic ${m} @BBL X1C\\.json$`, 'i'), new RegExp(`^Bambu ${m}( Basic)? @BBL X1C\\.json$`, 'i')]
		: [new RegExp(`^Bambu ${m}( Basic)? @BBL X1C\\.json$`, 'i'), new RegExp(`^Generic ${m} @BBL X1C\\.json$`, 'i')];
	for (const re of candidates) {
		const hit = has(re);
		if (hit) return norm(hit);
	}

	// Broad same-material fallback — CRITICAL for correct temperatures. e.g. a "PETG" request must
	// slice with a PETG profile (≈240°C/80°C bed), never PLA (≈220°C/55°C), or the print comes out
	// cold and delaminates. Match any profile whose name carries the base material as a whole word
	// (covers "Bambu PETG HF", "Bambu PETG Translucent", "Bambu TPU 95A", …), preferring the plainest
	// Generic/Basic variant and avoiding composite (-CF/-GF) profiles unless that's what was asked.
	const baseMat = mat.split(/[\s-]/)[0].toUpperCase(); // PLA | PETG | ABS | ASA | TPU | PC | PA | PVA
	const wantsComposite = /-?(CF|GF)\b/i.test(type);
	const matRe = new RegExp(`\\b${esc(baseMat)}\\b`, 'i');
	const sameMaterial = mains.filter((f) => matRe.test(f));
	if (sameMaterial.length) {
		const rank = (f: string) => {
			let s = f.length * 0.001; // tie-break toward the plainest (shortest) name
			if (!wantsComposite && /\b(CF|GF)\b|-(CF|GF)/i.test(f)) s += 100; // avoid composites unless asked
			if (/^Generic /i.test(f)) s -= 5;
			if (/\bBasic\b/i.test(f)) s -= 4;
			if (/^Bambu /i.test(f)) s -= 1;
			return s;
		};
		sameMaterial.sort((a, b) => rank(a) - rank(b));
		return norm(sameMaterial[0]);
	}

	// Nothing of that material at all → PLA Basic as the last resort.
	return norm(has(/^Bambu PLA Basic @BBL X1C\.json$/) ?? has(/^Generic PLA @BBL X1C\.json$/) ?? mains[0] ?? 'Bambu PLA Basic @BBL X1C');
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

/** Parse the real bed polygon from a machine profile's `printable_area` (["0x0","256x0",…]) → the
 *  bed's bounds + centre in mm. Returns null if the profile doesn't declare it directly. */
async function readBed(machinePath: string) {
	try {
		const json = JSON.parse(await readFile(machinePath, 'utf8')) as { printable_area?: unknown };
		const pa = json.printable_area;
		if (!Array.isArray(pa) || pa.length < 3) return null;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const pt of pa) {
			const [x, y] = String(pt).split('x').map(Number);
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			minX = Math.min(minX, x); maxX = Math.max(maxX, x);
			minY = Math.min(minY, y); maxY = Math.max(maxY, y);
		}
		if (!Number.isFinite(minX) || maxX <= minX) return null;
		return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, d: maxY - minY };
	} catch {
		return null;
	}
}

/** Centre a binary STL on the real bed (from readBed). The editor exports models around (0,0) but
 *  the slicer bed is corner-origin, so we translate XY so the model's centre sits at the bed centre —
 *  deterministic, no dependence on the slicer's flaky --arrange. Returns the new file path, or null
 *  if the file isn't a binary STL. Throws a clear error if the model is larger than the bed. */
async function centerStlOnBed(path: string, bed: NonNullable<Awaited<ReturnType<typeof readBed>>>, outDir: string): Promise<string | null> {
	const buf = await readFile(path).catch(() => null);
	if (!buf || buf.length < 84) return null;
	const tris = buf.readUInt32LE(80);
	if (buf.length !== 84 + tris * 50) return null; // not a binary STL (ASCII / 3mf) — leave it to --arrange
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let t = 0; t < tris; t++) {
		const b = 84 + t * 50 + 12; // skip the 12-byte normal
		for (let v = 0; v < 3; v++) {
			const o = b + v * 12;
			const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4);
			minX = Math.min(minX, x); maxX = Math.max(maxX, x);
			minY = Math.min(minY, y); maxY = Math.max(maxY, y);
		}
	}
	if (maxX - minX > bed.w + 0.5 || maxY - minY > bed.d + 0.5) {
		throw new Error(`Model is ${Math.ceil(maxX - minX)}×${Math.ceil(maxY - minY)} mm but the bed is only ${bed.w}×${bed.d} mm — scale it down or split it.`);
	}
	const dx = bed.cx - (minX + maxX) / 2, dy = bed.cy - (minY + maxY) / 2;
	for (let t = 0; t < tris; t++) {
		const b = 84 + t * 50 + 12;
		for (let v = 0; v < 3; v++) {
			const o = b + v * 12;
			buf.writeFloatLE(buf.readFloatLE(o) + dx, o);
			buf.writeFloatLE(buf.readFloatLE(o + 4) + dy, o + 4);
		}
	}
	const outPath = join(outDir, 'centered.stl');
	await writeFile(outPath, buf);
	return outPath;
}

export async function orcaSlice(modelPath: string, s: OrcaSettings = {}): Promise<OrcaResult | null> {
	const loc = await locate();
	if (!loc || !loc.xvfb) return null;

	const model = (s.printerModel && MACHINE[s.printerModel] ? s.printerModel : 'P1S') as string;
	const machineName = MACHINE[model] ?? MACHINE.P1S;
	const layerHeight = s.layerHeightMm && s.layerHeightMm > 0 ? s.layerHeightMm : 0.2;
	const baseProcess = await pickProcess(loc.profiles, model, layerHeight);
	// One filament profile per requested color (multicolor via AMS). Falls back to a single filament.
	const filTypes = s.filamentTypes && s.filamentTypes.length ? s.filamentTypes : [s.filamentType || 'PLA'];
	const filamentNames = await Promise.all(filTypes.map((t) => pickFilament(loc.profiles, t)));

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
	const filamentPaths = filamentNames.map((f) => join(loc.profiles, 'filament', `${f}.json`)).join(';');

	// Position the model deterministically using the printer's REAL bed dimensions: read the bed
	// polygon from the machine profile and translate the (binary STL) model so it's centred on the
	// bed. This removes the dependency on OrcaSlicer's --arrange (which was leaving models at the
	// corner-origin → "no object fully inside"). If we can't read the bed or it isn't a binary STL
	// (e.g. a painted 3MF), we fall back to --arrange.
	const bd = BED[model];
	const bed = bd
		? { minX: 0, minY: 0, maxX: bd.w, maxY: bd.d, cx: bd.w / 2, cy: bd.d / 2, w: bd.w, d: bd.d }
		: await readBed(machinePath);
	let sliceModel = modelPath;
	let useArrange = true;
	if (bed) {
		const centered = await centerStlOnBed(modelPath, bed, outDir); // throws if the model exceeds the bed
		if (centered) { sliceModel = centered; useArrange = false; }
	}
	console.log(`[orca] model=${model} bed=${bed ? `${bed.w}x${bed.d}@(${bed.cx},${bed.cy})` : 'unknown'} centered=${!useArrange} file=${sliceModel.split('/').pop()}`);

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
		filamentPaths,
		...(useArrange ? ['--arrange', '1'] : []),
		'--slice',
		'0',
		'--export-3mf',
		threeMfName,
		'--outputdir',
		outDir,
		sliceModel
	];
	const { code, out } = await run('xvfb-run', args);

	const resultJson = await readFile(join(outDir, 'result.json'), 'utf8').catch(() => '');
	if (resultJson) {
		const rc = Number(/"return_code"\s*:\s*(-?\d+)/.exec(resultJson)?.[1] ?? 0);
		if (rc !== 0) {
			const err = /"error_string"\s*:\s*"([^"]*)"/.exec(resultJson)?.[1] ?? `return_code ${rc}`;
			// Surface OrcaSlicer's own log (object size, bed bounds, arrange result) so failures are
			// diagnosable instead of just the one-line error_string.
			console.error(`[orca] slice failed (rc ${rc}): ${err}\n--- orca args ---\n${args.join(' ')}\n--- orca output (tail) ---\n${out.slice(-2000)}`);
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
