/**
 * Shared job queue (pg-boss, backed by the same Postgres as the app).
 *   - `slice`    — consumed by the services/slicer worker (heavy CPU, separate container).
 *   - `dispatch` — consumed here in the web process (has Bambu tokens + MQTT manager).
 *
 * Singleton, HMR-safe. Queue names are created on boot (pg-boss v10 requires explicit
 * queue creation).
 */
import PgBoss from 'pg-boss';
import { env } from '$env/dynamic/private';

export const SLICE_QUEUE = 'slice';
export const DISPATCH_QUEUE = 'dispatch';

const g = globalThis as unknown as { __sparkBoss?: Promise<PgBoss> };

export async function getBoss(): Promise<PgBoss> {
	if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	if (!g.__sparkBoss) {
		g.__sparkBoss = (async () => {
			const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
			boss.on('error', (e) => console.error('[queue] pg-boss error', e));
			await boss.start();
			await boss.createQueue(SLICE_QUEUE).catch(() => {});
			await boss.createQueue(DISPATCH_QUEUE).catch(() => {});
			return boss;
		})();
	}
	return g.__sparkBoss;
}

export async function enqueueSlice(jobId: string) {
	const boss = await getBoss();
	await boss.send(SLICE_QUEUE, { jobId });
}

export async function enqueueDispatch(jobId: string, delaySeconds = 0) {
	const boss = await getBoss();
	await boss.send(DISPATCH_QUEUE, { jobId }, delaySeconds ? { startAfter: delaySeconds } : {});
}

/** Normalize pg-boss's handler payload (array in v10) to individual job datas. */
export function jobsOf<T = { jobId: string }>(arg: unknown): T[] {
	const arr = Array.isArray(arg) ? arg : [arg];
	return arr.map((j: any) => j?.data).filter(Boolean);
}
