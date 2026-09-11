<script lang="ts">
	import Icon from './Icon.svelte';

	// Lazy MJPEG viewer: we only open the stream (and the socket to the printer) when the user
	// clicks Watch, and tear it down when they close it — so we don't hold a camera connection open
	// for every printer card on the page.
	let { printerId, label = 'Live camera', compact = false }: { printerId: string; label?: string; compact?: boolean } = $props();

	let on = $state(false);
	let failed = $state(false);
	// Cache-bust so each open starts a fresh stream.
	let src = $derived(on ? `/api/printers/${printerId}/camera?t=${Date.now()}` : '');

	function toggle() {
		failed = false;
		on = !on;
	}
</script>

<div class="overflow-hidden rounded-lg border border-warm-200 bg-ink/5">
	{#if on}
		<div class="relative">
			{#if failed}
				<div class="flex aspect-video items-center justify-center p-4 text-center text-xs text-muted-ink">
					Couldn't load the camera. Make sure the printer is online with <b class="mx-1">LAN Live View</b> on, and its IP + access code are set.
				</div>
			{:else}
				<!-- svelte-ignore a11y_missing_attribute -->
				<img {src} alt="Live camera for this printer" class="aspect-video w-full bg-black object-contain" onerror={() => (failed = true)} />
				<span class="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"></span> LIVE
				</span>
			{/if}
		</div>
		<button class="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs text-muted-ink hover:bg-warm-100" onclick={toggle}>
			<Icon name="x" size={13} /> Stop
		</button>
	{:else}
		<button class="flex w-full items-center justify-center gap-1.5 {compact ? 'py-2' : 'py-3'} text-xs font-medium text-soft-ink hover:bg-warm-100" onclick={toggle}>
			<Icon name="eye" size={15} /> {label}
		</button>
	{/if}
</div>
