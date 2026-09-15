/** Tiny key/value settings store (global, not org-scoped) backed by the app_settings table. */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { appSettings } from './db/schema';

export async function getSetting(key: string): Promise<string | null> {
	const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
	return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
	const existing = await getSetting(key);
	if (existing === null) await db.insert(appSettings).values({ key, value, updatedAt: new Date() });
	else await db.update(appSettings).set({ value, updatedAt: new Date() }).where(eq(appSettings.key, key));
}

/** The org a kiosk token grants access to (the no-login lab board), or null if the token is wrong. */
export async function kioskOrgId(token: string | null | undefined): Promise<string | null> {
	if (!token) return null;
	const stored = await getSetting('kiosk.token');
	return stored && token === stored ? await getSetting('kiosk.orgId') : null;
}
