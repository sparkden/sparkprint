#!/usr/bin/env node
/**
 * Printer connectivity check — for each configured printer, tests the MQTT control port (8883)
 * and the camera port (6000), and prints what the DB currently thinks. Run it on the Pi:
 *   node /opt/sparkprint/scripts/printer-check.mjs
 */
import net from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.env.SPARKPRINT_DIR || join(here, '..');
const dbPath = join(appDir, 'apps/web/.data/sparkprint.db');
const require = createRequire(import.meta.url);
const Database = require(join(appDir, 'node_modules/better-sqlite3'));

const db = new Database(dbPath, { readonly: true });
const rows = db
	.prepare('SELECT name, ip_address AS ip, access_code AS code, online, status FROM printers ORDER BY name')
	.all();

function test(ip, port) {
	return new Promise((resolve) => {
		const s = net.connect({ host: ip, port, timeout: 3000 });
		s.on('connect', () => { s.destroy(); resolve('OPEN'); });
		s.on('error', (e) => resolve(e.code || 'ERR'));
		s.on('timeout', () => { s.destroy(); resolve('TIMEOUT'); });
	});
}

const pad = (s, n) => String(s ?? '').padEnd(n);

console.log('');
console.log(pad('PRINTER', 20), pad('IP', 16), pad('8883/MQTT', 14), pad('6000/CAM', 12), 'DB');
console.log('-'.repeat(78));
for (const p of rows) {
	if (!p.ip) { console.log(pad(p.name, 20), pad('(no IP set)', 16), pad('-', 14), pad('-', 12), `online=${p.online} status=${p.status}`); continue; }
	const mqtt = await test(p.ip, 8883);
	const cam = await test(p.ip, 6000);
	const code = p.code ? 'code set' : 'NO CODE';
	console.log(pad(p.name, 20), pad(p.ip, 16), pad(mqtt, 14), pad(cam, 12), `online=${p.online} status=${p.status} ${code}`);
}
db.close();
console.log('');
console.log('8883 OPEN + status=idle → dispatchable. 8883 not OPEN but 6000 OPEN → enable LAN Mode on that printer (or fix its IP).');
