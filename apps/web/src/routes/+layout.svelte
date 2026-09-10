<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	let { children } = $props();

	// Tell the server the public URL the browser actually loaded from, so cloud print can build a
	// printer-reachable download link (the dev tunnel hides this from the server's Host header).
	onMount(() => {
		try {
			fetch('/api/public-origin', { method: 'POST', body: location.origin, headers: { 'content-type': 'text/plain' } }).catch(() => {});
		} catch {
			/* ignore */
		}
	});
</script>

{@render children()}
