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

/** Upload the 3mf to the printer's FTP root over implicit FTPS (port 990). */
export async function ftpsUpload(ip: string, accessCode: string, data: Buffer, remoteName: string): Promise<void> {
	const client = new FtpClient(20000);
	try {
		await client.access({
			host: ip,
			port: 990,
			user: 'bblp',
			password: accessCode,
			secure: 'implicit',
			secureOptions: { rejectUnauthorized: false } // printer uses a self-signed cert
		});
		await client.uploadFrom(Readable.from(data), remoteName);
	} finally {
		client.close();
	}
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
