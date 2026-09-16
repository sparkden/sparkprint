<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import PrinterCamera from '$lib/components/PrinterCamera.svelte';
	import { JOB_STATUS_META, fmtGrams, fmtDuration, timeAgo } from '$lib/status';
	let { data } = $props();

	const job = $derived(data.job);
	const color = $derived((job.colorRequest ?? [])[0]);
	const meta = $derived(JOB_STATUS_META[job.status] ?? { label: job.status, badge: 'badge-neutral' });
	const canCancel = $derived(!['completed', 'canceled', 'rejected', 'failed', 'awaiting_pickup'].includes(job.status));
	const active = $derived(['printing', 'sending'].includes(job.status));
	const awaitingPickup = $derived(job.status === 'awaiting_pickup');
	const canReprint = $derived(['completed', 'awaiting_pickup', 'canceled', 'failed'].includes(job.status) && (!!job.modelId || !!job.gcodeKey));
</script>

<svelte:head><title>{job.name} · SparkPrint</title></svelte:head>

<div class="mx-auto max-w-4xl">
	<a href="/app/jobs" class="mb-4 inline-flex items-center gap-1 text-sm text-muted-ink hover:text-ink">
		<Icon name="chevronRight" size={14} class="rotate-180" /> My prints
	</a>

	<div class="grid gap-6 md:grid-cols-5">
		<!-- Preview -->
		<div class="md:col-span-2">
			{#if job.finishPhotoKey}
				<!-- Real photo from the printer's camera near the end of the print. -->
				<div class="card overflow-hidden bg-[#161616]">
					<img src="/files/{job.id}/finish-photo" alt="Your print on the bed" class="block h-64 w-full object-cover" />
					<p class="px-3 py-1.5 text-xs text-muted-ink">📷 Photo from the printer — {awaitingPickup ? 'ready to pick up' : 'near the end of the print'}</p>
				</div>
			{:else}
				<div class="card flex h-64 items-center justify-center overflow-hidden bg-soft-paper">
					{#if job.modelId && data.thumbnailKey}
						<img src="/files/{job.modelId}/thumb" alt={job.name} class="h-full w-full object-contain" />
					{:else}
						<Icon name="box" size={48} class="text-faint-ink" />
					{/if}
				</div>
			{/if}
		</div>

		<!-- Details -->
		<div class="md:col-span-3">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h1 class="text-2xl font-semibold">{job.name}</h1>
					{#if data.isStaff && !data.isOwner}<p class="mt-1 text-sm text-muted-ink">by {data.ownerName}</p>{/if}
				</div>
				<span class="badge {meta.badge}">{meta.label}</span>
			</div>

			<dl class="mt-5 grid grid-cols-2 gap-4 text-sm">
				<div>
					<dt class="text-muted-ink">Color</dt>
					<dd class="mt-0.5 flex items-center gap-2 font-medium text-ink">
						{#if color}<span class="h-4 w-4 rounded border border-warm-300" style="background:{color.colorHex}"></span>{color.colorName ?? color.colorHex}{:else}—{/if}
					</dd>
				</div>
				<div><dt class="text-muted-ink">Material</dt><dd class="mt-0.5 font-medium text-ink">{color?.filamentType ?? 'PLA'}</dd></div>
				<div><dt class="text-muted-ink">Filament</dt><dd class="mt-0.5 font-medium text-ink">{fmtGrams(job.estimatedGrams)}{job.copies > 1 ? ` · ${job.copies} copies` : ''}</dd></div>
				<div><dt class="text-muted-ink">Est. time</dt><dd class="mt-0.5 font-medium text-ink">{fmtDuration(job.estimatedTimeSec)}</dd></div>
				<div><dt class="text-muted-ink">Quality</dt><dd class="mt-0.5 font-medium text-ink">{job.layerHeightMm} mm · {job.infillPct}% infill</dd></div>
				<div><dt class="text-muted-ink">Est. cost</dt><dd class="mt-0.5 font-medium text-ink">{job.estimatedCost ? `$${job.estimatedCost}` : '—'}</dd></div>
				{#if data.printerName}<div class="col-span-2"><dt class="text-muted-ink">Printer</dt><dd class="mt-0.5 font-medium text-ink">{data.printerName}</dd></div>{/if}
			</dl>

			{#if active && job.printerId}
				<div class="mt-5 rounded-xl border border-spark/20 bg-spark-soft/40 p-4">
					<p class="text-sm font-semibold text-spark-deep">Printing now on {data.printerName}</p>
					<div class="mt-3"><PrinterCamera printerId={job.printerId} label="Watch your print" /></div>
				</div>
			{/if}

			{#if awaitingPickup}
				<div class="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-4">
					<p class="text-sm font-semibold text-[#9c5a00]">Done printing on {data.printerName} — grab it off the bed 🎉</p>
					<p class="mt-1 text-xs text-[#9c5a00]/90">The printer stays reserved until you check the print out, so no one prints on top of it.</p>
					<form method="POST" action="?/checkout" use:enhance class="mt-3">
						<button class="btn btn-primary btn-sm"><Icon name="check" size={15} /> I picked it up — check out</button>
					</form>
				</div>
			{/if}

			{#if job.status === 'rejected' && job.approvalNote}
				<div class="mt-5 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
					<span class="font-semibold">Rejected:</span> {job.approvalNote}
				</div>
			{/if}

			<div class="mt-6 flex flex-wrap gap-2">
				{#if canReprint}
					<form method="POST" action="?/reprint" use:enhance>
						<button class="btn btn-primary btn-sm"><Icon name="refresh" size={15} /> Reprint</button>
					</form>
				{/if}
				{#if canCancel}
					<form method="POST" action="?/cancel" use:enhance>
						<button class="btn btn-secondary btn-sm">Cancel print</button>
					</form>
				{/if}
				{#if data.isStaff && active}
					<form method="POST" action="?/complete" use:enhance>
						<button class="btn btn-ghost btn-sm" title="Mark the print finished"><Icon name="check" size={15} /> Mark finished</button>
					</form>
				{/if}
			</div>
		</div>
	</div>

	<!-- Timeline -->
	<div class="card mt-6 p-6">
		<h2 class="mb-4 text-lg font-semibold">Timeline</h2>
		<ol class="relative space-y-4 border-l border-warm-200 pl-5">
			{#each data.events as ev}
				<li class="relative">
					<span class="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-surface bg-spark"></span>
					<p class="text-sm font-medium text-ink">{ev.message ?? ev.type}</p>
					<p class="text-xs text-muted-ink">{ev.actorName ? `${ev.actorName} · ` : ''}{timeAgo(ev.createdAt)}</p>
				</li>
			{:else}
				<li class="text-sm text-muted-ink">No events yet.</li>
			{/each}
		</ol>
	</div>
</div>
