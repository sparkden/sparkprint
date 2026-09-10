<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	let { children } = $props();
</script>

<div class="flex min-h-full flex-col bg-soft-paper">
	<header class="mx-auto w-full max-w-6xl px-6 py-5">
		<a href="/"><Logo /></a>
	</header>
	<main class="flex flex-1 items-center justify-center px-6 py-10">
		<div class="w-full max-w-md">
			{@render children()}
		</div>
	</main>
</div>
