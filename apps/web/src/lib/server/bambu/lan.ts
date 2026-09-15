/**
 * LAN printing — the open, reliable path (exactly OrcaSlicer's LAN flow): upload the sliced
 * `.gcode.3mf` to the printer over implicit FTPS, then publish an MQTT `project_file` command so
 * the printer prints it from its own storage. No Bambu cloud file-hosting involved, so it works
 * for every model (including combo machines like the H2C) and needs no developer mode — just the
 * printer's LAN access code and local IP.
 *
 * Requires the SparkPrint server to be on the SAME network as the printers (see docs/LAN.md).
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

/** Does the file already exist on the printer at the expected size? (fresh connection) */
async function ftpsVerify(ip: string, accessCode: string, remoteName: string, expected: number): Promise<boolean> {
	const client = new FtpClient(15000);
	try {
		await ftpAccess(client, ip, accessCode);
		const size = await client.size(remoteName);
		return size === expected;
	} catch {
		return false;
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
	for (let attempt = 1; attempt <= 3; attempt++) {
		const client = new FtpClient(30000);
		try {
			await ftpAccess(client, ip, accessCode);
			await client.uploadFrom(Readable.from(data), remoteName);
			client.close();
			return; // clean success
		} catch (e) {
			lastErr = e;
			client.close();
			// The transfer may have finished before the drop — check the uploaded size.
			if (await ftpsVerify(ip, accessCode, remoteName, data.length)) return;
			await new Promise((r) => setTimeout(r, 800 * attempt));
		}
	}
	throw new Error(`FTPS upload failed after 3 tries: ${(lastErr as Error)?.message ?? lastErr}`);
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
		const done = (err?: Error) => {
			try {
				client.end(true);
			} catch {
				/* noop */
			}
			err ? reject(err) : resolve();
		};
		const to = setTimeout(() => done(new Error('printer MQTT timed out')), 20000);
		client.on('connect', () => {
			const cmd = {
				print: {
					command: 'project_file',
					sequence_id: String(Date.now() % 1e7),
					param: `Metadata/plate_${params.plateIdx ?? 1}.gcode`,
					file: params.fileName,
					url: `ftp:///${params.fileName}`, // file at the FTP root
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
			client.publish(`device/${params.serial}/request`, JSON.stringify(cmd), { qos: 1 }, (err) => {
				clearTimeout(to);
				done(err ?? undefined);
			});
		});
		client.on('error', (err) => {
			clearTimeout(to);
			done(err instanceof Error ? err : new Error(String(err)));
		});
	});
}

/** Upload + start a LAN print. Throws on any failure (caller logs it to the job timeline). */
export async function lanPrint(params: LanPrintParams): Promise<void> {
	await ftpsUpload(params.ip, params.accessCode, params.data, params.fileName);
	await lanCommand(params);
}
