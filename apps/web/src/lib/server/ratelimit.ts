// Lightweight in-memory sliding-window rate limiter. Per-process (fine for a single
// instance / Coolify app); swap for a Postgres- or Redis-backed limiter if you scale out.
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
	if (hits.length >= limit) {
		buckets.set(key, hits);
		return false; // blocked
	}
	hits.push(now);
	buckets.set(key, hits);
	return true; // allowed
}

// Opportunistic cleanup so the map doesn't grow unbounded.
let lastSweep = 0;
export function sweep(windowMs = 15 * 60 * 1000) {
	const now = Date.now();
	if (now - lastSweep < 60_000) return;
	lastSweep = now;
	for (const [k, v] of buckets) {
		const kept = v.filter((t) => now - t < windowMs);
		if (kept.length) buckets.set(k, kept);
		else buckets.delete(k);
	}
}
