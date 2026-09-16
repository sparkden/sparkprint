<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Wordmark from '$lib/components/Wordmark.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data } = $props();

	let now = $state(new Date());
	onMount(() => {
		const clock = setInterval(() => (now = new Date()), 1000);
		const poll = setInterval(() => invalidateAll(), 5000); // live board
		return () => { clearInterval(clock); clearInterval(poll); };
	});

	const printers = $derived(data.printers);
	const free = $derived(printers.filter((p) => p.status === 'idle' && p.online && !p.jobStatus).length);
	const sendingOn = (p: (typeof printers)[number]) => p.jobStatus === 'sending' || p.jobStatus === 'ready';
	const printing = $derived(printers.filter((p) => p.status === 'printing').length);
	const ready = $derived(printers.filter((p) => p.status === 'finished').length);

	function remaining(min: number | null) {
		if (min == null || min <= 0) return '';
		const h = Math.floor(min / 60), m = Math.round(min % 60);
		return h ? `${h}h ${m}m left` : `${m}m left`;
	}
	// Always Eastern time on the lab board.
	const time = $derived(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }));
	const date = $derived(now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }));

	const thumb = (modelId: string | null, hasThumb: unknown) =>
		modelId && hasThumb ? `/files/${modelId}/thumb${data.kiosk ? `?kiosk=${data.kioskToken}` : ''}` : null;
</script>

<svelte:head><title>Lab Monitor · {data.orgName}</title></svelte:head>

<div class="antiburn min-h-screen bg-soft-paper px-5 py-5 sm:px-8">
	<!-- Header -->
	<header class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<div class="flex items-center gap-4">
			<img src="/immaculata-seal.png" alt="" class="h-12 w-12 shrink-0 object-contain" />
			<Wordmark height={40} color="var(--color-spark)" class="hidden sm:block" />
			<div class="hidden h-8 w-px bg-warm-300 md:block"></div>
			<p class="hidden text-xs text-muted-ink md:block">Live lab monitor</p>
		</div>
		<div class="flex items-center gap-3 text-sm font-semibold">
			<span class="badge badge-success">{free} free</span>
			<span class="badge badge-spark">{printing} printing</span>
			{#if ready > 0}<span class="badge badge-warning">{ready} to pick up</span>{/if}
			{#if data.weather}
				<span class="hidden items-center gap-1.5 rounded-full border border-warm-200 bg-surface px-3 py-1 md:inline-flex" title="{data.weather.label} · {data.weather.city}">
					<span class="text-base leading-none">{data.weather.icon}</span>
					<span class="tabular-nums">{data.weather.tempF}°</span>
					<span class="font-normal text-muted-ink">{data.weather.city}</span>
				</span>
			{/if}
			<div class="text-right leading-none">
				<div class="tabular-nums text-2xl font-bold text-ink">{time} <span class="text-sm font-semibold text-muted-ink">ET</span></div>
				<div class="text-xs font-normal text-muted-ink">{date}</div>
			</div>
		</div>
	</header>

	<!-- Printer board -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each printers as p}
			{@const color = (p.colorRequest ?? [])[0]?.colorHex}
			{@const img = thumb(p.modelId, p.hasThumb)}
			<div class="card p-5 {p.status === 'finished' ? 'ring-2 ring-warning/50' : ''} {!p.online || !p.enabled ? 'opacity-55' : ''}">
				<div class="flex items-start justify-between">
					<div>
						<p class="text-lg font-bold text-ink">{p.name}</p>
						<p class="text-xs text-muted-ink">{p.model}</p>
					</div>
					{#if sendingOn(p)}<span class="badge badge-spark">Starting…</span>
					{:else if p.status === 'idle' && p.online}<span class="badge badge-success">Free</span>
					{:else if p.status === 'printing'}<span class="badge badge-spark">Printing</span>
					{:else if p.status === 'finished'}<span class="badge badge-warning">Ready</span>
					{:else if !p.online}<span class="badge badge-neutral">Offline</span>
					{:else}<span class="badge badge-neutral capitalize">{p.status}</span>{/if}
				</div>

				{#if p.status === 'printing'}
					<div class="mt-4 flex gap-3">
						{#if img}<img src={img} alt="" class="h-16 w-16 shrink-0 rounded-lg border border-warm-200 bg-[#2b2b2b] object-cover" />{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								{#if color}<span class="h-4 w-4 shrink-0 rounded-full border border-warm-300" style="background:{color}"></span>{/if}
								<p class="truncate text-sm font-semibold text-ink">{p.modelName ?? p.jobName ?? 'Print'}</p>
							</div>
							<p class="mt-0.5 truncate text-xs text-muted-ink">{p.ownerName ?? '—'}</p>
							<div class="mt-2 h-2 overflow-hidden rounded-full bg-warm-100">
								<div class="h-full rounded-full bg-spark transition-all" style="width:{p.progressPct ?? 0}%"></div>
							</div>
							<div class="mt-1 flex justify-between text-xs text-muted-ink">
								<span class="font-semibold text-spark-deep">{p.progressPct ?? 0}%</span>
								<span>{remaining(p.remainingTimeMin)}</span>
							</div>
						</div>
					</div>
					<div class="mt-3 flex gap-2">
						<form method="POST" action="?/complete" use:enhance class="flex-1">
							<input type="hidden" name="jobId" value={p.jobId} />
							{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
							<button class="btn btn-secondary btn-sm w-full"><Icon name="check" size={14} /> Done</button>
						</form>
						<form method="POST" action="?/stop" use:enhance onsubmit={(e) => { if (!confirm('Stop this print on the printer?')) e.preventDefault(); }}>
							<input type="hidden" name="jobId" value={p.jobId} />
							{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
							<button class="btn btn-ghost btn-sm text-danger"><Icon name="x" size={14} /> Stop</button>
						</form>
					</div>
				{:else if p.status === 'finished'}
					<div class="mt-4 flex gap-3">
						{#if img}<img src={img} alt="" class="h-16 w-16 shrink-0 rounded-lg border border-warm-200 bg-[#2b2b2b] object-cover" />{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-semibold text-ink">{p.modelName ?? p.jobName ?? 'Print'}</p>
							<p class="mt-0.5 truncate text-xs text-muted-ink">{p.ownerName ?? '—'} · done</p>
						</div>
					</div>
					<form method="POST" action="?/checkout" use:enhance class="mt-3">
						<input type="hidden" name="jobId" value={p.jobId} />
						{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
						<button class="btn btn-primary w-full"><Icon name="check" size={16} /> Picked up — check out</button>
					</form>
				{:else if sendingOn(p)}
					<div class="mt-6 text-center">
						<p class="text-lg font-bold text-spark-deep">Starting…</p>
						<p class="mt-1 text-xs text-muted-ink truncate">{p.modelName ?? p.jobName ?? 'Sending file to the printer'}</p>
						<form method="POST" action="?/stop" use:enhance class="mt-3">
							<input type="hidden" name="jobId" value={p.jobId} />
							{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
							<button class="btn btn-ghost btn-sm text-danger">Cancel</button>
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
						<span class="font-medium text-ink">{q.name}</span><span class="text-muted-ink">· {q.ownerName}</span>
					</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if printers.length === 0}
		<div class="card p-12 text-center text-muted-ink">No printers yet. Add them in Admin → Printers.</div>
	{/if}
</div>

<!-- Screensaver: a soft dark blob drifts across the screen (+ a tiny whole-board pixel shift) so no
     region stays static and bright — gentle burn-in protection that never hides the content. -->
<div class="saver-blob" aria-hidden="true"></div>

<style>
	.saver-blob {
		position: fixed;
		top: 0;
		left: 0;
		width: 42vmax;
		height: 42vmax;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(0, 0, 0, 0.16), transparent 66%);
		pointer-events: none;
		z-index: 60;
		filter: blur(24px);
		animation: saver-drift 90s ease-in-out infinite alternate;
		will-change: transform;
	}
	@keyframes saver-drift {
		0% { transform: translate(-12vw, -14vh); }
		25% { transform: translate(72vw, 6vh); }
		50% { transform: translate(58vw, 66vh); }
		75% { transform: translate(4vw, 54vh); }
		100% { transform: translate(-12vw, -14vh); }
	}
	/* Sub-pixel-ish whole-board shift so static text edges migrate over time. */
	.antiburn { animation: antiburn-shift 150s ease-in-out infinite alternate; }
	@keyframes antiburn-shift {
		0% { transform: translate(0, 0); }
		50% { transform: translate(2px, 3px); }
		100% { transform: translate(-2px, -2px); }
	}
	@media (prefers-reduced-motion: reduce) {
		.saver-blob, .antiburn { animation: none; }
	}
</style>
