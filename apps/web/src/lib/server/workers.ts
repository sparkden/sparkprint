/**
 * In-process workers, started with the web server (so slicing + dispatch "just run" with
 * the app — no separate service to launch):
 *   - `slice`    → runs the CLI slicer (OrcaSlicer/Prusa/…) if available, stores the sliced
 *                  file, then hands off to dispatch. Falls back to the size estimate when no
 *                  slicer is configured, so the queue never gets stuck.
 *   - `dispatch` → sends the sliced file to the printer via Bambu's cloud (the same
 *                  create-project → upload → /my/task flow Bambu Studio uses).
 * A separate services/slicer container can also subscribe to `slice` to scale out; pg-boss
 * hands each job to exactly one worker.
 */
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { getBoss, SLICE_QUEUE, DISPATCH_QUEUE, enqueueDispatch, jobsOf } from './queue';
import { dispatch, logEvent } from './jobs';
import { db } from './db';
import { printJobs, models } from './db/schema';
import { objectFsPath, putBuffer } from './storage';
import { realSlice, slicerAvailable } from './slicer-cli';

const g = globalThis as unknown as { __sparkWorkers?: boolean };

async function sliceJob(jobId: string) {
	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job || !job.modelId) return;
	const [model] = await db.select().from(models).where(eq(models.id, job.modelId)).limit(1);
	if (!model) return;

	let result;
	try {
		result = await realSlice(objectFsPath(model.fileKey));
	} catch (e) {
		await logEvent(jobId, 'slice', `Slicer error: ${(e as Error).message}. Using the size estimate.`);
		return; // stays assigned/queued — not stuck
	}
	if (!result) {
		await logEvent(jobId, 'slice', 'No slicer configured — using the size estimate. Set SLICER_CMD to enable real slicing.');
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

	await enqueueDispatch(jobId); // send it to the printer via the cloud
}

export async function startWorkers() {
	if (g.__sparkWorkers) return;
	g.__sparkWorkers = true;
	const boss = await getBoss();

	await boss.work(SLICE_QUEUE, { batchSize: 1 }, async (jobs: unknown) => {
		for (const d of jobsOf<{ jobId: string }>(jobs)) {
			try { await sliceJob(d.jobId); } catch (e) { console.error('[slice] failed', (e as Error).message); }
		}
	});
	await boss.work(DISPATCH_QUEUE, { batchSize: 1 }, async (jobs: unknown) => {
		for (const d of jobsOf<{ jobId: string }>(jobs)) {
			try { await dispatch(d.jobId); } catch (e) { console.error('[dispatch] failed', (e as Error).message); }
		}
	});

	slicerAvailable().then((s) => console.log(`[queue] workers started · slicer: ${s ?? 'none (size-estimate fallback)'}`));
}
