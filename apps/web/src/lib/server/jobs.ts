import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import {
	printJobs,
	jobEvents,
	models,
	printers,
	amsUnits,
	amsSlots,
	orgs,
	bambuAccounts,
	type ColorRequest,
	type ColorMapping
} from './db/schema';
import { getEstimator, type SliceInput } from './slicer';
import { canSubmit } from './quota';
import { BAMBU_MODE, region as normRegion } from './bambu/config';
import { colorDistance } from '$lib/color';
import { decrypt, signId } from './crypto';
import { readBuffer, objectExists } from './storage';
import { publicOrigin } from './public-origin';
import { enqueueSlice } from './queue';
import { sendCloudPrint, md5Hex } from './bambu/cloudprint';

// ── Events / timeline ─────────────────────────────────────────────────────────
export async function logEvent(
	jobId: string,
	type: string,
	message?: string,
	data: Record<string, unknown> = {},
	actorId?: string | null
) {
	await db.insert(jobEvents).values({ jobId, type, message, data, actorId: actorId ?? null });
}

// ── Color matching ────────────────────────────────────────────────────────────
const COLOR_TOLERANCE = 70;

type LoadedSlot = {
	id: string;
	amsIndex: number;
	slotIndex: number;
	filamentType: string | null;
	colorHex: string | null;
	empty: boolean;
	remainingPct: number | null;
};

/** Best matching slot on a printer for one requested color, or null. */
function matchSlot(req: ColorRequest, slots: LoadedSlot[]): LoadedSlot | null {
	let best: LoadedSlot | null = null;
	let bestDist = Infinity;
	for (const s of slots) {
		if (s.empty || !s.colorHex) continue;
		if (req.filamentType && s.filamentType && s.filamentType.toUpperCase() !== req.filamentType.toUpperCase())
			continue;
		const dist = colorDistance(req.colorHex, s.colorHex);
		if (dist <= COLOR_TOLERANCE && dist < bestDist) {
			best = s;
			bestDist = dist;
		}
	}
	return best;
}

// ── Instant pre-estimate (quota gate only; real numbers come from the slicer) ───
async function preEstimate(job: typeof printJobs.$inferSelect) {
	let bbox = { x: 50, y: 50, z: 50 };
	let volumeMm3 = 20000;
	if (job.modelId) {
		const [m] = await db.select().from(models).where(eq(models.id, job.modelId)).limit(1);
		const meta = (m?.meta ?? {}) as any;
		if (meta.bbox) bbox = meta.bbox;
		if (typeof meta.volumeMm3 === 'number') volumeMm3 = meta.volumeMm3;
	}
	const req = (job.colorRequest as ColorRequest[])[0];
	const input: SliceInput = {
		bbox,
		volumeMm3,
		layerHeightMm: Number(job.layerHeightMm ?? 0.2),
		infillPct: job.infillPct ?? 15,
		supports: job.supports,
		copies: job.copies,
		filamentType: req?.filamentType ?? 'PLA'
	};
	return getEstimator().estimate(input);
}

// ── Dispatch: find a printer whose AMS has the requested colors ────────────────
export async function dispatch(jobId: string): Promise<'printing' | 'queued'> {
	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job) return 'queued';
	const requests = job.colorRequest as ColorRequest[];

	const candidates = await db
		.select()
		.from(printers)
		.where(
			and(
				eq(printers.orgId, job.orgId),
				eq(printers.enabled, true),
				eq(printers.online, true),
				inArray(printers.status, ['idle', 'finished'])
			)
		)
		.orderBy(desc(printers.priority), asc(printers.name));

	for (const p of candidates) {
		if (!isCloudPrintable(p.model)) continue; // skip combo/laser machines (e.g. H2C)
		if (job.printerModelTarget && p.model !== job.printerModelTarget) continue;

		const slots = await db
			.select({
				id: amsSlots.id,
				amsIndex: amsUnits.amsIndex,
				slotIndex: amsSlots.slotIndex,
				filamentType: amsSlots.filamentType,
				colorHex: amsSlots.colorHex,
				empty: amsSlots.empty,
				remainingPct: amsSlots.remainingPct
			})
			.from(amsSlots)
			.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
			.where(eq(amsSlots.printerId, p.id));

		const mapping: ColorMapping[] = [];
		let ok = true;
		for (let i = 0; i < requests.length; i++) {
			const slot = matchSlot(requests[i], slots as LoadedSlot[]);
			if (!slot) {
				ok = false;
				break;
			}
			mapping.push({
				filamentIndex: i,
				amsSlotId: slot.id,
				amsIndex: slot.amsIndex,
				slotIndex: slot.slotIndex,
				colorHex: slot.colorHex!
			});
		}
		if (!ok) continue;

		// Dev-only mock fallback: no real account, just simulate a start.
		if (BAMBU_MODE === 'mock') {
			await db.transaction(async (tx) => {
				await tx.update(printJobs).set({ printerId: p.id, colorMapping: mapping, status: 'printing', startedAt: new Date(), updatedAt: new Date() }).where(eq(printJobs.id, jobId));
				await tx.update(printers).set({ status: 'printing', currentJobId: jobId, progressPct: 0, updatedAt: new Date() }).where(eq(printers.id, p.id));
			});
			await logEvent(jobId, 'dispatch', `Sent to ${p.name}`, { printerId: p.id, mapping });
			return 'printing';
		}

		// ── Real cloud dispatch ──────────────────────────────────────────────────
		if (!job.gcodeKey || !objectExists(job.gcodeKey)) {
			await db.update(printJobs).set({ status: 'ready', printerId: p.id, colorMapping: mapping, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await logEvent(jobId, 'dispatch', 'Waiting on sliced file before sending');
			return 'queued';
		}
		if (!p.bambuAccountId) {
			await logEvent(jobId, 'error', `${p.name} has no connected Bambu account`);
			continue;
		}
		const [acct] = await db.select().from(bambuAccounts).where(eq(bambuAccounts.id, p.bambuAccountId)).limit(1);
		const token = decrypt(acct?.accessToken);
		if (!acct || !token) {
			await logEvent(jobId, 'error', 'Bambu account token unavailable — reconnect the account');
			continue;
		}

		// The printer downloads the sliced 3mf from a public URL we host; build it now. Without a
		// known public origin the printer couldn't fetch the file, so hold the job rather than
		// dispatch a link that will fail verification.
		const origin = publicOrigin();
		if (!origin) {
			await db.update(printJobs).set({ status: 'ready', printerId: p.id, colorMapping: mapping, failureReason: 'no public URL yet', updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await logEvent(jobId, 'error', 'Cannot reach the printer yet — open SparkPrint in a browser (or set PRINT_PUBLIC_ORIGIN) so the printer can download the file.');
			return 'queued';
		}
		const threeMf = await readBuffer(job.gcodeKey);
		const fileUrl = `${origin}/api/print/${signId(jobId)}.gcode.3mf`;
		// Bambu ams_mapping: index = filament slot in the 3mf; value = global AMS tray id (ams*4+slot).
		const amsMapping = mapping.map((m) => m.amsIndex * 4 + m.slotIndex);

		const send = await sendCloudPrint({
			accessToken: token,
			region: normRegion(acct.region),
			devId: p.devId,
			jobName: job.name,
			fileUrl,
			md5: md5Hex(threeMf),
			plateIdx: 1,
			bedType: 'textured_plate',
			amsMapping
		});

		if (!send.ok) {
			await db.update(printJobs).set({ status: 'ready', printerId: p.id, colorMapping: mapping, failureReason: send.error ?? 'send failed', updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await logEvent(jobId, 'error', `Cloud send failed: ${send.error ?? 'unknown'}`, { printerId: p.id });
			return 'queued';
		}

		await db.transaction(async (tx) => {
			await tx.update(printJobs).set({ printerId: p.id, colorMapping: mapping, status: 'sending', startedAt: new Date(), updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await tx.update(printers).set({ currentJobId: jobId, updatedAt: new Date() }).where(eq(printers.id, p.id));
		});
		await logEvent(jobId, 'dispatch', `Sent to ${p.name}`, { printerId: p.id, taskId: send.taskId, mapping });
		return 'printing';
	}

	await db.update(printJobs).set({ status: 'queued', updatedAt: new Date() }).where(eq(printJobs.id, jobId));
	await logEvent(jobId, 'queue', 'Waiting for a compatible printer');
	return 'queued';
}

// ── Assign a printer (color + priority) without slicing — the student-facing step ──
// Picks the highest-priority enabled printer that has the requested color(s) loaded and
// records the assignment. Returns the printer name so the UI can say "on Printer 4".
/**
 * Models we can both slice (OrcaSlicer machine profile exists) and drive via the standard Bambu
 * cloud FDM print task. Combo/laser machines like the H2C reject that task with HTTP 403 ("no
 * access rights to the content"), so they're excluded from auto-routing — jobs fall through to a
 * compatible FDM printer instead of failing at dispatch.
 */
export const CLOUD_PRINTABLE_MODELS = ['X1', 'X1C', 'X1E', 'P1S', 'P1P', 'A1', 'A1M', 'H2D'] as const;
const CLOUD_PRINTABLE = new Set<string>(CLOUD_PRINTABLE_MODELS);
export function isCloudPrintable(model: string | null | undefined): boolean {
	return !!model && CLOUD_PRINTABLE.has(model);
}

export async function assignPrinter(jobId: string): Promise<string | null> {
	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job) return null;
	const requests = job.colorRequest as ColorRequest[];

	const candidates = await db
		.select()
		.from(printers)
		.where(and(eq(printers.orgId, job.orgId), eq(printers.enabled, true)))
		.orderBy(desc(printers.priority), asc(printers.name));

	for (const p of candidates) {
		if (!isCloudPrintable(p.model)) continue; // skip combo/laser machines (e.g. H2C)
		if (job.printerModelTarget && p.model !== job.printerModelTarget) continue;
		const slots = await db
			.select({
				id: amsSlots.id, amsIndex: amsUnits.amsIndex, slotIndex: amsSlots.slotIndex,
				filamentType: amsSlots.filamentType, colorHex: amsSlots.colorHex, empty: amsSlots.empty, remainingPct: amsSlots.remainingPct
			})
			.from(amsSlots)
			.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
			.where(eq(amsSlots.printerId, p.id));

		const mapping: ColorMapping[] = [];
		let ok = true;
		for (let i = 0; i < requests.length; i++) {
			const slot = matchSlot(requests[i], slots as LoadedSlot[]);
			if (!slot) { ok = false; break; }
			mapping.push({ filamentIndex: i, amsSlotId: slot.id, amsIndex: slot.amsIndex, slotIndex: slot.slotIndex, colorHex: slot.colorHex! });
		}
		if (!ok) continue;

		await db.update(printJobs).set({ printerId: p.id, colorMapping: mapping, status: 'queued', updatedAt: new Date() }).where(eq(printJobs.id, jobId));
		await logEvent(jobId, 'assign', `Assigned to ${p.name}`, { printerId: p.id, mapping });
		return p.name;
	}

	await db.update(printJobs).set({ status: 'queued', printerId: null, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
	await logEvent(jobId, 'queue', 'Waiting for a printer with the right color');
	return null;
}

// ── Submit a new job ──────────────────────────────────────────────────────────
export type SubmitInput = {
	orgId: string;
	userId: string;
	modelId: string | null;
	name: string;
	colorRequest: ColorRequest[];
	layerHeightMm: number;
	infillPct: number;
	supports: boolean;
	copies: number;
	printerModelTarget: string | null;
	process?: Record<string, unknown>;
};

export async function submitJob(input: SubmitInput) {
	const [org] = await db.select().from(orgs).where(eq(orgs.id, input.orgId)).limit(1);

	// Create as draft to run the estimate.
	const [job] = await db
		.insert(printJobs)
		.values({
			orgId: input.orgId,
			userId: input.userId,
			modelId: input.modelId,
			name: input.name,
			status: 'draft',
			colorRequest: input.colorRequest,
			layerHeightMm: input.layerHeightMm.toFixed(2),
			infillPct: input.infillPct,
			supports: input.supports,
			copies: input.copies,
			printerModelTarget: input.printerModelTarget,
			process: input.process ?? {}
		})
		.returning();

	// Instant geometry estimate — only to gate the quota before we spend a slice.
	const est = await preEstimate(job);
	const costPerKg = Number(org?.defaultCostPerKg ?? 25);
	const cost = (est.grams / 1000) * costPerKg;

	const check = await canSubmit(input.userId, est.grams);
	if (!check.ok) {
		await db.delete(printJobs).where(eq(printJobs.id, job.id));
		return { ok: false as const, error: check.reason!, usage: check.usage };
	}

	const needsApproval = !!org?.approvalMode;
	await db
		.update(printJobs)
		.set({
			status: needsApproval ? 'pending_approval' : 'queued',
			estimatedGrams: est.grams.toFixed(2),
			estimatedTimeSec: est.timeSec,
			estimatedCost: cost.toFixed(2),
			submittedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(printJobs.id, job.id));

	await logEvent(job.id, 'submit', needsApproval ? 'Submitted for approval' : 'Submitted', {}, input.userId);

	if (needsApproval) {
		return { ok: true as const, jobId: job.id, status: 'pending_approval' as const, estimate: est, printerName: null };
	}
	// Assign the print to a printer right away and tell the student where it'll go.
	const printerName = await assignPrinter(job.id);
	await enqueueSlice(job.id).catch(() => {}); // real slice → cloud send, in the background
	return { ok: true as const, jobId: job.id, status: 'queued' as const, estimate: est, printerName };
}

// ── Approvals ─────────────────────────────────────────────────────────────────
export async function approveJob(jobId: string, orgId: string, actorId: string, note?: string) {
	const [job] = await db
		.select()
		.from(printJobs)
		.where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, orgId)))
		.limit(1);
	if (!job || job.status !== 'pending_approval') return { ok: false, error: 'Job is not pending approval' };
	await db
		.update(printJobs)
		.set({ approvedBy: actorId, approvalNote: note ?? null, updatedAt: new Date() })
		.where(eq(printJobs.id, jobId));
	await logEvent(jobId, 'approval', 'Approved', { note }, actorId);
	const printerName = await assignPrinter(jobId);
	await enqueueSlice(jobId).catch(() => {});
	return { ok: true, status: 'queued' as const, printerName };
}

export async function rejectJob(jobId: string, orgId: string, actorId: string, note?: string) {
	const [job] = await db
		.select()
		.from(printJobs)
		.where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, orgId)))
		.limit(1);
	if (!job || job.status !== 'pending_approval') return { ok: false, error: 'Job is not pending approval' };
	await db
		.update(printJobs)
		.set({ status: 'rejected', approvedBy: actorId, approvalNote: note ?? null, updatedAt: new Date() })
		.where(eq(printJobs.id, jobId));
	await logEvent(jobId, 'approval', 'Rejected', { note }, actorId);
	return { ok: true };
}

// ── Cancel ────────────────────────────────────────────────────────────────────
export async function cancelJob(jobId: string, orgId: string, actorId: string) {
	const [job] = await db
		.select()
		.from(printJobs)
		.where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, orgId)))
		.limit(1);
	if (!job) return { ok: false, error: 'Not found' };
	if (['completed', 'canceled', 'rejected', 'failed'].includes(job.status))
		return { ok: false, error: 'Job already finished' };

	await db.transaction(async (tx) => {
		await tx
			.update(printJobs)
			.set({ status: 'canceled', finishedAt: new Date(), updatedAt: new Date() })
			.where(eq(printJobs.id, jobId));
		if (job.printerId) {
			await tx
				.update(printers)
				.set({ status: 'idle', currentJobId: null, progressPct: null, updatedAt: new Date() })
				.where(eq(printers.id, job.printerId));
		}
	});
	await logEvent(jobId, 'status_change', 'Canceled', {}, actorId);
	return { ok: true };
}

/** Called when a printer finishes (mock: manual complete, or bridge telemetry). */
export async function completeJob(jobId: string, actualGrams?: number) {
	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job) return;
	await db.transaction(async (tx) => {
		await tx
			.update(printJobs)
			.set({
				status: 'completed',
				actualGrams: actualGrams != null ? actualGrams.toFixed(2) : job.estimatedGrams,
				finishedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(printJobs.id, jobId));
		if (job.printerId) {
			await tx
				.update(printers)
				.set({ status: 'finished', currentJobId: null, progressPct: 100, updatedAt: new Date() })
				.where(eq(printers.id, job.printerId));
		}
	});
	await logEvent(jobId, 'status_change', 'Completed');
	// Try to pull the next queued job onto the freed printer.
	if (job.printerId) await promoteQueue(job.orgId);
}

/** After a printer frees up, try to dispatch the oldest queued job. */
export async function promoteQueue(orgId: string) {
	const queued = await db
		.select({ id: printJobs.id })
		.from(printJobs)
		.where(and(eq(printJobs.orgId, orgId), eq(printJobs.status, 'queued')))
		.orderBy(asc(printJobs.priority), asc(printJobs.submittedAt));
	for (const q of queued) {
		const result = await dispatch(q.id);
		if (result === 'printing') break; // one printer freed → dispatch one
	}
}
