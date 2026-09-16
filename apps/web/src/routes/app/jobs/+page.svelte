<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { JOB_STATUS_META, fmtGrams, fmtDuration, timeAgo } from '$lib/status';
	let { data } = $props();
</script>

<svelte:head><title>My prints · LataPrint</title></svelte:head>

<div class="mx-auto max-w-5xl">
	<PageHeader title="My prints" subtitle="{data.jobs.length} total">
		{#snippet actions()}
			<a href="/app/design" class="btn btn-primary btn-sm"><Icon name="plus" size={16} /> New print</a>
		{/snippet}
	</PageHeader>

	{#if data.jobs.length === 0}
		<div class="card flex flex-col items-center justify-center p-12 text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink"><Icon name="layers" size={24} /></div>
			<p class="text-sm text-soft-ink">You haven't printed anything yet.</p>
			<a href="/app/design" class="btn btn-primary btn-sm mt-4">Start your first print</a>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.jobs as job}
				{@const color = (job.colorRequest ?? [])[0]}
				<a href="/app/jobs/{job.id}" class="card overflow-hidden transition-shadow hover:shadow-md">
					<div class="relative flex h-40 items-center justify-center bg-soft-paper">
						{#if job.modelId && job.thumbnailKey}
							<img src="/files/{job.modelId}/thumb" alt={job.name} class="h-full w-full object-contain" />
						{:else}
							<Icon name="box" size={40} class="text-faint-ink" />
						{/if}
						<span class="badge {JOB_STATUS_META[job.status]?.badge ?? 'badge-neutral'} absolute left-3 top-3">{JOB_STATUS_META[job.status]?.label ?? job.status}</span>
					</div>
					<div class="p-4">
						<div class="flex items-center gap-2">
							{#if color}<span class="h-4 w-4 flex-shrink-0 rounded border border-warm-300" style="background:{color.colorHex}"></span>{/if}
							<p class="truncate font-semibold text-ink">{job.name}</p>
						</div>
						<div class="mt-1.5 flex items-center justify-between text-xs text-muted-ink">
							<span>{fmtGrams(job.estimatedGrams)} · {fmtDuration(job.estimatedTimeSec)}</span>
							<span>{timeAgo(job.createdAt)}</span>
						</div>
						{#if job.printerName}<p class="mt-1 text-xs text-muted-ink">On {job.printerName}</p>{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
