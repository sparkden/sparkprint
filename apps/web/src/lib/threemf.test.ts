import { describe, it, expect } from 'vitest';
import { encodeState } from './threemf';

// Values verified against BambuStudio/Orca get_triangle_as_string (see docs/BAMBU.md).
describe('encodeState (TriangleSelector hex)', () => {
	it('returns empty for no paint', () => {
		expect(encodeState(0)).toBe('');
	});
	it('enforcer / filament-1 state → "4"', () => {
		expect(encodeState(1)).toBe('4');
	});
	it('blocker / filament-2 state → "8"', () => {
		expect(encodeState(2)).toBe('8');
	});
	it('color index 3 → "0C"', () => {
		expect(encodeState(3)).toBe('0C');
	});
	it('color index 4 → "1C", 5 → "2C"', () => {
		expect(encodeState(4)).toBe('1C');
		expect(encodeState(5)).toBe('2C');
	});
	it('color index 17 → "EC" (value 14, last before escape)', () => {
		expect(encodeState(17)).toBe('EC');
	});
	it('color index 18 → "0FC" (escape nibble)', () => {
		expect(encodeState(18)).toBe('0FC');
	});
});
