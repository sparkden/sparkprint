import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users, orgs } from '$lib/server/db/schema';
import { verifyPassword, createSession } from '$lib/server/auth';
import { rateLimit, sweep } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(303, url.searchParams.get('next') || '/app');
	// Only offer public sign-up before a lab exists (first run). Afterwards, joining is invite-only.
	const [org] = await db.select({ id: orgs.id }).from(orgs).limit(1);
	return { firstRun: !org };
};

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1)
});

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		sweep();
		if (!rateLimit(`login:${getClientAddress()}`, 10, 5 * 60 * 1000)) {
			return fail(429, { email: '', error: 'Too many attempts. Please wait a minute and try again.' });
		}
		const form = Object.fromEntries(await request.formData());
		const parsed = schema.safeParse(form);
		if (!parsed.success) {
			return fail(400, { email: form.email, error: 'Enter your email and password.' });
		}
		const { email, password } = parsed.data;

		const candidates = await db
			.select()
			.from(users)
			.where(sql`lower(${users.email}) = ${email.toLowerCase()}`);

		let matched: (typeof candidates)[number] | null = null;
		for (const u of candidates) {
			if (u.passwordHash && (await verifyPassword(u.passwordHash, password))) {
				matched = u;
				break;
			}
		}

		if (!matched || matched.status === 'suspended') {
			return fail(400, { email, error: 'Invalid email or password.' });
		}

		await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, matched.id));
		await createSession(matched.id, cookies);

		const next = url.searchParams.get('next');
		const isStaff = matched.role === 'admin' || matched.role === 'owner';
		throw redirect(303, next || (isStaff ? '/admin' : '/app'));
	}
};
