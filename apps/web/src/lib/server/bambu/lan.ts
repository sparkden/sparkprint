/**
 * LAN printing — the open, reliable path (exactly OrcaSlicer's LAN flow): upload the sliced
 * `.gcode.3mf` to the printer over implicit FTPS, then publish an MQTT `project_file` command so
 * the printer prints it from its own storage. No Bambu cloud file-hosting involved, so it works
 * for every model (including combo machines like the H2C) and needs no developer mode — just the
 * printer's LAN access code and local IP.
 *
 * Requires the LataPrint server to be on the SAME network as the printers (see docs/LAN.md).
 *
 * Refs: Doridian/OpenBambuAPI (ftp.md, mqtt.md), bambulabs_api. FTPS: ftps://<ip>:990 implicit,
 * user "bblp", pass <access code>. Print command url = "ftp:///<filename>" (file at the FTP root).
 */
import { connect } from 'mqtt';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'node:stream';

export type LanPrintParams = {
	ip: string;
	accessCode: string;
	serial: string; // Bambu device serial (dev_id)
	data: Buffer; // the .gcode.3mf bytes
	fileName: string; // e.g. "job_abc.gcode.3mf" (lives at the FTP root)
	amsMapping: number[];
	useAms: boolean;
	bedType?: string; // e.g. "textured_plate"
	plateIdx?: number;
};

function ftpAccess(client: FtpClient, ip: string, accessCode: string) {
	return client.access({
		host: ip,
		port: 990,
		user: 'bblp',
		password: accessCode,
		secure: 'implicit',
		secureOptions: { rejectUnauthorized: false } // printer uses a self-signed cert
	});
}

/** Check whether the uploaded file actually landed (fresh connection). 'ok' = present at the right
 *  size; 'missing' = definitely not there (or wrong size); 'unknown' = couldn't check (printer
 *  dropped the connection, which Bambu does routinely). */
async function ftpsCheck(ip: string, accessCode: string, remoteName: string, expected: number): Promise<'ok' | 'missing' | 'unknown'> {
	const client = new FtpClient(15000);
	try {
		await ftpAccess(client, ip, accessCode);
		const size = await client.size(remoteName);
		return size === expected ? 'ok' : 'missing';
	} catch (e) {
		const m = String((e as Error)?.message ?? e);
		return /550|not found|no such|does not exist/i.test(m) ? 'missing' : 'unknown';
	} finally {
		client.close();
	}
}

/**
 * Upload the 3mf to the printer's FTP root over implicit FTPS (port 990). Bambu printers routinely
 * drop the control connection right as the transfer completes ("Connection closed") even though the
 * file uploaded fine — so we retry, and after any error we verify the file's size on a fresh
 * connection before deciding it really failed.
 */
export async function ftpsUpload(ip: string, accessCode: string, data: Buffer, remoteName: string): Promise<void> {
	let lastErr: unknown;
	let lastCheck: 'ok' | 'missing' | 'unknown' = 'unknown';
	for (let attempt = 1; attempt <= 3; attempt++) {
		const client = new FtpClient(30000);
		try {
			await ftpAccess(client, ip, accessCode);
			await client.remove(remoteName).catch(() => {}); // clear a stale/locked leftover first
			await client.uploadFrom(Readable.from(data), remoteName);
			client.close();
			return; // clean success
		} catch (e) {
			lastErr = e;
			client.close();
			const m = String((e as Error)?.message ?? e);
			if (/\b530\b|not logged|login/i.test(m)) throw new Error('printer rejected the login — check the LAN access code.');
			// Did the file actually land? Bambu drops the control connection at end-of-transfer, so a
			// "closed" error with a confirmed file is success; a confirmed-missing file is a real
			// failure (retry); if we can't check, only trust a late close.
			lastCheck = await ftpsCheck(ip, accessCode, remoteName, data.length);
			if (lastCheck === 'ok') return;
			if (lastCheck === 'unknown' && /clos|reset|epipe|econnaborted|aborted/i.test(m) && !/\b550\b/.test(m)) return;
			await new Promise((r) => setTimeout(r, 800 * attempt));
		}
	}
	const msg = String((lastErr as Error)?.message ?? lastErr);
	// The file never landed → almost always no/failed storage on the printer.
	if (lastCheck === 'missing' || /\b550\b/.test(msg)) {
		throw new Error("the printer couldn't store the print file — insert a working microSD card (P1/A1 need one for LAN prints) and make sure it isn't full, then resubmit.");
	}
	throw new Error(`upload failed after 3 tries: ${msg}`);
}

/** Publish the `project_file` print command over the printer's local MQTT (port 8883). */
function lanCommand(params: LanPrintParams): Promise<void> {
	return new Promise((resolve, reject) => {
		const client = connect(`mqtts://${params.ip}:8883`, {
			username: 'bblp',
			password: params.accessCode,
			protocolVersion: 4,
			rejectUnauthorized: false, // printer self-signed cert
			connectTimeout: 15000,
			reconnectPeriod: 0,
			clientId: `sparkprint_lan_${Math.floor(Math.random() * 1e6)}`
		});
		let published = false;
		let settled = false;
		const done = (err?: Error) => {
			if (settled) return;
			settled = true;
			try {
				client.end(true);
			} catch {
				/* noop */
			}
			err ? reject(err) : resolve();
		};
		const to = setTimeout(() => done(new Error('printer MQTT timed out')), 20000);
		client.on('connect', () => {
			const subtask = params.fileName.replace(/\.gcode\.3mf$/i, '');
			const cmd = {
				print: {
					command: 'project_file',
					sequence_id: String(Date.now() % 1e7),
					param: `Metadata/plate_${params.plateIdx ?? 1}.gcode`,
					// These id/name fields are required by P1 firmware to actually start the job — without
					// them the command is silently ignored (the file uploads but nothing prints).
					project_id: '0',
					profile_id: '0',
					task_id: '0',
					subtask_id: '0',
					subtask_name: subtask,
					file: params.fileName,
					url: `ftp:///${params.fileName}`, // file at the FTP root
					md5: '',
					bed_type: params.bedType ?? 'auto',
					bed_leveling: true,
					flow_cali: false,
					vibration_cali: true,
					layer_inspect: false,
					timelapse: false,
					use_ams: params.useAms,
					ams_mapping: params.useAms ? params.amsMapping : [0]
				}
			};
			// qos 1 so the command is actually delivered before we close (a force-closed qos-0 publish
			// can be dropped before it reaches the printer → "Sent" but nothing prints). The published
			// flag below still treats a drop AFTER delivery as success, so no false error either.
			client.publish(`device/${params.serial}/request`, JSON.stringify(cmd), { qos: 1 }, (err) => {
				published = true;
				clearTimeout(to);
				done(err ?? undefined);
			});
		});
		// Once the command has been sent, a subsequent drop is fine — the printer has it. Only a
		// failure BEFORE we publish is a real error.
		client.on('error', (err) => { clearTimeout(to); published ? done() : done(err instanceof Error ? err : new Error(String(err))); });
		client.on('close', () => { if (published) done(); });
	});
}

/** Upload + start a LAN print. Throws on any failure (caller logs it to the job timeline). */
export async function lanPrint(params: LanPrintParams): Promise<void> {
	await ftpsUpload(params.ip, params.accessCode, params.data, params.fileName);
	await lanCommand(params);
}
