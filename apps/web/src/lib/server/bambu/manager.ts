/**
 * Local (LAN) MQTT manager — one persistent connection per printer, over the local network.
 * Runs inside the adapter-node server process.
 *
 * - Connects to each printer that has a LAN IP + access code (mqtts://<ip>:8883, user "bblp").
 * - Subscribes to `device/<serial>/report` and writes telemetry (status, AMS, colors) → DB.
 * - Publishes control commands (reload AMS, unload/load, pause/resume/stop) to `.../request`.
 *
 * A globalThis singleton survives dev HMR so we don't open duplicate connections.
 */
import type { MqttClient } from 'mqtt';
import { connect } from 'mqtt';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { printers } from '../db/schema';
import { applyReportByDevId } from './report';

type LanConn = { client: MqttClient; printerId: string; devId: string };

const g = globalThis as unknown as { __sparkBambu?: BambuManager };

class BambuManager {
	private lanConns = new Map<string, LanConn>(); // per printer
	private started = false;
	private seq = 20000 + Math.floor((Date.now() % 9000));

	nextSeq() {
		this.seq = this.seq >= 29999 ? 20000 : this.seq + 1;
		return String(this.seq);
	}

	/** Connect every printer that has LAN details. Safe to call repeatedly. */
	async ensureStarted() {
		if (this.started) return;
		this.started = true;
		await this.ensureLanConnections();
	}

	async ensureLanConnections() {
		const rows = await db
			.select()
			.from(printers)
			.where(and(isNotNull(printers.ipAddress), isNotNull(printers.accessCode)));
		for (const p of rows) this.connectLanPrinter(p.id).catch((e) => console.error('[bambu-lan] connect', e));
	}

	/** Connect (or reconnect) a single printer over its local network. */
	async connectLanPrinter(printerId: string) {
		const [p] = await db.select().from(printers).where(eq(printers.id, printerId)).limit(1);
		if (!p?.ipAddress || !p.accessCode) return;
		this.disconnectLanPrinter(printerId); // fresh connection if IP/code changed
		const client = connect(`mqtts://${p.ipAddress}:8883`, {
			username: 'bblp',
			password: p.accessCode,
			protocolVersion: 4,
			keepalive: 30,
			clean: true,
			reconnectPeriod: 5000,
			connectTimeout: 15000,
			rejectUnauthorized: false, // printer self-signed cert
			clientId: `sparkprint_lan_${printerId.slice(-8)}_${Math.floor(Math.random() * 1e6)}`
		});
		this.lanConns.set(printerId, { client, printerId, devId: p.devId });
		// Only touch the DB if this is still the live connection for the printer (guards against a
		// replaced/old client firing late events).
		const isActive = () => this.lanConns.get(printerId)?.client === client;
		const setOnline = (on: boolean) => {
			if (!isActive()) return;
			// On disconnect we clear `online` but leave `status` (don't clobber a 'printing' state on a
			// brief blip); dispatch already skips any printer that isn't online.
			db.update(printers).set({ online: on, updatedAt: new Date() }).where(eq(printers.id, printerId)).catch(() => {});
		};
		let lastErrLog = 0;
		client.on('connect', () => {
			client.subscribe(`device/${p.devId}/report`, { qos: 0 });
			// Ask for a full snapshot (status, AMS, colors).
			client.publish(`device/${p.devId}/request`, JSON.stringify({ pushing: { sequence_id: this.nextSeq(), command: 'pushall', version: 1, push_target: 1 } }), { qos: 0 });
			setOnline(true);
			console.log(`[bambu-lan] ${p.name}: connected`);
		});
		client.on('message', async (_topic, payload) => {
			try {
				const json = JSON.parse(payload.toString());
				if (json?.print) await applyReportByDevId(p.devId, json.print);
			} catch {
				/* ignore malformed */
			}
		});
		// A dropped/failed link means the printer is no longer reachable — reflect that truthfully.
		client.on('offline', () => setOnline(false));
		client.on('close', () => setOnline(false));
		client.on('error', (err: unknown) => {
			setOnline(false);
			const now = Date.now();
			if (now - lastErrLog > 60000) { // throttle: the reconnect loop can fire every few seconds
				lastErrLog = now;
				console.error(`[bambu-lan] ${p.name}: ${(err as Error)?.message} (will keep retrying)`);
			}
		});
	}

	disconnectLanPrinter(printerId: string) {
		const conn = this.lanConns.get(printerId);
		if (conn) {
			try {
				conn.client.end(true);
			} catch {
				/* noop */
			}
			this.lanConns.delete(printerId);
		}
	}

	/** Is the printer's local MQTT link currently up? */
	isConnected(printerId: string) {
		return !!this.lanConns.get(printerId)?.client.connected;
	}

	/** Publish a raw command to a printer over its local connection. */
	async command(printerId: string, payload: Record<string, unknown>, qos: 0 | 1 = 0): Promise<boolean> {
		const conn = this.lanConns.get(printerId);
		if (!conn?.client.connected) return false;
		conn.client.publish(`device/${conn.devId}/request`, JSON.stringify(payload), { qos });
		return true;
	}

	/** Ask a printer to push its full status (incl. AMS) — used by the "Reload AMS" button. */
	requestStatus(printerId: string) {
		return this.command(printerId, { pushing: { sequence_id: this.nextSeq(), command: 'pushall', version: 1, push_target: 1 } }, 0);
	}
	/**
	 * Unload the currently-loaded filament (target 255), as Bambu Studio's command_ams_change_filament
	 * does — with the classic (target/curr_temp/tar_temp) and new-protocol (ams_id/slot_id 255) fields
	 * so it works on both firmwares. Requires the printer idle with filament loaded; if it stalls
	 * mid-way, call amsControl(printerId, 'resume').
	 */
	unloadFilament(printerId: string) {
		return this.command(
			printerId,
			{ print: { command: 'ams_change_filament', sequence_id: this.nextSeq(), target: 255, ams_id: 255, slot_id: 255, curr_temp: 210, tar_temp: 210 } },
			1
		);
	}
	/** Guide an in-progress AMS change: 'resume' | 'done' | 'reset' | 'pause'. */
	amsControl(printerId: string, action: 'resume' | 'done' | 'reset' | 'pause') {
		return this.command(printerId, { print: { command: 'ams_control', sequence_id: this.nextSeq(), param: action } }, 1);
	}
	pause(printerId: string) {
		return this.command(printerId, { print: { command: 'pause', param: '', sequence_id: this.nextSeq() } }, 1);
	}
	resume(printerId: string) {
		return this.command(printerId, { print: { command: 'resume', param: '', sequence_id: this.nextSeq() } }, 1);
	}
	stop(printerId: string) {
		return this.command(printerId, { print: { command: 'stop', param: '', sequence_id: this.nextSeq() } }, 1);
	}
}

export function manager(): BambuManager {
	if (!g.__sparkBambu) g.__sparkBambu = new BambuManager();
	return g.__sparkBambu;
}
