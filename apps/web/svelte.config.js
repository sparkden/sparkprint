import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// We run behind a Cloudflare tunnel (ORIGIN = public https URL) AND serve a no-login kiosk
		// from http://localhost on the same box. SvelteKit's built-in check compares the POST Origin
		// header to that single public ORIGIN, which wrongly rejects the local kiosk. We turn it off
		// here and enforce a LAN-aware equivalent in hooks.server.ts (allows the public origin +
		// loopback/LAN, blocks real external cross-site POSTs).
		csrf: { checkOrigin: false },
		alias: {
			$lib: 'src/lib'
		}
	}
};

export default config;
