<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { JOB_STATUS_META, PRINTER_STATUS_META, timeAgo } from '$lib/status';
	let { data } = $props();

	const stats = $derived([
		{ icon: 'printer', label: 'Printers online', value: `${data.onlinePrinters}/${data.printers.length}`, href: '/admin/printers' },
		{ icon: 'users', label: 'Members', value: data.memberCount, href: '/admin/members' },
		{ icon: 'layers', label: 'Prints this month', value: data.jobsThisMonth, href: '/admin/queue' },
		{ icon: 'spool', label: 'Filament this month', value: `${data.gramsThisMonth} g`, href: '/admin/inventory' }
	]);
</script>

<svelte:head><title>Overview · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Lab overview</h1>
		<p class="mt-1 text-sm text-soft-ink">{data.user.orgName}</p>
	</div>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each stats as s}
			<a href={s.href} class="card flex items-center gap-4 p-5 transition-shadow hover:shadow-md">
				<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-spark-soft text-spark-deep">
					<Icon name={s.icon} size={22} />
				</div>
				<div>
					<p class="text-2xl font-semibold text-ink">{s.value}</p>
					<p class="text-sm text-muted-ink">{s.label}</p>
				</div>
			</a>
		{/each}
	</div>

	<div class="grid gap-6 lg:grid-cols-3">
		<!-- Printer fleet -->
		<div class="card p-6 lg:col-span-2">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-lg font-semibold">Printer fleet</h2>
				<a href="/admin/printers" class="text-sm font-semibold text-spark hover:underline">Manage</a>
			</div>
			{#if data.printers.length === 0}
				<div class="flex flex-col items-center justify-center py-10 text-center">
					<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink">
						<Icon name="printer" size={24} />
					</div>
					<p class="text-sm text-soft-ink">No printers yet. Connect a Bambu account to add printers.</p>
					<a href="/admin/printers" class="btn btn-primary btn-sm mt-4">Add printers</a>
				</div>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2">
					{#each data.printers as p}
						<div class="rounded-xl border border-warm-200 p-4">
							<div class="flex items-start justify-between">
								<div>
									<p class="font-semibold text-ink">{p.name}</p>
									<p class="text-xs text-muted-ink">{p.model}{p.location ? ` · ${p.location}` : ''}</p>
								</div>
								<span class="badge {PRINTER_STATUS_META[p.status]?.badge ?? 'badge-neutral'}">
									{PRINTER_STATUS_META[p.status]?.label ?? p.status}
								</span>
							</div>
							{#if p.status === 'printing' && p.progressPct != null}
								<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-warm-100">
									<div class="h-full rounded-full bg-spark" style="width: {p.progressPct}%"></div>
								</div>
								<p class="mt-1 text-xs text-muted-ink">{p.progressPct}%</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Activity -->
		<div class="card p-6">
			<h2 class="mb-4 text-lg font-semibold">Recent activity</h2>
			{#if data.recentJobs.length === 0}
				<p class="py-8 text-center text-sm text-muted-ink">No activity yet.</p>
			{:else}
				<ul class="space-y-3">
					{#each data.recentJobs as job}
						<li class="flex items-start gap-3">
							<div class="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full" style="background: {JOB_STATUS_META[job.status]?.tone ?? '#8a7e72'}"></div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-ink">{job.name}</p>
								<p class="text-xs text-muted-ink">{job.userName} · {JOB_STATUS_META[job.status]?.label ?? job.status} · {timeAgo(job.createdAt)}</p>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</div>
