import { error } from '@sveltejs/kit';
import { hasRole, type SessionUser } from './auth';
import type { Role } from './db/schema';

/** Throw 403 unless the user meets the minimum role. Returns the user for convenience. */
export function require(user: SessionUser | null, min: Role): SessionUser {
	if (!user) throw error(401, 'Not signed in');
	if (!hasRole(user, min)) throw error(403, 'You do not have permission to do that');
	return user;
}

export const requireStaff = (u: SessionUser | null) => require(u, 'teacher');
export const requireAdmin = (u: SessionUser | null) => require(u, 'admin');
export const requireOwner = (u: SessionUser | null) => require(u, 'owner');
