<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import type { Diagnostics, Check, CheckStatus } from '$lib/server/diagnostics';
	let { data } = $props();

	let report = $state<Diagnostics>(data.report);
	let running = $state(false);

	async function run() {
		running = true;
		try {
			const res = await fetch('/admin/diagnostics/run', { method: 'POST' });
			if (res.ok) report = await res.json();
		} finally {
			running = false;
		}
	}

	async function free(printerId: string) {
		await fetch('/admin/diagnostics/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ printerId }) });
		await run();
	}

	const dot: Record<CheckStatus, string> = { pass: 'bg-success', warn: 'bg-warning', fail: 'bg-danger' };
	const ring: Record<CheckStatus, string> = { pass: 'border-success/30 bg-success/5', warn: 'border-warning/40 bg-warning/5', fail: 'border-danger/40 bg-danger/5' };
	const label: Record<CheckStatus, string> = { pass: 'OK', warn: 'Check', fail: 'Fix' };

	const fails = $derived([...report.system, ...report.printers.flatMap((p) => p.checks)].filter((c) => c.status === 'fail').length);
	const warns = $derived([...report.system, ...report.printers.flatMap((p) => p.checks)].filter((c) => c.status === 'warn').length);
</script>

<svelte:head><title>Diagnostics · SparkPrint</title></svelte:head>

{#snippet checkRow(c: Check)}
	<div class="flex items-start gap-2.5 py-1.5">
		<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full {dot[c.status]}"></span>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2"><span class="text-sm font-medium text-ink">{c.name}</span><span class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase {c.status === 'pass' ? 'text-success' : c.status === 'warn' ? 'text-[#a35f00]' : 'text-danger'}">{label[c.status]}</span></div>
			<p class="text-sm text-soft-ink">{c.detail}</p>
			{#if c.fix}<p class="mt-0.5 text-xs text-muted-ink">→ {c.fix}</p>{/if}
		</div>
	</div>
{/snippet}

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold">Diagnostics</h1>
		<p class="mt-1 text-sm text-soft-ink">
			Live checks of the server and every printer.
			{#if fails}<span class="font-semibold text-danger">{fails} to fix</span>{/if}
			{#if fails && warns}·{/if}
			{#if warns}<span class="font-semibold text-[#a35f00]">{warns} to check</span>{/if}
			{#if !fails && !warns}<span class="font-semibold text-success">all good 🎉</span>{/if}
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={run} disabled={running}>
		<Icon name="refresh" size={16} /> {running ? 'Testing…' : 'Re-run tests'}
	</button>
</div>

<div class="grid gap-4 lg:grid-cols-2">
	<!-- System -->
	<div class="card p-5">
		<h2 class="mb-2 flex items-center gap-2 font-semibold"><Icon name="settings" size={16} /> System</h2>
		<div class="divide-y divide-warm-100">
			{#each report.system as c}{@render checkRow(c)}{/each}
		</div>
	</div>

	<!-- Printers -->
	<div class="space-y-4">
		{#if report.printers.length === 0}
			<div class="card p-5 text-sm text-muted-ink">No printers set up yet. Add one in <a class="text-spark hover:underline" href="/admin/printers">Manage printers</a>.</div>
		{/if}
		{#each report.printers as p}
			<div class="card p-5 {ring[p.status]}">
				<div class="mb-1 flex items-center justify-between">
					<h2 class="flex items-center gap-2 font-semibold"><Icon name="printer" size={16} /> {p.name}</h2>
					<span class="flex items-center gap-1.5 text-xs font-semibold {p.status === 'pass' ? 'text-success' : p.status === 'warn' ? 'text-[#a35f00]' : 'text-danger'}"><span class="h-2.5 w-2.5 rounded-full {dot[p.status]}"></span>{p.status === 'pass' ? 'Ready' : p.status === 'warn' ? 'Needs attention' : 'Not usable'}</span>
				</div>
				<div class="mb-2 flex items-center justify-between gap-2">
					<p class="text-xs text-muted-ink">{p.model}{#if p.ip} · {p.ip}{/if}</p>
					{#if p.occupied}<button type="button" class="btn btn-secondary btn-sm" onclick={() => free(p.id)}><Icon name="check" size={14} /> Mark as free</button>{/if}
				</div>
				<div class="divide-y divide-warm-100">
					{#each p.checks as c}{@render checkRow(c)}{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

<p class="mt-3 text-xs text-muted-ink">Last run: {new Date(report.generatedAt).toLocaleString()}. Port tests take a few seconds per printer.</p>
