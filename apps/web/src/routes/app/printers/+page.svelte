<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { PRINTER_STATUS_META } from '$lib/status';
	let { data } = $props();
</script>

<svelte:head><title>Printers · SparkPrint</title></svelte:head>

<div class="mx-auto max-w-5xl">
	<PageHeader title="Printers" subtitle="What's in the lab and what colors are loaded." />

	{#if data.printers.length === 0}
		<div class="card p-10 text-center text-sm text-soft-ink">No printers are set up yet.</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.printers as p}
				<div class="card p-5">
					<div class="flex items-start justify-between">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl {p.online ? 'bg-spark-soft text-spark-deep' : 'bg-warm-100 text-muted-ink'}"><Icon name="printer" size={20} /></div>
							<div>
								<p class="font-semibold text-ink">{p.name}</p>
								<p class="text-xs text-muted-ink">{p.model}{p.location ? ` · ${p.location}` : ''}</p>
							</div>
						</div>
						<span class="badge {PRINTER_STATUS_META[p.status]?.badge ?? 'badge-neutral'}">{PRINTER_STATUS_META[p.status]?.label ?? p.status}</span>
					</div>

					{#if p.status === 'printing'}
						<div class="mt-3">
							<div class="h-1.5 overflow-hidden rounded-full bg-warm-100"><div class="h-full rounded-full bg-spark" style="width:{p.progressPct ?? 0}%"></div></div>
							<p class="mt-1 text-xs text-muted-ink">{p.current ?? 'Printing'} · {p.progressPct ?? 0}%</p>
						</div>
					{/if}

					{#if p.slots.length}
						<div class="mt-4 flex flex-wrap gap-1.5">
							{#each p.slots as s}
								<div class="h-6 w-6 rounded border border-warm-300 {s.empty ? 'bg-warm-100' : ''}" style={s.empty ? '' : `background:${s.colorHex}`} title={s.empty ? 'Empty' : `${s.colorName ?? s.colorHex} · ${s.filamentType}`}></div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
