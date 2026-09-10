import { describe, it, expect } from 'vitest';
import { HeuristicEstimator, type SliceInput } from './slicer';

const base: SliceInput = {
	bbox: { x: 50, y: 50, z: 50 },
	volumeMm3: 20000,
	layerHeightMm: 0.2,
	infillPct: 15,
	supports: false,
	copies: 1,
	filamentType: 'PLA'
};

describe('HeuristicEstimator.estimate', () => {
	const slicer = new HeuristicEstimator();

	it('returns positive grams and time', async () => {
		const r = await slicer.estimate(base);
		expect(r.grams).toBeGreaterThan(0);
		expect(r.timeSec).toBeGreaterThan(0);
	});

	it('uses more filament at higher infill', async () => {
		const low = await slicer.estimate({ ...base, infillPct: 10 });
		const high = await slicer.estimate({ ...base, infillPct: 90 });
		expect(high.grams).toBeGreaterThan(low.grams);
	});

	it('scales with copies', async () => {
		const one = await slicer.estimate({ ...base, copies: 1 });
		const three = await slicer.estimate({ ...base, copies: 3 });
		expect(three.grams).toBeCloseTo(one.grams * 3, 0);
	});

	it('adds material for supports', async () => {
		const no = await slicer.estimate({ ...base, supports: false });
		const yes = await slicer.estimate({ ...base, supports: true });
		expect(yes.grams).toBeGreaterThan(no.grams);
	});
});
