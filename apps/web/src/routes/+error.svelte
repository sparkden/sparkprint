<script lang="ts">
	import { page } from '$app/state';
	import Logo from '$lib/components/Logo.svelte';

	const status = $derived(page.status);
	const message = $derived(
		status === 404 ? "We couldn't find that page." : (page.error?.message ?? 'Something went wrong.')
	);
</script>

<svelte:head><title>{status} · SparkPrint</title></svelte:head>

<div class="flex min-h-full flex-col items-center justify-center bg-soft-paper px-6 py-16 text-center">
	<a href="/" class="mb-8"><Logo size={30} /></a>
	<p class="accent-serif text-6xl text-spark">{status}</p>
	<h1 class="mt-3 text-2xl font-semibold">{message}</h1>
	<p class="mt-2 max-w-sm text-sm text-soft-ink">
		{#if status === 404}
			The page may have moved, or the link is out of date.
		{:else}
			Try again in a moment. If it keeps happening, let your lab admin know.
		{/if}
	</p>
	<div class="mt-8 flex gap-3">
		<a href="/app" class="btn btn-primary">Go to app</a>
		<a href="/" class="btn btn-secondary">Home</a>
	</div>
</div>
