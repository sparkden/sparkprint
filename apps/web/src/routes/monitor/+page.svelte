<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { COLOR_LIBRARY } from '$lib/colors';
	let { data, form } = $props();

	let now = $state(new Date());
	let modalOpen = $state(false);
	onMount(() => {
		const clock = setInterval(() => (now = new Date()), 1000);
		// Live board — but never yank the data out from under an open editor.
		const poll = setInterval(() => { if (!modalOpen) invalidateAll(); }, 5000);
		return () => { clearInterval(clock); clearInterval(poll); };
	});

	const printers = $derived(data.printers);

	// ── Filament editing ─────────────────────────────────────────────────────
	const FIL_TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'PC', 'PA', 'PVA', 'Support'];
	type P = (typeof printers)[number];
	type SlotLike = {
		slotId: string; amsIndex: number; slotIndex: number; empty: boolean | null;
		filamentType: string | null; colorHex: string | null; colorName: string | null; remainingPct: number | null;
	};
	type Edit = {
		printerId: string; printerName: string; slotId: string | null; label: string; external: boolean;
		empty: boolean; filamentType: string; colorHex: string; colorName: string; remainingPct: number;
	};
	let edit = $state<Edit | null>(null);
	let search = $state('');

	function slotLabel(p: P, s: SlotLike) {
		return p.multiAms ? `AMS ${s.amsIndex + 1} · Slot ${s.slotIndex + 1}` : `Slot ${s.slotIndex + 1}`;
	}
	function openSlot(p: P, s: SlotLike, external = false) {
		edit = {
			printerId: p.id, printerName: p.name, slotId: s.slotId,
			label: external ? 'External spool' : slotLabel(p, s), external,
			empty: !!s.empty, filamentType: s.filamentType ?? 'PLA',
			colorHex: s.colorHex ?? '#1E2F66', colorName: s.colorName ?? '', remainingPct: s.remainingPct ?? 100
		};
		search = ''; modalOpen = true;
	}
	function openNewExternal(p: P) {
		edit = {
			printerId: p.id, printerName: p.name, slotId: null, label: 'External spool', external: true,
			empty: false, filamentType: 'PLA', colorHex: '#1E2F66', colorName: '', remainingPct: 100
		};
		search = ''; modalOpen = true;
	}
	function pick(c: { hex: string; name: string }) {
		if (edit) { edit.colorHex = c.hex; edit.colorName = c.name; }
	}
	const swatches = $derived(
		search.trim()
			? COLOR_LIBRARY.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 60)
			: COLOR_LIBRARY.slice(0, 28)
	);
	const canUnload = (p: P) => p.online && (p.ams.some((s) => !s.empty) || (p.external && !p.external.empty));

	// Print-speed profile (Bambu spd_lvl): 1 Silent · 2 Standard · 3 Sport · 4 Ludicrous.
	const SPEED = [
		{ v: 1, label: 'Silent' },
		{ v: 2, label: 'Standard' },
		{ v: 3, label: 'Sport' },
		{ v: 4, label: 'Ludicrous' }
	];
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
		<div class="flex items-center gap-3.5">
			<img src="/immaculata-seal.png" alt="Immaculata High School" class="h-12 w-12 shrink-0 object-contain" />
			<div>
				<p class="text-2xl font-bold leading-none tracking-tight text-ink" style="font-family: var(--font-display)">Immaculata</p>
				<p class="mt-1 text-xs text-muted-ink">Live lab monitor</p>
			</div>
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
					<!-- Live print-speed control -->
					<div class="mt-3">
						<div class="mb-1 flex items-center justify-between">
							<span class="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">Speed</span>
						</div>
						<form method="POST" action="?/setSpeed" use:enhance class="grid grid-cols-4 gap-1">
							<input type="hidden" name="jobId" value={p.jobId} />
							{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
							{#each SPEED as s}
								<button name="level" value={s.v} title={s.label}
									class="rounded-md border px-1 py-1 text-[11px] font-semibold transition-colors {(p.jobSpeed ?? 2) === s.v ? 'border-spark bg-spark text-white' : 'border-warm-200 bg-surface text-soft-ink hover:bg-warm-50'}"
								>{s.label}</button>
							{/each}
						</form>
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

				<!-- Filament loaded in this printer — tap a swatch to edit, or unload. -->
				<div class="mt-4 border-t border-warm-200 pt-3">
					<div class="mb-2 flex items-center justify-between">
						<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-ink">
							<Icon name="spool" size={13} /> Filament
						</span>
						{#if canUnload(p)}
							<form method="POST" action="?/unloadFilament" use:enhance onsubmit={(e) => { if (!confirm(`Unload the loaded filament on ${p.name}?`)) e.preventDefault(); }}>
								<input type="hidden" name="printerId" value={p.id} />
								{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
								<button class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-soft-ink transition-colors hover:bg-warm-100"><Icon name="refresh" size={12} /> Unload</button>
							</form>
						{/if}
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#each p.ams as s}
							<button type="button" onclick={() => openSlot(p, s)} title="Edit {slotLabel(p, s)}"
								class="inline-flex items-center gap-1.5 rounded-full border border-warm-200 bg-surface py-1 pl-1 pr-2.5 text-xs shadow-xs transition-colors hover:border-spark hover:bg-warm-50">
								{#if s.empty}
									<span class="h-4 w-4 rounded-full border border-dashed border-warm-400"></span>
									<span class="text-muted-ink">Empty</span>
								{:else}
									<span class="h-4 w-4 rounded-full ring-1 ring-black/10" style="background:{s.colorHex ?? '#ccc'}"></span>
									<span class="font-medium text-ink">{s.colorName || s.filamentType || 'Filament'}</span>
								{/if}
							</button>
						{/each}
						{#if p.external}
							{@const ext = p.external}
							<button type="button" onclick={() => openSlot(p, ext, true)} title="Edit external spool"
								class="inline-flex items-center gap-1.5 rounded-full border border-warm-200 bg-surface py-1 pl-1 pr-2.5 text-xs shadow-xs transition-colors hover:border-spark hover:bg-warm-50">
								{#if ext.empty}
									<span class="h-4 w-4 rounded-full border border-dashed border-warm-400"></span>
									<span class="text-muted-ink">Ext · empty</span>
								{:else}
									<span class="h-4 w-4 rounded-full ring-1 ring-black/10" style="background:{ext.colorHex ?? '#ccc'}"></span>
									<span class="font-medium text-ink">{ext.colorName || ext.filamentType || 'Ext'}</span>
									<span class="rounded bg-warm-100 px-1 text-[10px] font-semibold text-muted-ink">EXT</span>
								{/if}
							</button>
						{/if}
						{#if p.ams.length === 0 && !p.external}
							<button type="button" onclick={() => openNewExternal(p)}
								class="inline-flex items-center gap-1 rounded-full border border-dashed border-warm-300 px-2.5 py-1 text-xs font-medium text-muted-ink transition-colors hover:border-spark hover:text-spark">
								<Icon name="plus" size={12} /> Set spool color
							</button>
						{/if}
					</div>
				</div>
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

<!-- Filament editor (kept outside .antiburn so the burn-in transform can't offset the fixed modal) -->
{#if edit}
	<Modal bind:open={modalOpen} title="{edit.printerName} · {edit.label}">
		<form
			method="POST"
			action={edit.slotId ? '?/saveSlot' : '?/setSpool'}
			use:enhance={() => async ({ update, result }) => { await update({ reset: false }); if (result.type === 'success') modalOpen = false; }}
			class="space-y-5"
		>
			{#if data.kiosk}<input type="hidden" name="kiosk" value={data.kioskToken} />{/if}
			{#if edit.slotId}<input type="hidden" name="slotId" value={edit.slotId} />
			{:else}<input type="hidden" name="printerId" value={edit.printerId} />{/if}

			<div class:opacity-50={edit.empty}>
				<span class="label">Color</span>
				<div class="flex items-center gap-3">
					<input type="color" name="colorHex" bind:value={edit.colorHex} class="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-warm-300 bg-surface p-1" />
					<input class="input" name="colorName" placeholder="Name (e.g. Navy Blue)" bind:value={edit.colorName} autocomplete="off" />
				</div>
				<input class="input mt-2" placeholder="Search 200+ colors…" bind:value={search} autocomplete="off" />
				<div class="mt-2 grid max-h-36 grid-cols-7 gap-1.5 overflow-y-auto sm:grid-cols-9">
					{#each swatches as c (c.name)}
						<button type="button" onclick={() => pick(c)} title={c.name}
							class="aspect-square rounded-md ring-1 ring-black/10 transition-transform hover:scale-110 {edit.colorHex.toUpperCase() === c.hex.toUpperCase() ? 'outline outline-2 outline-offset-1 outline-spark' : ''}"
							style="background:{c.hex}"
							aria-label={c.name}></button>
					{/each}
					{#if swatches.length === 0}<p class="col-span-full py-2 text-center text-xs text-muted-ink">No colors match “{search}”.</p>{/if}
				</div>
			</div>

			<div class="flex gap-3">
				<div class="flex-1">
					<label class="label" for="ft">Filament type</label>
					<select id="ft" class="select" name="filamentType" bind:value={edit.filamentType}>
						{#each FIL_TYPES as t}<option value={t}>{t}</option>{/each}
					</select>
				</div>
				{#if edit.slotId}
					<div class="flex-1">
						<span class="label">Remaining · {edit.remainingPct}%</span>
						<input type="range" min="0" max="100" step="5" name="remainingPct" bind:value={edit.remainingPct} class="mt-2.5 w-full accent-[#1e2f66]" disabled={edit.empty} />
					</div>
				{/if}
			</div>

			{#if edit.slotId}
				<label class="flex w-fit items-center gap-2 text-sm font-medium text-soft-ink">
					<input type="checkbox" name="empty" bind:checked={edit.empty} class="h-4 w-4 rounded accent-[#1e2f66]" /> This slot is empty
				</label>
			{/if}

			{#if form?.error}<p class="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{form.error}</p>{/if}

			<div class="flex justify-end gap-2 border-t border-warm-200 pt-4">
				<button type="button" class="btn btn-secondary" onclick={() => (modalOpen = false)}>Cancel</button>
				<button class="btn btn-primary"><Icon name="check" size={16} /> Save</button>
			</div>
		</form>
	</Modal>
{/if}

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
		background: rgba(0, 0, 0, 0.12);
		pointer-events: none;
		z-index: 60;
		filter: blur(60px);
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
