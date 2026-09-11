import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { orgs, users } from '$lib/server/db/schema';
import { hashPassword, createSession } from '$lib/server/auth';
import { slugify } from '$lib/server/util';
import { isInitialized, markInitialized } from '$lib/server/setup';
import { rateLimit, sweep } from '$lib/server/ratelimit';
import type { Actions, PageServerLoad } from './$types';

// Single-org (self-hosted) model: the FIRST person to sign up creates the lab and becomes its
// owner/admin; everyone after that joins that same lab as a student. We never create a 2nd org.
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(303, '/app');
	const [org] = await db.select({ name: orgs.name }).from(orgs).limit(1);
	return { firstRun: !org, orgName: org?.name ?? null };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		sweep();
		if (!rateLimit(`signup:${getClientAddress()}`, 5, 10 * 60 * 1000)) {
			return fail(429, { values: { schoolName: '', name: '', email: '' }, error: 'Too many attempts. Please wait a few minutes and try again.' });
		}
		const form = Object.fromEntries(await request.formData());
		const firstRun = !(await isInitialized());

		const schema = z.object({
			// School name is only needed when creating the lab (first run).
			schoolName: firstRun ? z.string().min(2, 'School/lab name is too short').max(80) : z.string().optional(),
			name: z.string().min(2, 'Enter your name').max(80),
			email: z.string().email('Enter a valid email'),
			password: z.string().min(8, 'Use at least 8 characters')
		});
		const parsed = schema.safeParse(form);
		if (!parsed.success) {
			return fail(400, { values: { schoolName: form.schoolName, name: form.name, email: form.email }, error: parsed.error.issues[0].message });
		}
		const { schoolName, name, email, password } = parsed.data;
		const passwordHash = await hashPassword(password);

		let userId: string;
		let isOwner = false;
		try {
			userId = await db.transaction(async (tx) => {
				// Re-check inside the transaction so two simultaneous first signups can't both create a lab.
				const [existingOrg] = await tx.select().from(orgs).limit(1);
				let orgId: string;
				let role: 'owner' | 'student';
				if (existingOrg) {
					orgId = existingOrg.id;
					role = 'student';
				} else {
					const slug = slugify(schoolName ?? 'lab') || 'lab';
					const [org] = await tx.insert(orgs).values({ name: schoolName ?? 'SparkPrint Lab', slug }).returning();
					orgId = org.id;
					role = 'owner';
					isOwner = true;
				}
				const [user] = await tx.insert(users).values({ orgId, email, name, passwordHash, role, status: 'active' }).returning();
				return user.id;
			});
		} catch {
			return fail(400, { values: { schoolName, name, email }, error: 'Could not create the account. That email may already be in use.' });
		}

		if (isOwner) markInitialized();
		await createSession(userId, cookies);
		throw redirect(303, isOwner ? '/admin' : '/app');
	}
};
