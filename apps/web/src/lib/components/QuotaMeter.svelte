<script lang="ts">
	let {
		label,
		used,
		limit,
		unit = ''
	}: { label: string; used: number; limit: number | null; unit?: string } = $props();

	const pct = $derived(limit == null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100)));
	const tone = $derived(pct >= 100 ? '#e04f35' : pct >= 80 ? '#c8a24a' : '#1e2f66');
</script>

<div>
	<div class="flex items-baseline justify-between">
		<span class="text-sm font-medium text-soft-ink">{label}</span>
		<span class="text-sm font-semibold text-ink">
			{used}{unit}
			{#if limit != null}<span class="text-muted-ink"> / {limit}{unit}</span>{:else}<span class="text-muted-ink"> · unlimited</span>{/if}
		</span>
	</div>
	<div class="mt-2 h-2 overflow-hidden rounded-full bg-warm-100">
		{#if limit != null}
			<div class="h-full rounded-full transition-all" style="width: {pct}%; background: {tone}"></div>
		{:else}
			<div class="h-full w-full rounded-full bg-gradient-to-r from-spark-soft to-spark/40"></div>
		{/if}
	</div>
</div>
