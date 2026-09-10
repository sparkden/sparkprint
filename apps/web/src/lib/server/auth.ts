import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';
import { sessions, users, orgs, type Role } from './db/schema';
import { sha256 } from './crypto';

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'sp_session';
const SESSION_TTL_DAYS = 30;

// ── Password hashing (scrypt, no native deps) ─────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = (await scryptAsync(password.normalize('NFKC'), salt, 64)) as Buffer;
	return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
	const [scheme, saltHex, hashHex] = stored.split('$');
	if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const expected = Buffer.from(hashHex, 'hex');
	const derived = (await scryptAsync(password.normalize('NFKC'), salt, expected.length)) as Buffer;
	return timingSafeEqual(derived, expected);
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export type SessionUser = {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: Role;
	orgName: string;
	orgSlug: string;
	approvalMode: boolean;
	queueEnabled: boolean;
};

export async function createSession(userId: string, cookies: Cookies): Promise<string> {
	const token = nanoid(40);
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 864e5);
	// Store only the hash; the raw token lives in the cookie.
	await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		expires: expiresAt
	});
	return token;
}

export async function validateSession(token: string): Promise<SessionUser | null> {
	const hashed = sha256(token);
	const rows = await db
		.select({
			session: sessions,
			user: users,
			org: orgs
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.innerJoin(orgs, eq(users.orgId, orgs.id))
		.where(eq(sessions.id, hashed))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	if (row.session.expiresAt.getTime() < Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, hashed));
		return null;
	}
	if (row.user.status === 'suspended') return null;

	return {
		id: row.user.id,
		orgId: row.org.id,
		email: row.user.email,
		name: row.user.name,
		role: row.user.role,
		orgName: row.org.name,
		orgSlug: row.org.slug,
		approvalMode: row.org.approvalMode,
		queueEnabled: row.org.queueEnabled
	};
}

export async function destroySession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await db.delete(sessions).where(eq(sessions.id, sha256(token)));
		cookies.delete(SESSION_COOKIE, { path: '/' });
	}
}

export function getSessionToken(cookies: Cookies): string | null {
	return cookies.get(SESSION_COOKIE) ?? null;
}

// ── RBAC ──────────────────────────────────────────────────────────────────────
const ROLE_RANK: Record<Role, number> = { student: 0, teacher: 1, admin: 2, owner: 3 };

export function hasRole(user: SessionUser | null, min: Role): boolean {
	return !!user && ROLE_RANK[user.role] >= ROLE_RANK[min];
}

export function isStaff(user: SessionUser | null): boolean {
	return hasRole(user, 'teacher');
}
