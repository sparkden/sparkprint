/**
 * In-process workers started with the web server (cloud mode only): consumes the
 * `dispatch` queue and sends sliced jobs to printers via the Bambu cloud. Slicing itself
 * runs in the separate services/slicer container.
 */
import { getBoss, DISPATCH_QUEUE, jobsOf } from './queue';
import { dispatch } from './jobs';
import { BAMBU_MODE } from './bambu/config';

const g = globalThis as unknown as { __sparkWorkers?: boolean };

export async function startWorkers() {
	if (BAMBU_MODE !== 'cloud' || g.__sparkWorkers) return;
	g.__sparkWorkers = true;
	const boss = await getBoss();
	await boss.work(DISPATCH_QUEUE, { batchSize: 1 }, async (jobs: unknown) => {
		for (const d of jobsOf<{ jobId: string }>(jobs)) {
			try {
				await dispatch(d.jobId);
			} catch (e) {
				console.error('[dispatch] failed', (e as Error).message);
			}
		}
	});
	console.log('[queue] dispatch worker started');
}
