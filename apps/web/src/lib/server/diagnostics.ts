/**
 * System + printer diagnostics for the admin "Diagnostics" page. Runs live network probes and DB
 * checks and returns a plain, actionable report (pass / warn / fail + a fix hint).
 */
import net from 'node:net';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { printers, amsUnits, amsSlots } from './db/schema';
import { manager } from './bambu/manager';
import { cameraTransport } from './bambu/camera';
import { orcaAvailable } from './orca';
import { putBuffer, removeObject } from './storage';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type Check = { name: string; status: CheckStatus; detail: string; fix?: string };
export type PrinterReport = { id: string; name: string; model: string; ip: string | null; status: CheckStatus; checks: Check[] };
export type Diagnostics = { system: Check[]; printers: PrinterReport[]; generatedAt: string };

/** TCP connect test with a short timeout. Returns 'OPEN' or an error code. */
function probe(host: string, port: number, timeout = 3000): Promise<string> {
	return new Promise((resolve) => {
		const s = net.connect({ host, port, timeout });
		s.on('connect', () => { s.destroy(); resolve('OPEN'); });
		s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code || 'ERR'));
		s.on('timeout', () => { s.destroy(); resolve('TIMEOUT'); });
	});
}

function parseBytes(v: string | undefined): number | null {
	if (!v) return null;
	const m = /^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i.exec(v.trim());
	if (!m) return Number(v) || null;
	const n = parseFloat(m[1]);
	const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2].toUpperCase()] ?? 1;
	return Math.round(n * mult);
}

async function systemChecks(): Promise<Check[]> {
	const out: Check[] = [];

	// Slicer
	const orca = await orcaAvailable();
	out.push(
		orca
			? { name: 'Slicer (OrcaSlicer)', status: 'pass', detail: 'OrcaSlicer is available — real Bambu G-code + sliced previews.' }
			: { name: 'Slicer (OrcaSlicer)', status: 'warn', detail: 'OrcaSlicer not available; using the Slic3r/size fallback (no sliced preview).', fix: 'Re-run install.sh on Raspberry Pi OS Trixie (64-bit) to install OrcaSlicer headless.' }
	);

	// Upload limit
	const limit = parseBytes(env.BODY_SIZE_LIMIT);
	if (!limit || limit < 20 * 1e6) {
		out.push({ name: 'Upload size limit', status: 'fail', detail: `BODY_SIZE_LIMIT is ${limit ? Math.round(limit / 1e6) + ' MB' : 'unset (512 KB default)'} — models will be rejected.`, fix: 'Set BODY_SIZE_LIMIT="268435456" in apps/web/.env and restart.' });
	} else {
		out.push({ name: 'Upload size limit', status: 'pass', detail: `${Math.round(limit / 1e6)} MB` });
	}

	// Storage writable
	try {
		const key = `org/_diag/${Date.now()}.txt`;
		await putBuffer(key, Buffer.from('ok'));
		await removeObject(key);
		out.push({ name: 'File storage', status: 'pass', detail: 'Writable.' });
	} catch (e) {
		out.push({ name: 'File storage', status: 'fail', detail: `Not writable: ${(e as Error).message}`, fix: 'Check STORAGE_DIR permissions (should be owned by the sparkprint user).' });
	}

	// Public exposure note
	if (env.ORIGIN && env.ORIGIN.trim()) {
		out.push({ name: 'Public access', status: 'warn', detail: `Published at ${env.ORIGIN}. Admin pages (terminal, this) are reachable from the internet.`, fix: 'Use a strong admin password; consider LAN-only for admin.' });
	}

	return out;
}

async function printerReport(p: typeof printers.$inferSelect): Promise<PrinterReport> {
	const checks: Check[] = [];

	// Config
	if (!p.ipAddress || !p.accessCode) {
		checks.push({ name: 'LAN configured', status: 'fail', detail: `${!p.ipAddress ? 'No IP address' : 'No access code'} set.`, fix: 'Admin → Printers → set the Local IP + LAN access code (from the printer’s screen).' });
	} else {
		checks.push({ name: 'LAN configured', status: 'pass', detail: `${p.ipAddress} · access code set` });
	}

	// Ports
	if (p.ipAddress) {
		const mqtt = await probe(p.ipAddress, 8883);
		const camPort = cameraTransport(p.model) === 'chamber' ? 6000 : 322;
		const cam = await probe(p.ipAddress, camPort);
		checks.push(
			mqtt === 'OPEN'
				? { name: 'MQTT control (8883)', status: 'pass', detail: 'Reachable.' }
				: { name: 'MQTT control (8883)', status: 'fail', detail: `Not reachable (${mqtt}).`, fix: cam === 'OPEN' ? 'Camera works but 8883 is closed → enable LAN Mode on the printer (turns on the local MQTT broker).' : 'Wrong/stale IP, printer off, or different network. Verify the IP and that the Pi can reach it.' }
		);
		checks.push(
			cam === 'OPEN'
				? { name: `Camera (${camPort})`, status: 'pass', detail: 'Reachable.' }
				: { name: `Camera (${camPort})`, status: 'warn', detail: `Not reachable (${cam}).`, fix: 'Camera only — not required for printing.' }
		);
	}

	// Live link + telemetry
	const live = manager().isConnected(p.id);
	checks.push(
		live
			? { name: 'Live connection', status: 'pass', detail: 'Connected over MQTT.' }
			: { name: 'Live connection', status: p.ipAddress && p.accessCode ? 'warn' : 'fail', detail: 'Not currently connected.', fix: 'If the port test above passes, check the access code is correct and the printer is in LAN Mode.' }
	);

	// Status
	const seenMin = p.lastSeenAt ? Math.round((Date.now() - new Date(p.lastSeenAt).getTime()) / 60000) : null;
	checks.push({
		name: 'Reported status',
		status: p.status === 'idle' ? 'pass' : p.status === 'printing' || p.status === 'paused' ? 'warn' : 'warn',
		detail: `${p.status}${seenMin != null ? ` · last seen ${seenMin}m ago` : ' · never reported'}` + (p.status === 'finished' ? ' (needs checkout before reuse)' : '')
	});

	// Colors loaded
	const slots = await db
		.select({ empty: amsSlots.empty, colorHex: amsSlots.colorHex, filamentType: amsSlots.filamentType })
		.from(amsSlots)
		.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
		.where(eq(amsSlots.printerId, p.id));
	const loaded = slots.filter((s) => !s.empty && s.colorHex);
	checks.push(
		loaded.length
			? { name: 'Filament loaded', status: 'pass', detail: `${loaded.length} slot(s): ${loaded.map((s) => `${s.colorHex} ${s.filamentType}`).join(', ')}` }
			: { name: 'Filament loaded', status: 'warn', detail: 'No colors detected in the AMS.', fix: 'Load filament and hit "Reload AMS" (or wait for the next report).' }
	);

	// Overall printer verdict = worst check.
	const worst: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
	// A printer that's connected + idle + has color is genuinely ready → surface as pass even if the
	// camera is just a warn.
	const ready = live && p.status === 'idle' && loaded.length > 0 && !!p.ipAddress && !!p.accessCode;
	return { id: p.id, name: p.name, model: p.model, ip: p.ipAddress, status: ready ? 'pass' : worst, checks };
}

export async function runDiagnostics(orgId: string): Promise<Diagnostics> {
	const [system, rows] = await Promise.all([
		systemChecks(),
		db.select().from(printers).where(and(eq(printers.orgId, orgId), eq(printers.enabled, true)))
	]);
	const printerReports = await Promise.all(rows.map(printerReport));
	return { system, printers: printerReports, generatedAt: new Date().toISOString() };
}
