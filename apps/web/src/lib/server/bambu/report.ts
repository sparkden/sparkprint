/**
 * Parse a Bambu MQTT `device/<dev_id>/report` payload (the `print` object) and write it
 * into the DB: printer telemetry + AMS slots. Also detects print completion to advance
 * the matching print_jobs row.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { printers, amsUnits, amsSlots, printJobs } from '../db/schema';
import { completeJob, promoteQueue } from '../jobs';

const STATE_MAP: Record<string, 'idle' | 'printing' | 'paused' | 'error' | 'finished'> = {
	IDLE: 'idle',
	PREPARE: 'printing',
	RUNNING: 'printing',
	SLICING: 'printing',
	PAUSE: 'paused',
	FINISH: 'finished',
	FAILED: 'error'
};

/** "FF6A00FF" (RRGGBBAA) → "#FF6A00". Returns null for empty/invalid. */
function normColor(c: string | undefined | null): string | null {
	if (!c || typeof c !== 'string') return null;
	const hex = c.replace(/^#/, '');
	if (hex.length < 6) return null;
	return `#${hex.slice(0, 6).toUpperCase()}`;
}
function numOrNull(v: unknown): number | null {
	const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
	return Number.isFinite(n) ? n : null;
}

/** Route a telemetry report by device serial alone (used by the LAN per-printer connection). */
export async function applyReportByDevId(devId: string, print: any) {
	if (!print || typeof print !== 'object') return;
	const [printer] = await db.select().from(printers).where(eq(printers.devId, devId)).limit(1);
	if (printer) await applyReportForPrinter(printer, print);
}

export async function applyReport(accountId: string, devId: string, print: any) {
	if (!print || typeof print !== 'object') return;

	const [printer] = await db
		.select()
		.from(printers)
		.where(and(eq(printers.devId, devId), eq(printers.bambuAccountId, accountId)))
		.limit(1);
	if (!printer) return; // device not imported (or not ours)
	await applyReportForPrinter(printer, print);
}

async function applyReportForPrinter(printer: typeof printers.$inferSelect, print: any) {

	// ── Telemetry ───────────────────────────────────────────────────────────────
	const patch: Record<string, unknown> = { online: true, lastSeenAt: new Date(), updatedAt: new Date() };
	if (typeof print.gcode_state === 'string' && STATE_MAP[print.gcode_state]) {
		let s = STATE_MAP[print.gcode_state];
		// A Bambu printer reports FINISH until the next print starts. That only means "occupied /
		// awaiting checkout" when SparkPrint is actually tracking a job here (currentJobId). With no
		// tracked job, a stale/external FINISH just means the bed is free → treat it as idle so the
		// printer doesn't get stuck unusable.
		if (s === 'finished' && !printer.currentJobId) s = 'idle';
		patch.status = s;
	}
	if (print.mc_percent != null) patch.progressPct = numOrNull(print.mc_percent);
	if (print.mc_remaining_time != null) patch.remainingTimeMin = numOrNull(print.mc_remaining_time);
	if (print.nozzle_temper != null) patch.nozzleTemp = numOrNull(print.nozzle_temper)?.toFixed(1);
	if (print.bed_temper != null) patch.bedTemp = numOrNull(print.bed_temper)?.toFixed(1);
	await db.update(printers).set(patch).where(eq(printers.id, printer.id));

	// ── AMS sync ──────────────────────────────────────────────────────────────────
	const amsList: any[] = print?.ams?.ams ?? [];
	for (const unit of amsList) {
		const amsIndex = parseInt(unit.id ?? '0', 10) || 0;
		const [existingUnit] = await db
			.select()
			.from(amsUnits)
			.where(and(eq(amsUnits.printerId, printer.id), eq(amsUnits.amsIndex, amsIndex)))
			.limit(1);
		let amsUnitId: string;
		const unitVals = { humidity: numOrNull(unit.humidity), temperature: numOrNull(unit.temp)?.toFixed(1), updatedAt: new Date() };
		if (existingUnit) {
			await db.update(amsUnits).set(unitVals).where(eq(amsUnits.id, existingUnit.id));
			amsUnitId = existingUnit.id;
		} else {
			const [created] = await db.insert(amsUnits).values({ printerId: printer.id, amsIndex, ...unitVals }).returning();
			amsUnitId = created.id;
		}

		for (const tray of unit.tray ?? []) {
			const slotIndex = parseInt(tray.id ?? '0', 10) || 0;
			const color = normColor(tray.tray_color);
			const empty = !tray.tray_type || tray.tray_type === '';
			const [existingSlot] = await db
				.select()
				.from(amsSlots)
				.where(and(eq(amsSlots.amsUnitId, amsUnitId), eq(amsSlots.slotIndex, slotIndex)))
				.limit(1);
			// If an admin set this slot's color, it's authoritative — telemetry only refreshes the
			// remaining%/uuid, never the color/type/empty (the printer can't identify the filament).
			if (existingSlot?.manualColor) {
				await db.update(amsSlots).set({ remainingPct: numOrNull(tray.remain) ?? existingSlot.remainingPct, trayUuid: tray.tray_uuid || existingSlot.trayUuid, updatedAt: new Date() }).where(eq(amsSlots.id, existingSlot.id));
				continue;
			}
			const slotVals = {
				printerId: printer.id,
				filamentType: empty ? null : tray.tray_type || existingSlot?.filamentType || 'PLA',
				filamentBrand: tray.tray_sub_brands || existingSlot?.filamentBrand || 'Bambu',
				colorHex: empty ? null : color ?? existingSlot?.colorHex ?? null,
				colorName: empty ? null : tray.tray_id_name || existingSlot?.colorName || null,
				trayUuid: tray.tray_uuid || existingSlot?.trayUuid || null,
				remainingPct: numOrNull(tray.remain),
				empty,
				updatedAt: new Date()
			};
			if (existingSlot) {
				await db.update(amsSlots).set(slotVals).where(eq(amsSlots.id, existingSlot.id));
			} else {
				await db.insert(amsSlots).values({ amsUnitId, slotIndex, ...slotVals });
			}
		}
		if (!printer.hasAms) await db.update(printers).set({ hasAms: true }).where(eq(printers.id, printer.id));
	}

	// ── External spool (vt_tray) for printers without an AMS ────────────────────────
	// Stored as a pseudo-unit (amsIndex 254) so its color shows in the picker and matches like any
	// other slot; dispatch prints it with use_ams=false.
	const vt = print?.vt_tray;
	if (!amsList.length && vt && typeof vt === 'object') {
		const color = normColor(vt.tray_color);
		const empty = !vt.tray_type || vt.tray_type === '';
		const EXT = 254;
		const [unit] = await db.select().from(amsUnits).where(and(eq(amsUnits.printerId, printer.id), eq(amsUnits.amsIndex, EXT))).limit(1);
		const unitId = unit?.id ?? (await db.insert(amsUnits).values({ printerId: printer.id, amsIndex: EXT, updatedAt: new Date() }).returning())[0].id;
		const [existing] = await db.select().from(amsSlots).where(and(eq(amsSlots.amsUnitId, unitId), eq(amsSlots.slotIndex, 0))).limit(1);
		if (existing?.manualColor) {
			await db.update(amsSlots).set({ remainingPct: numOrNull(vt.remain) ?? existing.remainingPct, updatedAt: new Date() }).where(eq(amsSlots.id, existing.id));
			return;
		}
		// Only overwrite a manually-set external color when the printer actually reports one.
		const slotVals = {
			printerId: printer.id,
			filamentType: empty ? null : vt.tray_type || existing?.filamentType || 'PLA',
			filamentBrand: vt.tray_sub_brands || existing?.filamentBrand || 'External',
			colorHex: empty ? null : color ?? existing?.colorHex ?? null,
			colorName: empty ? null : vt.tray_id_name || existing?.colorName || null,
			trayUuid: vt.tray_uuid || existing?.trayUuid || null,
			remainingPct: numOrNull(vt.remain),
			empty,
			updatedAt: new Date()
		};
		if (existing) await db.update(amsSlots).set(slotVals).where(eq(amsSlots.id, existing.id));
		else await db.insert(amsSlots).values({ amsUnitId: unitId, slotIndex: 0, ...slotVals });
	}

	// ── Drive the active job from telemetry ────────────────────────────────────────
	// Keep the job's status in lockstep with the printer, and — critically — only complete a job
	// that actually reached 'printing'. Right after dispatch the printer can still be reporting the
	// PREVIOUS print's FINISH; completing on that would mark a job done before it ever started.
	if (printer.currentJobId) {
		const gs = typeof print.gcode_state === 'string' ? print.gcode_state : '';
		const jobId = printer.currentJobId;
		if (gs === 'RUNNING' || gs === 'PREPARE' || gs === 'SLICING') {
			await db
				.update(printJobs)
				.set({ status: 'printing', updatedAt: new Date() })
				.where(and(eq(printJobs.id, jobId), inArray(printJobs.status, ['sending', 'ready', 'queued', 'printing'])));
		} else if (gs === 'PAUSE') {
			await db
				.update(printJobs)
				.set({ status: 'paused', updatedAt: new Date() })
				.where(and(eq(printJobs.id, jobId), inArray(printJobs.status, ['printing', 'sending'])));
		} else if (gs === 'FINISH') {
			const [j] = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
			if (j && (j.status === 'printing' || j.status === 'paused')) await completeJob(jobId);
		} else if (gs === 'FAILED') {
			const [j] = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
			if (j && ['printing', 'paused', 'sending'].includes(j.status)) {
				db.transaction((tx) => {
					tx.update(printJobs).set({ status: 'failed', failureReason: 'Printer reported a failure', finishedAt: new Date(), updatedAt: new Date() }).where(eq(printJobs.id, jobId)).run();
					tx.update(printers).set({ status: 'error', currentJobId: null, progressPct: null, updatedAt: new Date() }).where(eq(printers.id, printer.id)).run();
				});
				await promoteQueue(printer.orgId);
			}
		}
	}
}
