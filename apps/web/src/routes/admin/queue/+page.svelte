<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { JOB_STATUS_META, fmtGrams, fmtDuration, timeAgo } from '$lib/status';
	let { data } = $props();

	function color(j: any) {
		return (j.colorRequest ?? [])[0];
	}
</script>

<svelte:head><title>Queue · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<PageHeader title="Print queue" subtitle={data.queueEnabled ? 'Jobs release to printers as they free up.' : 'Queue is off — jobs print immediately when a printer is free.'} />

	<!-- Printing now -->
	<section>
		<h2 class="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-ink">
			<span class="h-2 w-2 rounded-full bg-spark"></span> Printing now ({data.printing.length})
		</h2>
		{#if data.printing.length === 0}
			<div class="card p-5 text-sm text-muted-ink">Nothing printing right now.</div>
		{:else}
			<div class="space-y-3">
				{#each data.printing as j}
					<div class="card flex items-center gap-4 p-4">
						{#if color(j)}<span class="h-8 w-8 flex-shrink-0 rounded-lg border border-warm-300" style="background:{color(j).colorHex}"></span>{/if}
						<div class="min-w-0 flex-1">
							<a href="/app/jobs/{j.id}" class="truncate font-medium text-ink hover:text-spark">{j.name}</a>
							<p class="text-xs text-muted-ink">{j.ownerName} · {j.printerName} · {fmtGrams(j.estimatedGrams)}</p>
							<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-warm-100"><div class="h-full rounded-full bg-spark" style="width:{j.progressPct ?? 0}%"></div></div>
						</div>
						<div class="flex gap-1">
							<form method="POST" action="?/complete" use:enhance><input type="hidden" name="jobId" value={j.id} /><button class="btn btn-ghost btn-sm" title="Mark complete"><Icon name="check" size={16} /></button></form>
							<form method="POST" action="?/cancel" use:enhance><input type="hidden" name="jobId" value={j.id} /><button class="btn btn-ghost btn-sm text-danger" title="Cancel"><Icon name="x" size={16} /></button></form>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Waiting -->
	<section>
		<h2 class="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-ink">
			<Icon name="queue" size={15} /> Waiting in queue ({data.queued.length})
		</h2>
		{#if data.queued.length === 0}
			<div class="card p-5 text-sm text-muted-ink">Queue is empty.</div>
		{:else}
			<div class="card divide-y divide-warm-200">
				{#each data.queued as j, i}
					<div class="flex items-center gap-4 p-4">
						<span class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-warm-100 text-xs font-semibold text-soft-ink">{i + 1}</span>
						{#if color(j)}<span class="h-7 w-7 flex-shrink-0 rounded-lg border border-warm-300" style="background:{color(j).colorHex}"></span>{/if}
						<div class="min-w-0 flex-1">
							<a href="/app/jobs/{j.id}" class="truncate font-medium text-ink hover:text-spark">{j.name}</a>
							<p class="text-xs text-muted-ink">{j.ownerName} · {fmtGrams(j.estimatedGrams)} · {fmtDuration(j.estimatedTimeSec)}</p>
						</div>
						<span class="badge {JOB_STATUS_META[j.status]?.badge}">{JOB_STATUS_META[j.status]?.label}</span>
						<form method="POST" action="?/cancel" use:enhance><input type="hidden" name="jobId" value={j.id} /><button class="btn btn-ghost btn-sm text-danger" title="Cancel"><Icon name="x" size={16} /></button></form>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Pending approval -->
	{#if data.pending.length > 0}
		<section>
			<h2 class="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-ink">
				<Icon name="clock" size={15} /> Awaiting approval ({data.pending.length})
			</h2>
			<div class="card divide-y divide-warm-200">
				{#each data.pending as j}
					<div class="flex items-center gap-4 p-4">
						<div class="min-w-0 flex-1">
							<a href="/app/jobs/{j.id}" class="truncate font-medium text-ink hover:text-spark">{j.name}</a>
							<p class="text-xs text-muted-ink">{j.ownerName} · {timeAgo(j.submittedAt)}</p>
						</div>
						<a href="/admin/approvals" class="btn btn-secondary btn-sm">Review</a>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Recent -->
	<section>
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-ink">Recently finished</h2>
		{#if data.recent.length === 0}
			<div class="card p-5 text-sm text-muted-ink">Nothing yet.</div>
		{:else}
			<div class="card divide-y divide-warm-200">
				{#each data.recent as j}
					<div class="flex items-center gap-4 p-3.5">
						<div class="min-w-0 flex-1">
							<a href="/app/jobs/{j.id}" class="truncate text-sm font-medium text-ink hover:text-spark">{j.name}</a>
							<p class="text-xs text-muted-ink">{j.ownerName} · {fmtGrams(j.actualGrams ?? j.estimatedGrams)} · {timeAgo(j.finishedAt)}</p>
						</div>
						<span class="badge {JOB_STATUS_META[j.status]?.badge}">{JOB_STATUS_META[j.status]?.label}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
