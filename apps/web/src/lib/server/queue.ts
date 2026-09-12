/**
 * In-process job queue for a single self-hosted box (no external broker).
 *   - `slice`    — runs the slicer (heavy CPU), one at a time.
 *   - `dispatch` — uploads to the printer + starts the print.
 * Job state lives in the print_jobs table, so a restart can recover in-flight work
 * (see recoverJobs in workers.ts). HMR-safe via a globalThis singleton.
 */
type Handler = (jobId: string) => Promise<unknown>;

type QueueState = {
	handlers: { slice?: Handler; dispatch?: Handler };
	queues: { slice: string[]; dispatch: string[] };
	running: { slice: boolean; dispatch: boolean };
};

const g = globalThis as unknown as { __sparkQueue?: QueueState };
function state(): QueueState {
	if (!g.__sparkQueue) g.__sparkQueue = { handlers: {}, queues: { slice: [], dispatch: [] }, running: { slice: false, dispatch: false } };
	return g.__sparkQueue;
}

async function pump(lane: 'slice' | 'dispatch') {
	const s = state();
	if (s.running[lane]) return;
	const handler = s.handlers[lane];
	if (!handler) return;
	s.running[lane] = true;
	try {
		for (;;) {
			const jobId = s.queues[lane].shift();
			if (!jobId) break;
			try {
				await handler(jobId);
			} catch (e) {
				console.error(`[queue] ${lane} failed for ${jobId}:`, (e as Error).message);
			}
		}
	} finally {
		s.running[lane] = false;
	}
}

export function onSlice(handler: Handler) {
	state().handlers.slice = handler;
	pump('slice');
}
export function onDispatch(handler: Handler) {
	state().handlers.dispatch = handler;
	pump('dispatch');
}

export async function enqueueSlice(jobId: string) {
	state().queues.slice.push(jobId);
	pump('slice');
}

export async function enqueueDispatch(jobId: string, delaySeconds = 0) {
	if (delaySeconds > 0) {
		setTimeout(() => {
			state().queues.dispatch.push(jobId);
			pump('dispatch');
		}, delaySeconds * 1000);
		return;
	}
	state().queues.dispatch.push(jobId);
	pump('dispatch');
}
