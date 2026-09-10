/**
 * SparkPrint slicing worker
 * =========================
 * Consumes `slice` jobs from the shared pg-boss queue, runs the OrcaSlicer/BambuStudio
 * headless CLI to produce a printable `.gcode.3mf` + real filament/time numbers, writes
 * them back to `print_jobs`, and enqueues `dispatch` (the web process then sends the file
 * to the printer via the Bambu cloud).
 *
 * Runs as its own container (CPU-heavy) sharing the app's Postgres + storage volume.
 *
 * Env:
 *   DATABASE_URL   (required)  same DB as the web app
 *   STORAGE_DIR    (required)  shared volume, e.g. /data/storage
 *   SLICER_BIN     path to the slicer binary (default /opt/orca/orca-slicer)
 *   SLICER_PROFILE_DIR directory with machine/process/filament JSON profiles
 *   SLICER_CMD     optional full command template; placeholders {bin} {model} {outdir}
 *                  {machine} {process} {filament}. If unset, a sensible default is used.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import PgBoss from 'pg-boss';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const STORAGE_DIR = resolve(process.env.STORAGE_DIR || './.data/storage');
const SLICER_BIN = process.env.SLICER_BIN || '/opt/orca/orca-slicer';
const PROFILE_DIR = process.env.SLICER_PROFILE_DIR || '/opt/orca/profiles';
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const sql = postgres(DATABASE_URL);

// Map our printer models → profile file basenames (provision these in PROFILE_DIR).
const MACHINE_PROFILE = {
	X1C: 'bbl_x1c.machine.json', X1E: 'bbl_x1e.machine.json',
	P1S: 'bbl_p1s.machine.json', P1P: 'bbl_p1p.machine.json',
	A1: 'bbl_a1.machine.json', A1M: 'bbl_a1m.machine.json'
};
const FILAMENT_PROFILE = (type) => `${String(type || 'PLA').toLowerCase().replace(/[^a-z0-9]/g, '')}.filament.json`;

function storagePath(key) {
	const p = resolve(STORAGE_DIR, key);
	if (!p.startsWith(STORAGE_DIR)) throw new Error('bad storage key');
	return p;
}

function buildArgs({ model, outdir, machine, processProfile, filament }) {
	// OrcaSlicer CLI: slice plate 1, export the sliced 3mf into outdir.
	return [
		'--load-settings', `${machine};${processProfile}`,
		'--load-filaments', filament,
		'--slice', '1',
		'--export-3mf', join(outdir, 'out.gcode.3mf'),
		'--outputdir', outdir,
		model
	];
}

function run(bin, args) {
	return new Promise((resolveRun, reject) => {
		const p = spawn(bin, args, { env: process.env });
		let out = '';
		p.stdout.on('data', (d) => (out += d));
		p.stderr.on('data', (d) => (out += d));
		p.on('error', reject);
		p.on('close', (code) => (code === 0 ? resolveRun(out) : reject(new Error(`slicer exit ${code}: ${out.slice(-600)}`))));
	});
}

function parseMetrics(stdout) {
	const grams =
		parseFloat(/filament used\s*\[g\]\s*[:=]\s*([\d.]+)/i.exec(stdout)?.[1] ?? '') ||
		parseFloat(/total filament used\D*([\d.]+)\s*g/i.exec(stdout)?.[1] ?? '') || 0;
	let timeSec = 0;
	const hms = /(?:estimated|model) printing time\D*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i.exec(stdout);
	if (hms) timeSec = (+(hms[1] || 0)) * 3600 + (+(hms[2] || 0)) * 60 + (+(hms[3] || 0));
	return { grams, timeSec };
}

async function findOutput(outdir) {
	if (existsSync(join(outdir, 'out.gcode.3mf'))) return join(outdir, 'out.gcode.3mf');
	const files = await readdir(outdir).catch(() => []);
	const threeMf = files.find((f) => f.endsWith('.gcode.3mf')) || files.find((f) => f.endsWith('.3mf'));
	return threeMf ? join(outdir, threeMf) : null;
}

async function sliceJob(jobId, boss) {
	const [job] = await sql`select * from print_jobs where id = ${jobId}`;
	if (!job) return;
	const [model] = job.model_id ? await sql`select * from models where id = ${job.model_id}` : [null];
	if (!model) throw new Error('model not found');

	const color = (job.color_request ?? [])[0] ?? {};
	const outdir = join('/tmp', `spark-${jobId}`);
	await mkdir(outdir, { recursive: true });
	const modelPath = storagePath(model.file_key);
	if (!existsSync(modelPath)) throw new Error(`model file missing: ${model.file_key}`);

	const machine = join(PROFILE_DIR, MACHINE_PROFILE[job.printer_model_target] ?? MACHINE_PROFILE.X1C);
	const processProfile = join(PROFILE_DIR, `${job.layer_height_mm ?? '0.20'}mm.process.json`);
	const filament = join(PROFILE_DIR, FILAMENT_PROFILE(color.filamentType));

	const cmd = process.env.SLICER_CMD
		? process.env.SLICER_CMD
				.replace('{bin}', SLICER_BIN).replace('{model}', modelPath).replace('{outdir}', outdir)
				.replace('{machine}', machine).replace('{process}', processProfile).replace('{filament}', filament)
				.split(' ')
		: [SLICER_BIN, ...buildArgs({ model: modelPath, outdir, machine, processProfile, filament })];

	console.log(`[slicer] slicing ${jobId}: ${cmd.join(' ')}`);
	const stdout = await run(cmd[0], cmd.slice(1));
	const metrics = parseMetrics(stdout);

	const outFile = await findOutput(outdir);
	if (!outFile) throw new Error('slicer produced no 3mf');

	// Store the sliced 3mf into shared storage under the job.
	const gcodeKey = `org/${job.org_id}/jobs/${jobId}.gcode.3mf`;
	await mkdir(join(STORAGE_DIR, `org/${job.org_id}/jobs`), { recursive: true });
	await copyFile(outFile, storagePath(gcodeKey));

	const grams = metrics.grams > 0 ? metrics.grams : Number(job.estimated_grams ?? 0);
	const timeSec = metrics.timeSec > 0 ? metrics.timeSec : Number(job.estimated_time_sec ?? 0);

	await sql`
		update print_jobs
		set status = 'ready', gcode_key = ${gcodeKey},
		    estimated_grams = ${grams}, estimated_time_sec = ${timeSec}, updated_at = now()
		where id = ${jobId}`;
	await sql`insert into job_events (id, job_id, type, message, data)
		values (${'evt_' + Math.random().toString(36).slice(2, 14)}, ${jobId}, 'slice',
		        ${`Sliced — ${Math.round(grams)} g, ~${Math.round(timeSec / 60)} min`}, ${sql.json({ grams, timeSec })})`;

	await boss.send('dispatch', { jobId });
	console.log(`[slicer] ${jobId} ready (${Math.round(grams)} g)`);
}

async function main() {
	const boss = new PgBoss({ connectionString: DATABASE_URL, schema: 'pgboss' });
	boss.on('error', (e) => console.error('[slicer] pg-boss', e));
	await boss.start();
	await boss.createQueue('slice').catch(() => {});
	await boss.createQueue('dispatch').catch(() => {});
	console.log('[slicer] worker ready; waiting for slice jobs…');

	await boss.work('slice', { batchSize: 1 }, async (jobs) => {
		for (const j of [].concat(jobs)) {
			const { jobId } = j.data;
			try {
				await sliceJob(jobId, boss);
			} catch (err) {
				console.error(`[slicer] ${jobId} failed:`, err.message);
				await sql`update print_jobs set status = 'slice_failed', failure_reason = ${err.message}, updated_at = now() where id = ${jobId}`;
				await sql`insert into job_events (id, job_id, type, message) values (${'evt_' + Math.random().toString(36).slice(2, 14)}, ${jobId}, 'error', ${'Slice failed: ' + err.message})`;
			}
		}
	});
}

main().catch((e) => {
	console.error('[slicer] fatal', e);
	process.exit(1);
});
