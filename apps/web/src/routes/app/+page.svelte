<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import QuotaMeter from '$lib/components/QuotaMeter.svelte';
	import { JOB_STATUS_META, fmtGrams, timeAgo } from '$lib/status';
	let { data } = $props();

	const firstName = $derived(data.user.name.split(' ')[0]);
</script>

<svelte:head><title>Home · LataPrint</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">Hi, {firstName} 👋</h1>
			<p class="mt-1 text-sm text-soft-ink">Ready to make something?</p>
		</div>
		<a href="/app/design" class="btn btn-primary"><Icon name="plus" size={16} /> New print</a>
	</div>

	<!-- Stat row -->
	<div class="grid gap-4 sm:grid-cols-3">
		<div class="card flex items-center gap-4 p-5">
			<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-spark-soft text-spark-deep">
				<Icon name="printer" size={22} />
			</div>
			<div>
				<p class="text-2xl font-semibold text-ink">{data.available}<span class="text-base font-normal text-muted-ink">/{data.printerCount}</span></p>
				<p class="text-sm text-muted-ink">Printers available</p>
			</div>
		</div>
		<div class="card flex items-center gap-4 p-5">
			<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-spark-soft text-spark-deep">
				<Icon name="layers" size={22} />
			</div>
			<div>
				<p class="text-2xl font-semibold text-ink">{data.activeCount}</p>
				<p class="text-sm text-muted-ink">Active prints</p>
			</div>
		</div>
		<div class="card flex items-center gap-4 p-5">
			<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-spark-soft text-spark-deep">
				<Icon name="spool" size={22} />
			</div>
			<div>
				<p class="text-2xl font-semibold text-ink">{data.usage.gramsUsed} g</p>
				<p class="text-sm text-muted-ink">Used this month</p>
			</div>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-3">
		<!-- Quota -->
		<div class="card space-y-5 p-6 lg:col-span-1">
			<h2 class="text-lg font-semibold">Your quota</h2>
			<QuotaMeter label="Filament" used={data.usage.gramsUsed} limit={data.usage.gramLimit} unit=" g" />
			<QuotaMeter label="Prints" used={data.usage.jobsUsed} limit={data.usage.jobLimit} />
			<p class="text-xs text-muted-ink">Resets on the 1st of each month.</p>
		</div>

		<!-- Recent -->
		<div class="card p-6 lg:col-span-2">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-lg font-semibold">Recent prints</h2>
				<a href="/app/jobs" class="text-sm font-semibold text-spark hover:underline">View all</a>
			</div>
			{#if data.recent.length === 0}
				<div class="flex flex-col items-center justify-center py-10 text-center">
					<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink">
						<Icon name="box" size={24} />
					</div>
					<p class="text-sm text-soft-ink">No prints yet.</p>
					<a href="/app/design" class="btn btn-primary btn-sm mt-4">Start your first print</a>
				</div>
			{:else}
				<ul class="divide-y divide-warm-200">
					{#each data.recent as job}
						<li class="flex items-center gap-3 py-3">
							<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-warm-100 text-soft-ink">
								<Icon name="layers" size={18} />
							</div>
							<div class="min-w-0 flex-1">
								<a href="/app/jobs/{job.id}" class="truncate text-sm font-medium text-ink hover:text-spark">{job.name}</a>
								<p class="text-xs text-muted-ink">{fmtGrams(job.estimatedGrams)} · {timeAgo(job.createdAt)}</p>
							</div>
							<span class="badge {JOB_STATUS_META[job.status]?.badge ?? 'badge-neutral'}">
								{JOB_STATUS_META[job.status]?.label ?? job.status}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</div>
