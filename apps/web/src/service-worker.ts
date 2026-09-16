/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

// A minimal, safe PWA service worker: precache the built app shell + static assets so LataPrint
// installs and launches instantly, and serve pages network-first (falling back to cache offline).
// It never caches API/form responses aggressively — the live data always comes from the network.
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `lataprint-${version}`;
// Only precache hashed build assets + static files (never HTML routes — those stay network-first).
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return; // never touch POST/actions
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return; // let cross-origin (CDN fonts) pass through

	// Hashed build assets + static files are immutable → cache-first.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
		return;
	}

	// Everything else (pages, data) → network-first, fall back to cache only when truly offline.
	event.respondWith(
		(async () => {
			try {
				return await fetch(req);
			} catch {
				const cached = await caches.match(req);
				if (cached) return cached;
				throw new Error('offline and not cached');
			}
		})()
	);
});
