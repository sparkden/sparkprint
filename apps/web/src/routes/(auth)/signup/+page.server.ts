import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { orgs, users } from '$lib/server/db/schema';
import { hashPassword, createSession } from '$lib/server/auth';
import { slugify } from '$lib/server/util';
import { rateLimit, sweep } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(303, '/app');
};

const schema = z.object({
	schoolName: z.string().min(2, 'School name is too short').max(80),
	name: z.string().min(2, 'Enter your name').max(80),
	email: z.string().email('Enter a valid email'),
	password: z.string().min(8, 'Use at least 8 characters')
});

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		sweep();
		if (!rateLimit(`signup:${getClientAddress()}`, 5, 10 * 60 * 1000)) {
			return fail(429, {
				values: { schoolName: '', name: '', email: '' },
				error: 'Too many attempts. Please wait a few minutes and try again.'
			});
		}
		const form = Object.fromEntries(await request.formData());
		const parsed = schema.safeParse(form);
		if (!parsed.success) {
			return fail(400, {
				values: { schoolName: form.schoolName, name: form.name, email: form.email },
				error: parsed.error.issues[0].message
			});
		}
		const { schoolName, name, email, password } = parsed.data;

		// Unique slug
		let slug = slugify(schoolName) || 'lab';
		const existing = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
		if (existing.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

		const passwordHash = await hashPassword(password);

		let userId: string;
		try {
			userId = await db.transaction(async (tx) => {
				const [org] = await tx.insert(orgs).values({ name: schoolName, slug }).returning();
				const [user] = await tx
					.insert(users)
					.values({
						orgId: org.id,
						email,
						name,
						passwordHash,
						role: 'owner',
						status: 'active'
					})
					.returning();
				return user.id;
			});
		} catch (e) {
			return fail(400, {
				values: { schoolName, name, email },
				error: 'Could not create the account. That email may already be in use.'
			});
		}

		await createSession(userId, cookies);
		throw redirect(303, '/admin');
	}
};
