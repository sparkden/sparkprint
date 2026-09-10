<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	let {
		open = $bindable(false),
		title,
		children,
		footer
	}: { open?: boolean; title: string; children: Snippet; footer?: Snippet } = $props();

	function onkey(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onkeydown={onkey} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			aria-label="Close"
			class="absolute inset-0 bg-ink/40 backdrop-blur-sm"
			onclick={() => (open = false)}
		></button>
		<div class="card relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 shadow-xl">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-lg font-semibold">{title}</h2>
				<button class="btn btn-ghost btn-sm" onclick={() => (open = false)} aria-label="Close">
					<Icon name="x" size={18} />
				</button>
			</div>
			{@render children()}
			{#if footer}
				<div class="mt-6 flex justify-end gap-2">{@render footer()}</div>
			{/if}
		</div>
	</div>
{/if}
