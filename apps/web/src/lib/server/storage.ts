import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, unlink, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '$env/dynamic/private';

/**
 * Object storage abstraction. Local disk today; swap the impl for S3-compatible
 * storage later without touching callers. Keys look like
 *   org/<orgId>/models/<modelId>.stl
 */
const ROOT = resolve(env.STORAGE_DIR || './.data/storage');

function pathFor(key: string) {
	// Prevent traversal.
	const p = resolve(ROOT, key);
	if (!p.startsWith(ROOT)) throw new Error('Invalid storage key');
	return p;
}

export async function putStream(key: string, data: ReadableStream | Readable) {
	const dest = pathFor(key);
	await mkdir(dirname(dest), { recursive: true });
	const readable = data instanceof Readable ? data : Readable.fromWeb(data as any);
	await pipeline(readable, createWriteStream(dest));
	return key;
}

export async function putBuffer(key: string, buf: Buffer | Uint8Array) {
	const dest = pathFor(key);
	await mkdir(dirname(dest), { recursive: true });
	await pipeline(Readable.from(buf), createWriteStream(dest));
	return key;
}

export function readStream(key: string) {
	return createReadStream(pathFor(key));
}

export async function readBuffer(key: string): Promise<Buffer> {
	return readFile(pathFor(key));
}

/** Absolute filesystem path for a stored object (e.g. to hand a model to the slicer CLI). */
export function objectFsPath(key: string): string {
	return pathFor(key);
}

export async function objectSize(key: string) {
	try {
		return (await stat(pathFor(key))).size;
	} catch {
		return null;
	}
}

export function objectExists(key: string) {
	return existsSync(pathFor(key));
}

export async function removeObject(key: string) {
	try {
		await unlink(pathFor(key));
	} catch {
		/* ignore */
	}
}
