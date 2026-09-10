/**
 * Instant slice ESTIMATE (geometry-based), used only for the pre-submit quota gate so a
 * student is told immediately if a print would blow their quota. The authoritative grams/
 * time + printable 3mf come from the real server-side slicer worker (services/slicer,
 * OrcaSlicer CLI), which overwrites these values when the slice completes.
 */

export type SliceInput = {
	// bounding box (mm) and volume (mm^3) computed at import time
	bbox: { x: number; y: number; z: number };
	volumeMm3: number;
	layerHeightMm: number;
	infillPct: number;
	supports: boolean;
	copies: number;
	filamentType: string;
};

export type SliceResult = {
	grams: number;
	timeSec: number;
	gcodeKey: string | null;
};

// Densities g/cm^3 for common filaments.
const DENSITY: Record<string, number> = {
	PLA: 1.24,
	'PLA-CF': 1.29,
	PETG: 1.27,
	'PETG-CF': 1.3,
	ABS: 1.04,
	ASA: 1.07,
	TPU: 1.21,
	PA: 1.15,
	PC: 1.2,
	Support: 1.2
};

export interface Estimator {
	estimate(input: SliceInput): Promise<SliceResult>;
}

export class HeuristicEstimator implements Estimator {
	async estimate(input: SliceInput): Promise<SliceResult> {
		const density = DENSITY[input.filamentType] ?? 1.24;
		// Solid volume fraction: walls/top/bottom (~roughly constant shell) + infill of interior.
		const shellFraction = 0.28;
		const interior = Math.max(0, 1 - shellFraction);
		const solidFraction = Math.min(1, shellFraction + interior * (input.infillPct / 100));
		let volumeCm3 = (input.volumeMm3 / 1000) * solidFraction;
		if (input.supports) volumeCm3 *= 1.12;
		volumeCm3 *= input.copies;

		const grams = Math.max(1, volumeCm3 * density);
		// Time heuristic: volumetric flow ~ layer height dependent; base rate mm^3/s.
		const flow = 8 + input.layerHeightMm * 40; // faster with thicker layers
		const printCm3 = volumeCm3;
		const timeSec = Math.round((printCm3 * 1000) / flow + 120 * input.copies);

		return { grams: Math.round(grams * 10) / 10, timeSec, gcodeKey: null };
	}
}

let _estimator: Estimator | null = null;
export function getEstimator(): Estimator {
	if (!_estimator) _estimator = new HeuristicEstimator();
	return _estimator;
}
