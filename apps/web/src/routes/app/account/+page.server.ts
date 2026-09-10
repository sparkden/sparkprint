import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.user!;
	return { profile: { name: u.name, email: u.email, role: u.role, orgName: u.orgName } };
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const user = locals.user!;
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (name.length < 2) return fail(400, { profileError: 'Enter your name.' });
		await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
		return { profileSuccess: true };
	},

	changePassword: async ({ request, locals }) => {
		const user = locals.user!;
		const fd = await request.formData();
		const parsed = z
			.object({ current: z.string().min(1), next: z.string().min(8, 'Use at least 8 characters') })
			.safeParse({ current: fd.get('current'), next: fd.get('next') });
		if (!parsed.success) return fail(400, { passwordError: parsed.error.issues[0].message });

		const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
		if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, parsed.data.current))) {
			return fail(400, { passwordError: 'Current password is incorrect.' });
		}
		await db.update(users).set({ passwordHash: await hashPassword(parsed.data.next), updatedAt: new Date() }).where(eq(users.id, user.id));
		return { passwordSuccess: true };
	}
};
