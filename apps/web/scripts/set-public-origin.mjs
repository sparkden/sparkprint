// Upserts the app's public base URL into app_settings so cloud print can build printer-reachable
// download links. Called by start.sh with the live tunnel URL; also usable manually:
//   node apps/web/scripts/set-public-origin.mjs https://your-domain.example
import postgres from 'postgres';

const origin = (process.argv[2] || process.env.PRINT_PUBLIC_ORIGIN || '').trim();
const dbUrl = process.env.DATABASE_URL;
if (!origin || !dbUrl) {
	console.error('[set-public-origin] need a URL arg and DATABASE_URL');
	process.exit(0); // non-fatal for start.sh
}
try {
	const u = new URL(origin);
	if (!/^https?:$/.test(u.protocol)) throw new Error('not http(s)');
	const sql = postgres(dbUrl);
	await sql`insert into app_settings (key, value, updated_at) values ('public_origin', ${u.origin}, now())
	          on conflict (key) do update set value = ${u.origin}, updated_at = now()`;
	await sql.end();
	console.log(`[set-public-origin] public_origin = ${u.origin}`);
} catch (e) {
	console.error('[set-public-origin] failed:', e.message);
	process.exit(0); // never block app startup
}
