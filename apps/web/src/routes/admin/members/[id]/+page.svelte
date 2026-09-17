<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { JOB_STATUS_META, fmtGrams, timeAgo } from '$lib/status';
	let { data } = $props();
	const meta = (s: string) => JOB_STATUS_META[s] ?? { label: s, badge: 'badge-neutral' };
</script>

<svelte:head><title>{data.member.name} · Members</title></svelte:head>

<div class="mx-auto max-w-4xl">
	<a href="/admin/members" class="mb-4 inline-flex items-center gap-1 text-sm text-muted-ink hover:text-ink">
		<Icon name="chevronRight" size={14} class="rotate-180" /> Members
	</a>

	<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">{data.member.name}</h1>
			<p class="text-sm text-muted-ink">{data.member.email} · <span class="capitalize">{data.member.role === 'teacher' ? 'staff' : data.member.role}</span>{#if data.member.status === 'suspended'} · <span class="text-danger">suspended</span>{/if}</p>
		</div>
	</div>

	<div class="mb-6 grid grid-cols-3 gap-3">
		<div class="card p-4 text-center"><div class="text-xs uppercase tracking-wide text-muted-ink">Prints</div><div class="mt-1 text-2xl font-bold text-ink">{data.stats.prints}</div></div>
		<div class="card p-4 text-center"><div class="text-xs uppercase tracking-wide text-muted-ink">Filament</div><div class="mt-1 text-2xl font-bold text-ink">{data.stats.grams} g</div></div>
		<div class="card p-4 text-center"><div class="text-xs uppercase tracking-wide text-muted-ink">Total cost</div><div class="mt-1 text-2xl font-bold text-ink">${data.stats.cost.toFixed(2)}</div></div>
	</div>

	<div class="card overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="border-b border-warm-200 bg-soft-paper text-left text-xs uppercase tracking-wide text-muted-ink">
					<tr>
						<th class="px-5 py-3 font-semibold">Print</th>
						<th class="px-5 py-3 font-semibold">Status</th>
						<th class="px-5 py-3 font-semibold">Filament</th>
						<th class="px-5 py-3 font-semibold">Printer</th>
						<th class="px-5 py-3 font-semibold">When</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-warm-200">
					{#each data.jobs as j}
						{@const color = (j.colorRequest ?? [])[0]?.colorHex}
						<tr class="hover:bg-soft-paper/50">
							<td class="px-5 py-3">
								<a href="/app/jobs/{j.id}" class="flex items-center gap-2 font-medium text-ink hover:text-spark">
									{#if color}<span class="h-3.5 w-3.5 rounded-full border border-warm-300" style="background:{color}"></span>{/if}
									{j.name}
								</a>
							</td>
							<td class="px-5 py-3"><span class="badge {meta(j.status).badge}">{meta(j.status).label}</span></td>
							<td class="px-5 py-3 tabular-nums text-soft-ink">{fmtGrams(Number(j.grams))}</td>
							<td class="px-5 py-3 text-soft-ink">{j.printerName ?? '—'}</td>
							<td class="px-5 py-3 text-muted-ink">{timeAgo(j.finishedAt ?? j.createdAt)}</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-5 py-10 text-center text-muted-ink">No prints yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
