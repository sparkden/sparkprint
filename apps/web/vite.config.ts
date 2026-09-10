import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: true,
		allowedHosts: true,
		port: 5173,
		// Bind EXACTLY this port (fail instead of silently hopping to 5174, which would
		// leave the tunnel pointing at the wrong port).
		strictPort: true
	}
});
