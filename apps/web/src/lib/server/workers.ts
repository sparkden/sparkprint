/**
 * In-process workers, started with the web server (so slicing + dispatch "just run" with
 * the app — no separate service to launch):
 *   - `slice`    → runs the CLI slicer (OrcaSlicer/Prusa/…) if available, stores the sliced
 *                  file, then hands off to dispatch. Falls back to the size estimate when no
 *                  slicer is configured, so the queue never gets stuck.
 *   - `dispatch` → uploads the sliced file to the printer over the LAN (FTPS) and starts it
 *                  (MQTT project_file), the way Bambu Studio's LAN mode does.
 * Backed by the in-process queue (queue.ts); on restart, recoverJobs() re-enqueues in-flight work.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { onSlice, onDispatch, enqueueSlice, enqueueDispatch } from './queue';
import { dispatch, logEvent } from './jobs';
import { db } from './db';
import { printJobs, models, printers } from './db/schema';
import { objectFsPath, putBuffer } from './storage';
import { realSlice, slicerAvailable } from './slicer-cli';
import { ensureSlicer } from './ensure-slicer';
import { orcaAvailable } from './orca';

const g = globalThis as unknown as { __sparkWorkers?: boolean };

async function sliceJob(jobId: string) {
	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job || !job.modelId) return;
	const [model] = await db.select().from(models).where(eq(models.id, job.modelId)).limit(1);
	if (!model) return;

	// Target printer model (assigned pre-slice) → OrcaSlicer machine profile.
	let printerModel = job.printerModelTarget ?? undefined;
	if (job.printerId) {
		const [p] = await db.select({ model: printers.model }).from(printers).where(eq(printers.id, job.printerId)).limit(1);
		if (p?.model) printerModel = p.model;
	}
	// One filament per requested color (multicolor via AMS); painted 3MF carries the assignments.
	const filamentTypes = (job.colorRequest ?? []).map((c) => c.filamentType || 'PLA');
	const filamentType = filamentTypes[0] || 'PLA';

	const proc = (job.process ?? {}) as Record<string, unknown>;
	const settings = {
		layerHeightMm: Number(proc.layerHeightMm ?? job.layerHeightMm ?? 0.2),
		infillPct: Number(proc.infillPct ?? job.infillPct ?? 15),
		supports: Boolean(proc.supports ?? job.supports),
		raft: Boolean(proc.raft),
		adhesion: typeof proc.adhesion === 'string' ? proc.adhesion : undefined,
		printerModel,
		filamentType,
		filamentTypes: filamentTypes.length > 1 ? filamentTypes : undefined
	};
	let result;
	try {
		result = await realSlice(objectFsPath(model.fileKey), settings);
	} catch (e) {
		await logEvent(jobId, 'slice', `Slicer error: ${(e as Error).message}. Using the size estimate.`);
		return; // stays assigned/queued — not stuck
	}
	if (!result) {
		await logEvent(jobId, 'slice', 'No slicer available — using the size estimate.');
		return;
	}

	const gcodeKey = `org/${job.orgId}/jobs/${jobId}.gcode.3mf`;
	await putBuffer(gcodeKey, await readFile(result.gcodePath));
	await db
		.update(printJobs)
		.set({
			gcodeKey,
			estimatedGrams: result.grams > 0 ? result.grams.toFixed(2) : job.estimatedGrams,
			estimatedTimeSec: result.timeSec > 0 ? result.timeSec : job.estimatedTimeSec,
			updatedAt: new Date()
		})
		.where(eq(printJobs.id, jobId));
	await logEvent(jobId, 'slice', `Sliced — ${Math.round(result.grams || Number(job.estimatedGrams ?? 0))} g`);

	await enqueueDispatch(jobId); // send it to the printer over the local network
}

/** Re-enqueue work that was in flight when the server last stopped. */
async function recoverJobs() {
	// Jobs assigned + sliced but not yet on a printer → dispatch again.
	const ready = await db.select({ id: printJobs.id }).from(printJobs).where(inArray(printJobs.status, ['ready', 'sending']));
	for (const j of ready) enqueueDispatch(j.id);
	// Jobs approved/queued that still need slicing (have a model, no gcode yet) → slice again.
	const queued = await db.select({ id: printJobs.id, gcodeKey: printJobs.gcodeKey }).from(printJobs).where(inArray(printJobs.status, ['queued', 'slicing']));
	for (const j of queued) if (!j.gcodeKey) enqueueSlice(j.id);
}

/**
 * Periodically re-attempt dispatch for jobs that are sliced and waiting on a printer. Without this,
 * a job that couldn't find a free/online printer at dispatch time would sit in "queued" forever;
 * now it goes automatically within ~20s of a printer coming online and idle.
 */
async function retryPending() {
	const rows = await db
		.select({ id: printJobs.id })
		.from(printJobs)
		.where(and(inArray(printJobs.status, ['queued', 'ready']), isNotNull(printJobs.gcodeKey)));
	for (const j of rows) enqueueDispatch(j.id);

	// Recover a send that never took: 'sending' for >4 min while its printer is online + idle (so the
	// print clearly didn't start) → free the printer and re-dispatch. Guarded on idle so we never
	// re-send to a printer that actually started the job.
	const sending = await db
		.select({ id: printJobs.id, printerId: printJobs.printerId, startedAt: printJobs.startedAt })
		.from(printJobs)
		.where(eq(printJobs.status, 'sending'));
	for (const j of sending) {
		if (!j.printerId || !j.startedAt || Date.now() - new Date(j.startedAt).getTime() < 4 * 60_000) continue;
		const [p] = await db.select({ status: printers.status, online: printers.online }).from(printers).where(eq(printers.id, j.printerId)).limit(1);
		if (p?.online && p.status === 'idle') {
			await db.update(printers).set({ currentJobId: null, updatedAt: new Date() }).where(eq(printers.id, j.printerId));
			await db.update(printJobs).set({ status: 'ready', updatedAt: new Date() }).where(eq(printJobs.id, j.id));
			await logEvent(j.id, 'dispatch', 'Retrying — the printer didn’t start the last send.');
			enqueueDispatch(j.id);
		}
	}
}

export async function startWorkers() {
	if (g.__sparkWorkers) return;
	g.__sparkWorkers = true;

	onSlice(sliceJob);
	onDispatch(dispatch);
	recoverJobs().catch((e) => console.error('[queue] recover', (e as Error).message));
	// Retry sliced-but-unsent jobs every 20s so they print as soon as a printer is free/online.
	setInterval(() => retryPending().catch(() => {}), 20000);

	// Warm up: prefer OrcaSlicer; only install the bundled Slic3r if Orca isn't present.
	orcaAvailable().then((o) => {
		if (!o) ensureSlicer().catch(() => {});
	});
	slicerAvailable().then((s) => console.log(`[queue] workers started · slicer: ${s ?? 'none (size-estimate fallback)'}`));
}
