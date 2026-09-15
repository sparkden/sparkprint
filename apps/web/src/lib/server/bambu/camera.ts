/**
 * Live printer camera → browser MJPEG. Two Bambu camera transports:
 *   • P1P / P1S / A1 / A1 mini — proprietary "chamber image" JPEG stream on TLS port 6000.
 *   • X1 / X1C / X1E / H2D / H2C — RTSPS on port 322 (needs ffmpeg to transcode to MJPEG).
 *
 * Both authenticate with user "bblp" + the LAN access code, and require **LAN Live View** enabled
 * on the printer. We expose a `multipart/x-mixed-replace` MJPEG stream an <img> can render.
 * Refs: greghesp/ha-bambulab (chamber_image), Bambu rtsps://bblp:<code>@<ip>:322/streaming/live/1.
 */
import { connect as tlsConnect } from 'node:tls';
import { spawn } from 'node:child_process';

export const MJPEG_BOUNDARY = 'sparkframe';
export const MJPEG_CONTENT_TYPE = `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`;

export function cameraTransport(model: string): 'chamber' | 'rtsp' {
	return ['P1P', 'P1S', 'A1', 'A1M'].includes(model) ? 'chamber' : 'rtsp';
}

function mjpegFrame(jpeg: Buffer): Buffer {
	return Buffer.concat([
		Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
		jpeg,
		Buffer.from('\r\n')
	]);
}

/** 80-byte auth packet for the port-6000 chamber protocol: header + bblp + access code (padded). */
function chamberAuth(accessCode: string): Buffer {
	const b = Buffer.alloc(80);
	b.writeUInt32LE(0x40, 0); // payload size
	b.writeUInt32LE(0x3000, 4); // type
	b.writeUInt32LE(0, 8);
	b.writeUInt32LE(0, 12);
	Buffer.from('bblp').copy(b, 16); // username, null-padded to 32
	Buffer.from(accessCode).copy(b, 48); // access code, null-padded to 32
	return b;
}

/** Build an MJPEG ReadableStream for the P1/A1 chamber protocol (port 6000). */
function chamberStream(ip: string, accessCode: string): ReadableStream<Uint8Array> {
	let socket: ReturnType<typeof tlsConnect> | null = null;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			socket = tlsConnect({ host: ip, port: 6000, rejectUnauthorized: false, timeout: 15000 }, () => {
				socket!.write(chamberAuth(accessCode));
			});
			let buf = Buffer.alloc(0);
			let expect = -1; // bytes of JPEG still expected; -1 = waiting on a 16-byte header
			socket.on('data', (chunk: Buffer) => {
				buf = Buffer.concat([buf, chunk]);
				// Parse as many complete frames as are buffered.
				for (;;) {
					if (expect < 0) {
						if (buf.length < 16) break;
						expect = buf.readUInt32LE(0); // JPEG size follows the 16-byte header
						buf = buf.subarray(16);
						if (expect <= 0 || expect > 6_000_000) {
							controller.error(new Error('bad camera frame size'));
							socket?.destroy();
							return;
						}
					}
					if (buf.length < expect) break;
					const jpeg = buf.subarray(0, expect);
					buf = buf.subarray(expect);
					expect = -1;
					try {
						controller.enqueue(mjpegFrame(jpeg));
					} catch {
						socket?.destroy();
						return;
					}
				}
			});
			socket.on('error', (e) => controller.error(e));
			socket.on('timeout', () => socket?.destroy(new Error('camera timed out')));
			socket.on('close', () => {
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			socket?.destroy();
		}
	});
}

/** Build an MJPEG ReadableStream for X1/H2 via ffmpeg pulling the RTSPS feed (port 322). */
function rtspStream(ip: string, accessCode: string): ReadableStream<Uint8Array> {
	const url = `rtsps://bblp:${accessCode}@${ip}:322/streaming/live/1`;
	let proc: ReturnType<typeof spawn> | null = null;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			// -f mpjpeg emits a multipart/x-mixed-replace stream; we re-wrap with our own boundary
			// by re-muxing single frames isn't trivial, so instead output raw mjpeg and split on SOI.
			proc = spawn('ffmpeg', ['-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-f', 'mjpeg', '-q:v', '6', '-r', '10', 'pipe:1']);
			let buf = Buffer.alloc(0);
			proc.stdout!.on('data', (chunk: Buffer) => {
				buf = Buffer.concat([buf, chunk]);
				// Split concatenated JPEGs on the FFD8…FFD9 markers and wrap each as an MJPEG part.
				for (;;) {
					const end = buf.indexOf(Buffer.from([0xff, 0xd9]));
					if (end < 0) break;
					const jpeg = buf.subarray(0, end + 2);
					buf = buf.subarray(end + 2);
					try {
						controller.enqueue(mjpegFrame(jpeg));
					} catch {
						proc?.kill('SIGKILL');
						return;
					}
				}
				if (buf.length > 12_000_000) buf = Buffer.alloc(0); // safety valve
			});
			proc.on('error', (e) => controller.error(e));
			proc.on('close', () => {
				try {
					controller.close();
				} catch {
					/* noop */
				}
			});
		},
		cancel() {
			proc?.kill('SIGKILL');
		}
	});
}

export function cameraStream(model: string, ip: string, accessCode: string): ReadableStream<Uint8Array> {
	return cameraTransport(model) === 'chamber' ? chamberStream(ip, accessCode) : rtspStream(ip, accessCode);
}

/** Grab a single JPEG still from the printer's camera (for the end-of-print photo). null on failure. */
export function captureFrame(model: string, ip: string, accessCode: string): Promise<Buffer | null> {
	return cameraTransport(model) === 'chamber' ? captureChamber(ip, accessCode) : captureRtsp(ip, accessCode);
}

function captureChamber(ip: string, accessCode: string): Promise<Buffer | null> {
	return new Promise((resolve) => {
		let done = false;
		const socket = tlsConnect({ host: ip, port: 6000, rejectUnauthorized: false, timeout: 10000 }, () => socket.write(chamberAuth(accessCode)));
		const finish = (b: Buffer | null) => { if (done) return; done = true; try { socket.destroy(); } catch { /* */ } resolve(b); };
		let buf = Buffer.alloc(0), expect = -1;
		socket.on('data', (chunk: Buffer) => {
			buf = Buffer.concat([buf, chunk]);
			if (expect < 0) { if (buf.length < 16) return; expect = buf.readUInt32LE(0); buf = buf.subarray(16); if (expect <= 0 || expect > 6_000_000) return finish(null); }
			if (buf.length < expect) return;
			finish(buf.subarray(0, expect)); // first complete frame
		});
		socket.on('error', () => finish(null));
		socket.on('timeout', () => finish(null));
		setTimeout(() => finish(null), 10000);
	});
}

function captureRtsp(ip: string, accessCode: string): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const url = `rtsps://bblp:${accessCode}@${ip}:322/streaming/live/1`;
		const proc = spawn('ffmpeg', ['-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-frames:v', '1', '-f', 'image2', '-q:v', '3', 'pipe:1']);
		const chunks: Buffer[] = [];
		let done = false;
		const finish = () => { if (done) return; done = true; try { proc.kill('SIGKILL'); } catch { /* */ } resolve(chunks.length ? Buffer.concat(chunks) : null); };
		proc.stdout?.on('data', (c: Buffer) => chunks.push(c));
		proc.on('close', finish);
		proc.on('error', () => { done = true; resolve(null); });
		setTimeout(finish, 15000);
	});
}
