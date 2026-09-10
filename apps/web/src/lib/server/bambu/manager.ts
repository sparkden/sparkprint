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
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { bambuAccounts, printers } from '../db/schema';
import { BAMBU_MODE, REGIONS, region as normRegion } from './config';
import { applyReport } from './report';
import { decrypt } from '../crypto';

type Conn = { client: MqttClient; accountId: string; region: string; authFailed?: boolean };

const g = globalThis as unknown as { __sparkBambu?: BambuManager };

class BambuManager {
	private conns = new Map<string, Conn>();
	private started = false;
	private seq = 20000 + Math.floor((Date.now() % 9000));

	nextSeq() {
		this.seq = this.seq >= 29999 ? 20000 : this.seq + 1;
		return String(this.seq);
	}

	/** Connect all currently-connected accounts. Safe to call repeatedly. */
	async ensureStarted() {
		if (BAMBU_MODE !== 'cloud' || this.started) return;
		this.started = true;
		const accounts = await db.select().from(bambuAccounts).where(eq(bambuAccounts.status, 'connected'));
		for (const a of accounts) this.connectAccount(a.id).catch((e) => console.error('[bambu] connect', e));
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

	/** Publish a raw command to a printer (looked up by our printer id). */
	async command(printerId: string, payload: Record<string, unknown>, qos: 0 | 1 = 0): Promise<boolean> {
		const [p] = await db.select().from(printers).where(eq(printers.id, printerId)).limit(1);
		if (!p?.bambuAccountId) return false;
		const conn = this.conns.get(p.bambuAccountId);
		if (!conn || !conn.client.connected) return false;
		conn.client.publish(`device/${p.devId}/request`, JSON.stringify(payload), { qos });
		return true;
	}

	pause(printerId: string) {
		return this.command(printerId, { print: { sequence_id: this.nextSeq(), command: 'pause' } }, 1);
	}
	resume(printerId: string) {
		return this.command(printerId, { print: { sequence_id: this.nextSeq(), command: 'resume' } }, 1);
	}
	stop(printerId: string) {
		return this.command(printerId, { print: { sequence_id: this.nextSeq(), command: 'stop' } }, 1);
	}

	isConnected(accountId: string) {
		return !!this.conns.get(accountId)?.client.connected;
	}
}

export function manager(): BambuManager {
	if (!g.__sparkBambu) g.__sparkBambu = new BambuManager();
	return g.__sparkBambu;
}
