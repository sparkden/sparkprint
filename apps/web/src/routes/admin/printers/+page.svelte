<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PrinterCamera from '$lib/components/PrinterCamera.svelte';
	import { PRINTER_STATUS_META } from '$lib/status';
	import { BAMBU_MODELS } from '$lib/bambuModels';
	let { data, form } = $props();

	let addOpen = $state(false);
</script>

<svelte:head><title>Printers · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-5xl">
	<PageHeader title="Printers" subtitle="{data.printers.length} printer{data.printers.length === 1 ? '' : 's'} · {data.printers.filter((p) => p.online).length} online">
		{#snippet actions()}
			<form method="POST" action="?/discoverLan" use:enhance style="display:inline">
				<button class="btn btn-secondary btn-sm" title="Scan the local network for printers (on-site only)"><Icon name="wifi" size={16} /> Discover on network</button>
			</form>
			<button class="btn btn-primary btn-sm" onclick={() => (addOpen = true)}><Icon name="plus" size={16} /> Add printer</button>
		{/snippet}
	</PageHeader>

	{#if form?.message || form?.discover || form?.lanTest}
		<div class="mb-4 rounded-lg border border-success/30 bg-success/5 px-3.5 py-2.5 text-sm text-success">{form.message ?? form.discover ?? form.lanTest}</div>
	{:else if form?.error}
		<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>
	{/if}

	{#if data.printers.length === 0}
		<div class="card flex flex-col items-center justify-center p-12 text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink"><Icon name="printer" size={24} /></div>
			<p class="text-sm text-soft-ink">No printers yet.</p>
			<p class="mt-1 text-xs text-muted-ink">Scan your network to find printers automatically, or add one by hand.</p>
			<div class="mt-4 flex gap-2">
				<form method="POST" action="?/discoverLan" use:enhance><button class="btn btn-secondary btn-sm"><Icon name="wifi" size={15} /> Discover on network</button></form>
				<button class="btn btn-primary btn-sm" onclick={() => (addOpen = true)}><Icon name="plus" size={15} /> Add printer</button>
			</div>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.printers as p}
				<div class="card card-hover p-5 {p.enabled && p.printable ? '' : 'opacity-60'}">
					<div class="flex items-start justify-between">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-spark-soft text-spark-deep"><Icon name="printer" size={20} /></div>
							<div>
								<p class="font-semibold text-ink">{p.name}</p>
								<p class="text-xs text-muted-ink">{p.model}{p.location ? ` · ${p.location}` : ''}</p>
							</div>
						</div>
						<div class="flex flex-col items-end gap-1">
							<span class="badge {PRINTER_STATUS_META[p.status]?.badge ?? 'badge-neutral'}">{PRINTER_STATUS_META[p.status]?.label ?? p.status}</span>
							{#if !p.printable}
								<span class="badge badge-neutral" title="This model isn't supported yet — H2-series dual-extruder slicing is in progress. Kept out of the print queue automatically.">Not supported yet</span>
							{:else if !p.enabled}
								<span class="badge badge-neutral" title="Manually excluded from the print queue.">Excluded</span>
							{/if}
						</div>
					</div>

					<!-- AMS color chips -->
					{#if p.slots.length > 0}
						<div class="mt-4">
							<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-ink">Loaded colors</p>
							<div class="flex flex-wrap gap-1.5">
								{#each p.slots as s}
									<div class="group relative">
										<div
											class="h-7 w-7 rounded-md border border-warm-300 {s.empty ? 'bg-warm-100' : ''}"
											style={s.empty ? '' : `background:${s.colorHex}`}
											title={s.empty ? 'Empty' : `${s.colorName ?? s.colorHex} · ${s.filamentType ?? ''}`}
										></div>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="mt-4 text-xs text-muted-ink">No AMS attached.</p>
					{/if}

					{#if p.ipAddress && p.hasAccessCode}
						<div class="mt-4"><PrinterCamera printerId={p.id} /></div>
					{/if}

					<div class="mt-3 flex items-center justify-between border-t border-warm-200 pt-3 text-xs">
						<span class="text-muted-ink">Priority <span class="font-semibold text-ink">{p.priority}</span> <span class="text-faint-ink">(higher = used first)</span></span>
						<div class="flex gap-1">
							<form method="POST" action="?/setPriority" use:enhance><input type="hidden" name="id" value={p.id} /><input type="hidden" name="priority" value={p.priority + 1} /><button class="rounded border border-warm-300 px-2 py-0.5 hover:bg-warm-100" title="Raise priority">▲</button></form>
							<form method="POST" action="?/setPriority" use:enhance><input type="hidden" name="id" value={p.id} /><input type="hidden" name="priority" value={Math.max(0, p.priority - 1)} /><button class="rounded border border-warm-300 px-2 py-0.5 hover:bg-warm-100" title="Lower priority">▼</button></form>
						</div>
					</div>

					<!-- LAN printing setup: local IP + access code (required to actually print) -->
					<div class="mt-3 border-t border-warm-200 pt-3">
						<div class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-ink">
							LAN printing
							{#if p.ipAddress && p.hasAccessCode}
								<span class="badge badge-success">Ready</span>
							{:else}
								<span class="badge badge-warning">Setup needed</span>
							{/if}
						</div>
						<form method="POST" action="?/setLan" use:enhance class="flex flex-wrap items-end gap-2 text-xs">
							<input type="hidden" name="id" value={p.id} />
							<label class="flex flex-col gap-1">
								<span class="text-muted-ink">Local IP</span>
								<input name="ipAddress" value={p.ipAddress ?? ''} placeholder="192.168.1.50" class="input" style="width:8.5rem;padding:.25rem .5rem" />
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-muted-ink">Access code{#if p.hasAccessCode} <span class="text-faint-ink">(saved)</span>{/if}</span>
								<input name="accessCode" placeholder={p.hasAccessCode ? '••••••••' : '8-char code'} class="input" style="width:7.5rem;padding:.25rem .5rem" />
							</label>
							<button class="btn btn-secondary btn-sm">Save</button>
							{#if p.ipAddress && p.hasAccessCode}
								<button formaction="?/testLan" class="btn btn-ghost btn-sm" title="Test the connection to this printer">Test</button>
							{/if}
						</form>
					</div>

					<div class="mt-3 flex items-center gap-2">
						<a href="/admin/printers/{p.id}" class="btn btn-secondary btn-sm flex-1"><Icon name="palette" size={15} /> Map colors</a>
						{#if p.printable}
							<form method="POST" action="?/toggleEnabled" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="enabled" value={(!p.enabled).toString()} />
								<button class="btn btn-ghost btn-sm" title={p.enabled ? 'Exclude this printer from the print queue' : 'Include this printer in the print queue'}>
									{p.enabled ? 'In queue' : 'Excluded'}
								</button>
							</form>
						{:else}
							<button class="btn btn-ghost btn-sm cursor-not-allowed opacity-60" disabled title="This model isn't supported yet (H2-series dual-extruder slicing in progress), so it's excluded automatically.">Excluded</button>
						{/if}
						<form method="POST" action="?/remove" use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button class="btn btn-ghost btn-sm text-danger" title="Remove"><Icon name="trash" size={15} /></button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Add printer -->
<Modal bind:open={addOpen} title="Add a printer">
	<p class="-mt-2 mb-4 text-sm text-soft-ink">Find these on the printer's screen under <span class="font-medium text-ink">Settings → Network / LAN Mode</span>. See the LAN setup guide.</p>
	<form method="POST" action="?/addManual" use:enhance={() => {
		return async ({ update, result }) => { await update(); if (result.type === 'success') addOpen = false; };
	}} class="space-y-4">
		<div class="grid gap-4 sm:grid-cols-2">
			<div><label class="label" for="pn">Name</label><input class="input" id="pn" name="name" placeholder="Lab Printer 1" required /></div>
			<div><label class="label" for="pm">Model</label>
				<select class="select" id="pm" name="model">
					{#each BAMBU_MODELS as m}<option value={m.id}>{m.label}</option>{/each}
				</select>
			</div>
			<div><label class="label" for="pd">Serial / device ID</label><input class="input" id="pd" name="devId" placeholder="01S00A..." required /></div>
			<div><label class="label" for="pi">Local IP</label><input class="input" id="pi" name="ipAddress" placeholder="192.168.1.50" /></div>
			<div class="sm:col-span-2"><label class="label" for="pa">LAN access code</label><input class="input" id="pa" name="accessCode" placeholder="8-character code" /></div>
		</div>
		{#if form?.error}<p class="text-sm text-danger">{form.error}</p>{/if}
		<div class="flex justify-end gap-2 pt-2">
			<button type="button" class="btn btn-secondary" onclick={() => (addOpen = false)}>Cancel</button>
			<button class="btn btn-primary">Add printer</button>
		</div>
	</form>
</Modal>
