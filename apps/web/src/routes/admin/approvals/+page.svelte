<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtGrams, fmtDuration, timeAgo } from '$lib/status';
	let { data, form } = $props();
</script>

<svelte:head><title>Approvals · LataPrint Admin</title></svelte:head>

<div class="mx-auto max-w-4xl">
	<PageHeader title="Approvals" subtitle="{data.pending.length} print{data.pending.length === 1 ? '' : 's'} waiting for sign-off." />

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>
	{/if}

	{#if data.pending.length === 0}
		<div class="card flex flex-col items-center justify-center p-12 text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-success/10 text-success"><Icon name="check" size={24} /></div>
			<p class="text-sm text-soft-ink">All caught up — nothing to approve.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.pending as p}
				{@const color = (p.job.colorRequest ?? [])[0]}
				{@const overQuota = p.usage.gramsRemaining != null && Number(p.job.estimatedGrams ?? 0) > p.usage.gramsRemaining}
				<div class="card flex flex-col gap-4 p-5 sm:flex-row">
					<div class="flex h-28 w-28 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-soft-paper">
						{#if p.modelId && p.thumbnailKey}
							<img src="/files/{p.modelId}/thumb" alt={p.job.name} class="h-full w-full object-contain" />
						{:else}<Icon name="box" size={36} class="text-faint-ink" />{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<a href="/app/jobs/{p.job.id}" class="font-semibold text-ink hover:text-spark">{p.job.name}</a>
							{#if color}<span class="h-4 w-4 rounded border border-warm-300" style="background:{color.colorHex}"></span>{/if}
						</div>
						<p class="mt-0.5 text-sm text-muted-ink">{p.ownerName} · {timeAgo(p.job.submittedAt)}</p>
						<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-soft-ink">
							<span>{fmtGrams(p.job.estimatedGrams)}</span>
							<span>{fmtDuration(p.job.estimatedTimeSec)}</span>
							<span>{color?.filamentType ?? 'PLA'} · {p.job.layerHeightMm}mm · {p.job.infillPct}%</span>
							{#if p.job.estimatedCost}<span>${p.job.estimatedCost}</span>{/if}
						</div>
						<p class="mt-1 text-xs {overQuota ? 'font-semibold text-danger' : 'text-muted-ink'}">
							{overQuota ? '⚠ Exceeds their remaining quota' : `Quota left: ${p.usage.gramsRemaining ?? '∞'} g`}
						</p>

						<div class="mt-3 flex flex-wrap items-end gap-2">
							<form method="POST" action="?/approve" use:enhance class="contents">
								<input type="hidden" name="jobId" value={p.job.id} />
								<button class="btn btn-primary btn-sm"><Icon name="check" size={15} /> Approve & print</button>
							</form>
							<form method="POST" action="?/reject" use:enhance class="flex items-end gap-2">
								<input type="hidden" name="jobId" value={p.job.id} />
								<input class="input btn-sm !py-1.5 w-44" name="note" placeholder="Reason (optional)" />
								<button class="btn btn-secondary btn-sm text-danger">Reject</button>
							</form>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
