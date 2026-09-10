import { nanoid } from 'nanoid';

export function slugify(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/^-+|-+$/g, '');
}

export function inviteToken(): string {
	return nanoid(24);
}

const MONTH_MS = 30 * 864e5;
export function monthStart(d = new Date()): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export { MONTH_MS };
