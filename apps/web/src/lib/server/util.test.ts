import { describe, it, expect } from 'vitest';
import { slugify, monthStart } from './util';

describe('slugify', () => {
	it('lowercases and hyphenates', () => {
		expect(slugify('Lincoln High Makerspace')).toBe('lincoln-high-makerspace');
	});
	it('strips punctuation and trims hyphens', () => {
		expect(slugify('  Room #204 — Lab!  ')).toBe('room-204-lab');
	});
	it('caps length', () => {
		expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(40);
	});
});

describe('monthStart', () => {
	it('returns the 1st of the month at UTC midnight', () => {
		const d = monthStart(new Date('2026-09-17T13:45:00Z'));
		expect(d.toISOString()).toBe('2026-09-01T00:00:00.000Z');
	});
});
