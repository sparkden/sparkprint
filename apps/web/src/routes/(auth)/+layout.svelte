<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	let { children } = $props();
</script>

<div class="relative flex min-h-full flex-col overflow-hidden bg-soft-paper">
	<!-- Ambient brand glow -->
	<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
		<div class="absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-spark/15 blur-3xl"></div>
		<div class="absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-amber/10 blur-3xl"></div>
	</div>

	<header class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
		<a href="/" class="transition-opacity hover:opacity-80"><Logo /></a>
		<span class="hidden text-sm text-muted-ink sm:block">Self-hosted print lab</span>
	</header>

	<main class="flex flex-1 items-center justify-center px-6 pb-16 pt-2">
		<div class="w-full max-w-md">
			{@render children()}
			<p class="mt-6 text-center text-xs text-faint-ink">
				SparkPrint · runs on your network, prints stay in your building
			</p>
		</div>
	</main>
</div>
