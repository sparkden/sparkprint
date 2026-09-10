import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * App-level secrets: deterministic hashing for session-token lookup, and AES-256-GCM
 * encryption for data at rest (Bambu access tokens). Key derived from APP_SECRET.
 */
let _key: Buffer | null = null;
function key(): Buffer {
	if (_key) return _key;
	const secret = env.APP_SECRET;
	if ((!secret || secret.length < 16) && env.NODE_ENV === 'production') {
		throw new Error('APP_SECRET must be set to a strong value (>=16 chars) in production');
	}
	_key = scryptSync(secret || 'dev-insecure-secret-change-me', 'sparkprint-kdf-v1', 32);
	return _key;
}

/** Deterministic hash for opaque high-entropy tokens (session ids). */
export function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

/** Encrypt a UTF-8 string → "v1.<iv>.<tag>.<ct>" (base64url). */
export function encrypt(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

/** Decrypt a value produced by encrypt(). Tolerates legacy plaintext (returns as-is). */
export function decrypt(blob: string | null | undefined): string | null {
	if (!blob) return null;
	if (!blob.startsWith('v1.')) return blob; // legacy/plaintext tolerance
	const [, iv, tag, ct] = blob.split('.');
	try {
		const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
		d.setAuthTag(Buffer.from(tag, 'base64url'));
		return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
	} catch {
		return null;
	}
}
