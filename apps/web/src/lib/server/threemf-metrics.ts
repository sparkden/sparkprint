import { unzipSync, strFromU8 } from 'fflate';

/**
 * Extract filament grams + print seconds from a sliced Bambu `.gcode.3mf` (as exported by Bambu
 * Studio / OrcaSlicer). Reads the embedded plate G-code comments. Best-effort — returns zeros if
 * the file isn't a recognizable sliced 3mf.
 */
const DENSITY_G_CM3 = 1.24;

export function metricsFrom3mf(data: Buffer | Uint8Array): { grams: number; timeSec: number } {
	try {
		const files = unzipSync(data instanceof Buffer ? new Uint8Array(data) : data);
		const name = Object.keys(files).find((n) => /^Metadata\/plate_\d+\.gcode$/i.test(n)) || Object.keys(files).find((n) => n.toLowerCase().endsWith('.gcode'));
		if (!name) return { grams: 0, timeSec: 0 };
		// Only the header/footer of the gcode carries the summary comments.
		const text = strFromU8(files[name]);
		const head = text.slice(0, 4000) + '\n' + text.slice(-4000);

		let grams = parseFloat(/filament used\s*\[g\]\s*[:=]\s*([\d.]+)/i.exec(head)?.[1] ?? '') || 0;
		if (!grams) {
			const cm3 = parseFloat(/filament used\s*\[cm3\]\s*[:=]\s*([\d.]+)/i.exec(head)?.[1] ?? '');
			if (cm3) grams = Math.round(cm3 * DENSITY_G_CM3 * 10) / 10;
		}
		let timeSec = 0;
		const hms = /(?:model printing time|total estimated time|estimated printing time)\D*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(head);
		if (hms) timeSec = +(hms[1] || 0) * 3600 + +(hms[2] || 0) * 60 + +(hms[3] || 0);
		return { grams, timeSec };
	} catch {
		return { grams: 0, timeSec: 0 };
	}
}

/** True if the bytes look like a Bambu sliced 3mf (zip containing Metadata/plate_*.gcode). */
export function isSliced3mf(data: Buffer | Uint8Array): boolean {
	try {
		const files = unzipSync(data instanceof Buffer ? new Uint8Array(data) : data);
		return Object.keys(files).some((n) => /^Metadata\/plate_\d+\.gcode$/i.test(n));
	} catch {
		return false;
	}
}
