<script lang="ts">
	let {
		name,
		checked = $bindable(false),
		label,
		description
	}: { name: string; checked?: boolean; label: string; description?: string } = $props();
</script>

<label class="flex cursor-pointer items-start gap-3">
	<span class="relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center">
		<input type="checkbox" {name} bind:checked class="peer sr-only" />
		<span
			class="absolute inset-0 rounded-full bg-warm-300 transition-colors peer-checked:bg-spark"
		></span>
		<span
			class="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
		></span>
	</span>
	<span class="min-w-0">
		<span class="block text-sm font-semibold text-ink">{label}</span>
		{#if description}<span class="block text-sm text-muted-ink">{description}</span>{/if}
	</span>
</label>
