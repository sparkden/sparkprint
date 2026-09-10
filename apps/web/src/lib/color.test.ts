import { describe, it, expect } from 'vitest';
import { colorDistance, normalizeHex } from './color';

describe('colorDistance', () => {
	it('is zero for identical colors', () => {
		expect(colorDistance('#FF5B14', '#FF5B14')).toBe(0);
	});
	it('is maximal for black vs white', () => {
		expect(colorDistance('#000000', '#FFFFFF')).toBeCloseTo(Math.sqrt(3 * 255 ** 2), 5);
	});
	it('treats near colors as close', () => {
		expect(colorDistance('#FF5B14', '#FF5C15')).toBeLessThan(5);
	});
});

describe('normalizeHex', () => {
	it('strips RGBA alpha and uppercases', () => {
		expect(normalizeHex('ff6a00ff')).toBe('#FF6A00');
	});
	it('accepts leading #', () => {
		expect(normalizeHex('#00ae42')).toBe('#00AE42');
	});
	it('rejects empty / invalid', () => {
		expect(normalizeHex('')).toBeNull();
		expect(normalizeHex(null)).toBeNull();
		expect(normalizeHex('xyz')).toBeNull();
	});
});
