/**
 * Central Bambu cloud MQTT manager (runs inside the adapter-node server process).
 *
 * - Holds exactly ONE persistent MQTT connection per connected Bambu account
 *   (Bambu bans >50 concurrent connections/account — never churn).
 * - Subscribes to every bound printer's `report` topic, writes telemetry → DB.
 * - Publishes control commands (pause/resume/stop) to the `request` topic.
 *
 * Only active when BAMBU_MODE=cloud. A globalThis singleton survives dev HMR so we don't
 * open duplicate connections.
 */
import type { MqttClient } from 'mqtt';
import { connect } from 'mqtt';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { bambuAccounts, printers } from '../db/schema';
import { BAMBU_MODE, REGIONS, region as normRegion } from './config';
import { applyReport, applyReportByDevId } from './report';
import { decrypt } from '../crypto';

type Conn = { client: MqttClient; accountId: string; region: string; authFailed?: boolean };
type LanConn = { client: MqttClient; printerId: string; devId: string };

const g = globalThis as unknown as { __sparkBambu?: BambuManager };

class BambuManager {
	private conns = new Map<string, Conn>(); // per Bambu cloud account
	private lanConns = new Map<string, LanConn>(); // per printer (local network)
	private started = false;
	private seq = 20000 + Math.floor((Date.now() % 9000));

	nextSeq() {
		this.seq = this.seq >= 29999 ? 20000 : this.seq + 1;
		return String(this.seq);
	}

	/** Connect LAN printers (preferred) and any cloud accounts. Safe to call repeatedly. */
	async ensureStarted() {
		if (this.started) return;
		this.started = true;
		await this.ensureLanConnections();
		if (BAMBU_MODE === 'cloud') {
			const accounts = await db.select().from(bambuAccounts).where(eq(bambuAccounts.status, 'connected'));
			for (const a of accounts) this.connectAccount(a.id).catch((e) => console.error('[bambu] connect', e));
		}
	}

	/** Open a local MQTT connection to every printer that has a LAN IP + access code. */
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
		// Reconnect fresh if the IP/code changed.
		this.disconnectLanPrinter(printerId);
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
		const conn: LanConn = { client, printerId, devId: p.devId };
		this.lanConns.set(printerId, conn);
		client.on('connect', () => {
			client.subscribe(`device/${p.devId}/report`, { qos: 0 });
			// Ask for a full snapshot (status, AMS, colors).
			client.publish(`device/${p.devId}/request`, JSON.stringify({ pushing: { sequence_id: this.nextSeq(), command: 'pushall', version: 1, push_target: 1 } }), { qos: 0 });
			db.update(printers).set({ online: true, updatedAt: new Date() }).where(eq(printers.id, printerId)).catch(() => {});
		});
		client.on('message', async (_topic, payload) => {
			try {
				const json = JSON.parse(payload.toString());
				if (json?.print) await applyReportByDevId(p.devId, json.print);
			} catch {
				/* ignore malformed */
			}
		});
		client.on('error', (err: unknown) => console.error(`[bambu-lan] ${p.name}:`, (err as Error)?.message));
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

	async connectAccount(accountId: string) {
		if (BAMBU_MODE !== 'cloud') return;
		if (this.conns.has(accountId)) return; // one connection per account
		const [acct] = await db.select().from(bambuAccounts).where(eq(bambuAccounts.id, accountId)).limit(1);
		if (!acct || !acct.accessToken || !acct.bambuUserId) return;
		const token = decrypt(acct.accessToken);
		if (!token) return;

		const reg = normRegion(acct.region);
		const url = REGIONS[reg].mqtt;
		const client = connect(url, {
			username: acct.bambuUserId, // u_<uid>
			password: token,
			protocolVersion: 4,
			keepalive: 30,
			clean: true,
			reconnectPeriod: 5000,
			connectTimeout: 20000,
			rejectUnauthorized: true,
			clientId: `sparkprint_${acct.id.slice(-8)}_${Math.floor(Math.random() * 1e6)}`
		});
		const conn: Conn = { client, accountId, region: acct.region };
		this.conns.set(accountId, conn);

		client.on('connect', async () => {
			console.log(`[bambu] connected account ${acct.email}`);
			await db.update(bambuAccounts).set({ status: 'connected', lastSyncedAt: new Date() }).where(eq(bambuAccounts.id, accountId));
			const devs = await db.select({ devId: printers.devId }).from(printers).where(eq(printers.bambuAccountId, accountId));
			for (const d of devs) {
				client.subscribe(`device/${d.devId}/report`, { qos: 0 });
				// Ask for a full snapshot.
				client.publish(`device/${d.devId}/request`, JSON.stringify({ pushing: { sequence_id: this.nextSeq(), command: 'pushall', version: 1, push_target: 1 } }), { qos: 0 });
			}
		});

		client.on('message', async (topic, payload) => {
			try {
				const devId = topic.split('/')[1];
				const json = JSON.parse(payload.toString());
				if (json?.print) await applyReport(accountId, devId, json.print);
			} catch (e) {
				/* ignore malformed */
			}
		});

		client.on('error', async (err: any) => {
			// Return code 5 / "Not authorized" → token rejected; stop reconnecting.
			const notAuth = err?.code === 5 || /not authorized|bad user|refused/i.test(String(err?.message));
			if (notAuth) {
				conn.authFailed = true;
				console.error(`[bambu] auth rejected for ${acct.email}; marking expired`);
				await db.update(bambuAccounts).set({ status: 'expired' }).where(eq(bambuAccounts.id, accountId));
				this.disconnectAccount(accountId);
			} else {
				console.error(`[bambu] mqtt error (${acct.email}):`, err?.message);
			}
		});

		client.on('close', () => {
			// mark printers offline-ish only if we are not going to reconnect
			if (conn.authFailed) {
				db.update(printers).set({ online: false, updatedAt: new Date() }).where(eq(printers.bambuAccountId, accountId)).catch(() => {});
			}
		});
	}

	disconnectAccount(accountId: string) {
		const conn = this.conns.get(accountId);
		if (conn) {
			try {
				conn.client.end(true);
			} catch {
				/* noop */
			}
			this.conns.delete(accountId);
		}
	}

	/** Publish a raw command to a printer — prefers the local (LAN) connection, falls back to cloud. */
	async command(printerId: string, payload: Record<string, unknown>, qos: 0 | 1 = 0): Promise<boolean> {
		const [p] = await db.select().from(printers).where(eq(printers.id, printerId)).limit(1);
		if (!p) return false;
		const lan = this.lanConns.get(printerId);
		if (lan?.client.connected) {
			lan.client.publish(`device/${p.devId}/request`, JSON.stringify(payload), { qos });
			return true;
		}
		if (p.bambuAccountId) {
			const conn = this.conns.get(p.bambuAccountId);
			if (conn?.client.connected) {
				conn.client.publish(`device/${p.devId}/request`, JSON.stringify(payload), { qos });
				return true;
			}
		}
		return false;
	}

	/**
	 * Start a cloud/URL print, exactly as BambuStudio's `command_project_file` does: the printer
	 * downloads the 3mf from `url`, verifies it against `md5`, and prints the plate's gcode
	 * (`param` = the gcode path inside the 3mf). Creating a /my/task record alone does NOT start a
	 * print — this MQTT command is what actually kicks it off.
	 */
	printProjectFile(
		printerId: string,
		p: {
			url: string;
			md5: string;
			subtaskName: string;
			amsMapping: number[];
			bedType?: string;
			taskId?: string;
			projectId?: string;
			profileId?: string;
			plateIdx?: number;
		}
	) {
		const useAms = p.amsMapping.length > 0;
		return this.command(
			printerId,
			{
				print: {
					command: 'project_file',
					sequence_id: this.nextSeq(),
					param: `Metadata/plate_${p.plateIdx ?? 1}.gcode`,
					url: p.url,
					md5: p.md5,
					subtask_name: p.subtaskName,
					project_id: p.projectId ?? '0',
					profile_id: p.profileId ?? '0',
					task_id: p.taskId ?? '0',
					subtask_id: '0',
					bed_type: p.bedType ?? 'auto',
					use_ams: useAms,
					ams_mapping: useAms ? p.amsMapping : [0],
					timelapse: false,
					bed_leveling: true,
					flow_cali: false,
					vibration_cali: true,
					layer_inspect: false
				}
			},
			1
		);
	}
	/** Ask a printer to push its full status (incl. AMS) — used by the "Reload AMS" button. */
	requestStatus(printerId: string) {
		return this.command(printerId, { pushing: { sequence_id: this.nextSeq(), command: 'pushall', version: 1, push_target: 1 } }, 0);
	}
	/**
	 * Unload the currently-loaded filament (target 255), exactly as BambuStudio's
	 * command_ams_change_filament does — with the classic (target/curr_temp/tar_temp) and
	 * new-protocol (ams_id/slot_id 255) fields so it works on both firmwares. The printer
	 * heats to tar_temp itself; no separate heat command. Requires the printer idle with
	 * filament loaded. If it stalls mid-way, call amsControl(printerId, 'resume').
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

	isConnected(accountId: string) {
		return !!this.conns.get(accountId)?.client.connected;
	}
}

export function manager(): BambuManager {
	if (!g.__sparkBambu) g.__sparkBambu = new BambuManager();
	return g.__sparkBambu;
}
