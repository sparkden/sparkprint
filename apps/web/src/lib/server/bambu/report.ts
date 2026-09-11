/**
 * Parse a Bambu MQTT `device/<dev_id>/report` payload (the `print` object) and write it
 * into the DB: printer telemetry + AMS slots. Also detects print completion to advance
 * the matching print_jobs row.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { printers, amsUnits, amsSlots, printJobs } from '../db/schema';
import { completeJob } from '../jobs';

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
	if (typeof print.gcode_state === 'string' && STATE_MAP[print.gcode_state])
		patch.status = STATE_MAP[print.gcode_state];
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
			const slotVals = {
				printerId: printer.id,
				filamentType: empty ? null : tray.tray_type,
				filamentBrand: tray.tray_sub_brands || 'Bambu',
				colorHex: color,
				colorName: tray.tray_id_name || null,
				trayUuid: tray.tray_uuid || null,
				remainingPct: numOrNull(tray.remain),
				empty,
				updatedAt: new Date()
			};
			const [existingSlot] = await db
				.select()
				.from(amsSlots)
				.where(and(eq(amsSlots.amsUnitId, amsUnitId), eq(amsSlots.slotIndex, slotIndex)))
				.limit(1);
			if (existingSlot) {
				await db.update(amsSlots).set(slotVals).where(eq(amsSlots.id, existingSlot.id));
			} else {
				await db.insert(amsSlots).values({ amsUnitId, slotIndex, ...slotVals });
			}
		}
		if (!printer.hasAms) await db.update(printers).set({ hasAms: true }).where(eq(printers.id, printer.id));
	}

	// ── Drive the active job on completion ─────────────────────────────────────────
	if (print.gcode_state === 'FINISH' && printer.currentJobId) {
		await completeJob(printer.currentJobId);
	}
}
