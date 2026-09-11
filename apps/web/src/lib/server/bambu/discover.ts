/**
 * Discover Bambu printers on the local network via SSDP. Printers periodically broadcast an
 * SSDP NOTIFY to 239.255.255.250 (UDP 1990 and 2021) carrying their serial (USN) and IP
 * (Location). We listen passively for a few seconds and also send an M-SEARCH to prompt replies.
 *
 * Only works when the server is on the SAME network segment as the printers (see docs/LAN.md).
 */
import { createSocket, type Socket } from 'node:dgram';

export type Discovered = { serial: string; ip: string; name?: string; model?: string };

const MCAST = '239.255.255.250';
const PORTS = [2021, 1990];

function parse(msg: string, rinfo: { address: string }): Discovered | null {
	// Header lines are "Key: value" (some Bambu keys carry a ".bambu.com" suffix).
	const h: Record<string, string> = {};
	for (const line of msg.split(/\r?\n/)) {
		const i = line.indexOf(':');
		if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
	}
	const serial = h['usn'] || h['usn.bambu.com'];
	if (!serial) return null;
	const ip = h['location'] || h['ip'] || rinfo.address;
	return {
		serial: serial.trim(),
		ip: ip.replace(/^https?:\/\//, '').split(/[:/]/)[0],
		name: h['devname.bambu.com'] || h['devname'],
		model: h['devmodel.bambu.com'] || h['devmodel']
	};
}

export async function discoverPrinters(timeoutMs = 4000): Promise<Discovered[]> {
	const found = new Map<string, Discovered>();
	const sockets: Socket[] = [];

	await Promise.all(
		PORTS.map(
			(port) =>
				new Promise<void>((resolve) => {
					const sock = createSocket({ type: 'udp4', reuseAddr: true });
					sockets.push(sock);
					sock.on('message', (buf, rinfo) => {
						const d = parse(buf.toString('utf8'), rinfo);
						if (d?.serial && d.ip) found.set(d.serial, { ...found.get(d.serial), ...d });
					});
					sock.on('error', () => resolve());
					sock.bind(port, () => {
						try {
							sock.addMembership(MCAST);
						} catch {
							/* membership may fail on some hosts; passive unicast still works */
						}
						// Prompt printers to announce themselves.
						const msearch = `M-SEARCH * HTTP/1.1\r\nHOST: ${MCAST}:${port}\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n`;
						try {
							sock.send(Buffer.from(msearch), port, MCAST);
						} catch {
							/* ignore */
						}
						resolve();
					});
				})
		)
	);

	await new Promise((r) => setTimeout(r, timeoutMs));
	for (const s of sockets) {
		try {
			s.close();
		} catch {
			/* noop */
		}
	}
	return [...found.values()];
}
