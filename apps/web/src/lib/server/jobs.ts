import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './db';
import {
	printJobs,
	jobEvents,
	models,
	printers,
	amsUnits,
	amsSlots,
	orgs,
	type ColorRequest,
	type ColorMapping
} from './db/schema';
import { getEstimator, type SliceInput } from './slicer';
import { canSubmit } from './quota';
import { colorDistance } from '$lib/color';
import { readBuffer, objectExists } from './storage';
import { enqueueSlice } from './queue';
import { lanPrint } from './bambu/lan';

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
				// Only genuinely free printers — a 'finished' printer still has a print on the bed
				// awaiting pickup and must be checked out before it can be reused.
				eq(printers.status, 'idle')
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

		// ── LAN dispatch (FTPS upload + MQTT project_file) ───────────────────────
		// The reliable, open path: upload the sliced 3mf straight to the printer and tell it to
		// print. Requires the printer's local IP + LAN access code, and the server on the same
		// network as the printers. See docs/LAN.md.
		if (!job.gcodeKey || !objectExists(job.gcodeKey)) {
			await db.update(printJobs).set({ status: 'ready', printerId: p.id, colorMapping: mapping, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await logEvent(jobId, 'dispatch', 'Waiting on sliced file before sending');
			return 'queued';
		}
		if (!p.ipAddress || !p.accessCode) {
			await db.update(printJobs).set({ status: 'ready', printerId: p.id, colorMapping: mapping, failureReason: 'LAN not configured', updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await logEvent(jobId, 'error', `${p.name} needs its local IP + access code set for LAN printing (Admin → Printers → Set up LAN). See docs/LAN.md.`, { printerId: p.id });
			return 'queued';
		}
		const threeMf = await readBuffer(job.gcodeKey);
		// Bambu ams_mapping: index = filament slot in the 3mf; value = global AMS tray id (ams*4+slot).
		const amsMapping = mapping.map((m) => m.amsIndex * 4 + m.slotIndex);
		try {
			await lanPrint({
				ip: p.ipAddress,
				accessCode: p.accessCode,
				serial: p.devId,
				data: threeMf,
				fileName: `${jobId}.gcode.3mf`,
				amsMapping,
				useAms: mapping.length > 0,
				bedType: 'textured_plate',
				plateIdx: 1
			});
		} catch (e) {
			const msg = (e as Error).message;
			await db.update(printJobs).set({ status: 'ready', printerId: p.id, colorMapping: mapping, failureReason: msg, updatedAt: new Date() }).where(eq(printJobs.id, jobId));
			await logEvent(jobId, 'error', `Couldn't start the print on ${p.name}: ${msg}. Check the printer's IP/access code and that the server is on the same network.`, { printerId: p.id });
			return 'queued';
		}

		db.transaction((tx) => {
			tx.update(printJobs).set({ printerId: p.id, colorMapping: mapping, status: 'sending', startedAt: new Date(), updatedAt: new Date() }).where(eq(printJobs.id, jobId)).run();
			tx.update(printers).set({ currentJobId: jobId, updatedAt: new Date() }).where(eq(printers.id, p.id)).run();
		});
		await logEvent(jobId, 'dispatch', `Sent to ${p.name}`, { printerId: p.id, mapping });
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

	db.transaction((tx) => {
		tx.update(printJobs)
			.set({ status: 'canceled', finishedAt: new Date(), updatedAt: new Date() })
			.where(eq(printJobs.id, jobId))
			.run();
		if (job.printerId) {
			tx.update(printers)
				.set({ status: 'idle', currentJobId: null, progressPct: null, updatedAt: new Date() })
				.where(eq(printers.id, job.printerId))
				.run();
		}
	});
	await logEvent(jobId, 'status_change', 'Canceled', {}, actorId);
	return { ok: true };
}

/** Called when a printer finishes (mock: manual complete, or bridge telemetry). */
/**
 * Print finished on the machine. The plate is still physically on the bed, so the printer is NOT
 * freed and the queue is NOT advanced — the job goes to `awaiting_pickup` until someone checks it
 * out (confirming the print was removed). This is what makes the printer available again.
 */
export async function completeJob(jobId: string, actualGrams?: number) {
	const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
	if (!job || ['awaiting_pickup', 'completed', 'canceled'].includes(job.status)) return;
	db.transaction((tx) => {
		tx.update(printJobs)
			.set({
				status: 'awaiting_pickup',
				actualGrams: actualGrams != null ? actualGrams.toFixed(2) : job.estimatedGrams,
				finishedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(printJobs.id, jobId))
			.run();
		if (job.printerId) {
			// 'finished' = done but still occupied (awaiting pickup); stays until checkout.
			tx.update(printers)
				.set({ status: 'finished', progressPct: 100, updatedAt: new Date() })
				.where(eq(printers.id, job.printerId))
				.run();
		}
	});
	await logEvent(jobId, 'status_change', 'Print finished — awaiting pickup');
}

/**
 * A finished print was physically removed from the bed. Marks the job completed, frees the printer,
 * and pulls the next queued job onto it. Callable by the job's owner or any staff member.
 */
export async function checkoutJob(jobId: string, orgId: string, actorId?: string): Promise<{ ok: boolean; error?: string }> {
	const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, orgId))).limit(1);
	if (!job) return { ok: false, error: 'Print not found' };
	if (job.status !== 'awaiting_pickup') return { ok: false, error: 'This print isn’t awaiting pickup' };
	db.transaction((tx) => {
		tx.update(printJobs).set({ status: 'completed', updatedAt: new Date() }).where(eq(printJobs.id, jobId)).run();
		if (job.printerId) {
			tx.update(printers)
				.set({ status: 'idle', currentJobId: null, progressPct: null, updatedAt: new Date() })
				.where(eq(printers.id, job.printerId))
				.run();
		}
	});
	await logEvent(jobId, 'status_change', 'Checked out — printer freed', {}, actorId);
	if (job.printerId) await promoteQueue(orgId);
	return { ok: true };
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
