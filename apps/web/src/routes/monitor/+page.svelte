<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data } = $props();

	let now = $state(new Date());
	onMount(() => {
		const clock = setInterval(() => (now = new Date()), 1000);
		const poll = setInterval(() => invalidateAll(), 8000); // live board
		return () => {
			clearInterval(clock);
			clearInterval(poll);
		};
	});

	const printers = $derived(data.printers);
	const free = $derived(printers.filter((p) => p.status === 'idle' && p.online).length);
	const printing = $derived(printers.filter((p) => p.status === 'printing').length);
	const ready = $derived(printers.filter((p) => p.status === 'finished').length);

	function remaining(min: number | null) {
		if (min == null || min <= 0) return '';
		const h = Math.floor(min / 60);
		const m = Math.round(min % 60);
		return h ? `${h}h ${m}m left` : `${m}m left`;
	}
	const clock = $derived(now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
</script>

<svelte:head><title>Lab Monitor · {data.orgName}</title></svelte:head>

<div class="min-h-screen bg-soft-paper px-5 py-5 sm:px-8">
	<!-- Header -->
	<header class="mb-6 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Logo />
			<div class="hidden h-8 w-px bg-warm-300 sm:block"></div>
			<div class="hidden sm:block">
				<p class="text-lg font-semibold text-ink">{data.orgName}</p>
				<p class="text-xs text-muted-ink">Live lab monitor</p>
			</div>
		</div>
		<div class="flex items-center gap-3 text-sm font-semibold">
			<span class="badge badge-success">{free} free</span>
			<span class="badge badge-spark">{printing} printing</span>
			{#if ready > 0}<span class="badge badge-warning">{ready} to pick up</span>{/if}
			<span class="tabular-nums text-2xl font-bold text-ink">{clock}</span>
		</div>
	</header>

	<!-- Printer board -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each printers as p}
			{@const color = (p.colorRequest ?? [])[0]?.colorHex}
			<div
				class="card p-5 {p.status === 'finished' ? 'ring-2 ring-warning/50' : ''} {!p.online || !p.enabled ? 'opacity-55' : ''}"
			>
				<div class="flex items-start justify-between">
					<div>
						<p class="text-lg font-bold text-ink">{p.name}</p>
						<p class="text-xs text-muted-ink">{p.model}</p>
					</div>
					{#if p.status === 'idle' && p.online}
						<span class="badge badge-success">Free</span>
					{:else if p.status === 'printing'}
						<span class="badge badge-spark">Printing</span>
					{:else if p.status === 'finished'}
						<span class="badge badge-warning">Ready</span>
					{:else if !p.online}
						<span class="badge badge-neutral">Offline</span>
					{:else}
						<span class="badge badge-neutral capitalize">{p.status}</span>
					{/if}
				</div>

				{#if p.status === 'printing'}
					<div class="mt-4">
						<div class="flex items-center gap-2">
							{#if color}<span class="h-4 w-4 shrink-0 rounded-full border border-warm-300" style="background:{color}"></span>{/if}
							<p class="truncate text-sm font-semibold text-ink">{p.modelName ?? p.jobName ?? 'Print'}</p>
						</div>
						<p class="mt-0.5 truncate text-xs text-muted-ink">{p.ownerName ?? '—'}</p>
						<div class="mt-3 h-2 overflow-hidden rounded-full bg-warm-100">
							<div class="h-full rounded-full bg-spark transition-all" style="width:{p.progressPct ?? 0}%"></div>
						</div>
						<div class="mt-1.5 flex justify-between text-xs text-muted-ink">
							<span class="font-semibold text-spark-deep">{p.progressPct ?? 0}%</span>
							<span>{remaining(p.remainingTimeMin)}</span>
						</div>
					</div>
				{:else if p.status === 'finished'}
					<div class="mt-4">
						<p class="truncate text-sm font-semibold text-ink">{p.modelName ?? p.jobName ?? 'Print'}</p>
						<p class="mt-0.5 truncate text-xs text-muted-ink">{p.ownerName ?? '—'} · done</p>
						<form method="POST" action="?/checkout" use:enhance class="mt-3">
							<input type="hidden" name="jobId" value={p.jobId} />
							{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
							<button class="btn btn-primary w-full"><Icon name="check" size={16} /> Picked up — check out</button>
						</form>
					</div>
				{:else if p.status === 'idle' && p.online}
					<p class="mt-6 text-center text-2xl font-bold text-success">Available</p>
				{:else}
					<p class="mt-6 text-center text-sm text-muted-ink">{p.online ? 'Not available' : 'Offline'}</p>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Queue -->
	{#if data.queue.length}
		<div class="mt-8">
			<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-ink">Up next · {data.queue.length} waiting</p>
			<div class="flex flex-wrap gap-2">
				{#each data.queue as q}
					<span class="inline-flex items-center gap-2 rounded-full border border-warm-200 bg-surface px-3 py-1.5 text-sm shadow-xs">
						<span class="font-medium text-ink">{q.name}</span>
						<span class="text-muted-ink">· {q.ownerName}</span>
					</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if printers.length === 0}
		<div class="card p-12 text-center text-muted-ink">No printers yet. Add them in Admin → Printers.</div>
	{/if}
</div>
