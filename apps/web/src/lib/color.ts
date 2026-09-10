// Pure color helpers shared by the dispatcher and telemetry parser (no server deps).

export function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Euclidean RGB distance between two #RRGGBB colors. */
export function colorDistance(a: string, b: string): number {
	const [r1, g1, b1] = hexToRgb(a);
	const [r2, g2, b2] = hexToRgb(b);
	return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Normalize "FF6A00FF" (RRGGBBAA) or "#ff6a00" → "#FF6A00". null for empty/invalid. */
export function normalizeHex(c: string | null | undefined): string | null {
	if (!c || typeof c !== 'string') return null;
	const hex = c.replace(/^#/, '');
	if (hex.length < 6 || !/^[0-9a-fA-F]{6}/.test(hex)) return null;
	return `#${hex.slice(0, 6).toUpperCase()}`;
}
