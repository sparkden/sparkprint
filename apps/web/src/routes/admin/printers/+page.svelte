<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { PRINTER_STATUS_META } from '$lib/status';
	import { BAMBU_MODELS } from '$lib/bambuModels';
	let { data, form } = $props();

	let connectOpen = $state(false);
	let addOpen = $state(false);

	// Cloud connect is two-step: login → (maybe) verification code.
	let showCode = $state(false);
	let pendingEmail = $state('');
	let pendingRegion = $state('us');
	$effect(() => {
		if (form?.needCode) {
			showCode = true;
			pendingEmail = form.email ?? '';
			pendingRegion = form.region ?? 'us';
			connectOpen = true;
		}
	});
	function resetConnect() {
		showCode = false;
	}
</script>

<svelte:head><title>Printers · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-5xl">
	<PageHeader title="Printers" subtitle="{data.printers.length} printer{data.printers.length === 1 ? '' : 's'} · {data.printers.filter((p) => p.online).length} online">
		{#snippet actions()}
			<form method="POST" action="?/refresh" use:enhance style="display:inline">
				<button class="btn btn-ghost btn-sm" title="Refresh from Bambu"><Icon name="refresh" size={16} /></button>
			</form>
			<button class="btn btn-secondary btn-sm" onclick={() => (addOpen = true)}><Icon name="plus" size={16} /> Add manually</button>
			<button class="btn btn-primary btn-sm" onclick={() => (connectOpen = true)}><Icon name="link" size={16} /> Connect Bambu</button>
		{/snippet}
	</PageHeader>

	{#if form?.message}
		<div class="mb-4 rounded-lg border border-success/30 bg-success/5 px-3.5 py-2.5 text-sm text-success">{form.message}</div>
	{:else if form?.error}
		<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>
	{/if}

	{#if data.printers.length === 0}
		<div class="card flex flex-col items-center justify-center p-12 text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink"><Icon name="printer" size={24} /></div>
			<p class="text-sm text-soft-ink">No printers yet.</p>
			<p class="mt-1 text-xs text-muted-ink">Connect your school's Bambu account to import them automatically.</p>
			<button class="btn btn-primary btn-sm mt-4" onclick={() => (connectOpen = true)}>Connect Bambu account</button>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.printers as p}
				<div class="card p-5 {p.enabled && p.printable ? '' : 'opacity-60'}">
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
								<span class="badge badge-neutral" title="Bambu's cloud can't print to this model yet (combo/laser machine). It's kept out of the print queue automatically.">Cloud printing unsupported</span>
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

					<div class="mt-3 flex items-center justify-between border-t border-warm-200 pt-3 text-xs">
						<span class="text-muted-ink">Priority <span class="font-semibold text-ink">{p.priority}</span> <span class="text-faint-ink">(higher = used first)</span></span>
						<div class="flex gap-1">
							<form method="POST" action="?/setPriority" use:enhance><input type="hidden" name="id" value={p.id} /><input type="hidden" name="priority" value={p.priority + 1} /><button class="rounded border border-warm-300 px-2 py-0.5 hover:bg-warm-100" title="Raise priority">▲</button></form>
							<form method="POST" action="?/setPriority" use:enhance><input type="hidden" name="id" value={p.id} /><input type="hidden" name="priority" value={Math.max(0, p.priority - 1)} /><button class="rounded border border-warm-300 px-2 py-0.5 hover:bg-warm-100" title="Lower priority">▼</button></form>
						</div>
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
							<button class="btn btn-ghost btn-sm cursor-not-allowed opacity-60" disabled title="This model can't be cloud-printed yet, so it's excluded automatically.">Excluded</button>
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

<!-- Connect Bambu -->
<Modal bind:open={connectOpen} title="Connect Bambu account">
	{#if showCode}
		<!-- Cloud step 2: verification code -->
		<p class="-mt-2 mb-4 text-sm text-soft-ink">Enter the verification code Bambu emailed to <span class="font-semibold text-ink">{pendingEmail}</span>.</p>
		<form method="POST" action="?/bambuVerify" use:enhance={() => {
			return async ({ update, result }) => { await update(); if (result.type === 'success') { connectOpen = false; resetConnect(); } };
		}} class="space-y-4">
			<input type="hidden" name="email" value={pendingEmail} />
			<input type="hidden" name="region" value={pendingRegion} />
			<div>
				<label class="label" for="code">Verification code</label>
				<input class="input tracking-widest" id="code" name="code" inputmode="numeric" placeholder="123456" autocomplete="one-time-code" required />
			</div>
			{#if form?.error}<p class="text-sm text-danger">{form.error}</p>{/if}
			<div class="flex justify-between gap-2 pt-2">
				<button type="button" class="btn btn-ghost" onclick={resetConnect}>← Back</button>
				<button class="btn btn-primary">Verify & import</button>
			</div>
		</form>
	{:else}
		<!-- Cloud step 1: credentials -->
		<p class="-mt-2 mb-3 text-sm text-soft-ink">Sign in with your school's Bambu Lab account to import every printer and its AMS, and stream live status.</p>
		<div class="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-[#a35f00]">
			⚠ Bambu allows one active session per account — connecting here may sign out the Bambu Handy app. Use a <strong>dedicated lab account</strong> to avoid disruption.
		</div>
		<form method="POST" action="?/bambuLogin" use:enhance={() => {
			return async ({ update, result }) => { await update(); if (result.type === 'success') connectOpen = false; };
		}} class="space-y-4">
			<div>
				<label class="label" for="be">Bambu account email</label>
				<input class="input" id="be" name="email" type="email" placeholder="lab@school.edu" required />
			</div>
			<div>
				<label class="label" for="bp">Password</label>
				<input class="input" id="bp" name="password" type="password" required />
			</div>
			<div>
				<label class="label" for="br">Region</label>
				<select class="select" id="br" name="region"><option value="us">United States / Global</option><option value="eu">Europe</option><option value="cn">China</option></select>
			</div>
			{#if form?.error}<p class="text-sm text-danger">{form.error}</p>{/if}
			<div class="flex justify-end gap-2 pt-2">
				<button type="button" class="btn btn-secondary" onclick={() => (connectOpen = false)}>Cancel</button>
				<button class="btn btn-primary">Sign in & import</button>
			</div>
		</form>
	{/if}
</Modal>

<!-- Add manual -->
<Modal bind:open={addOpen} title="Add a printer manually">
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
			<div><label class="label" for="pl">Location</label><input class="input" id="pl" name="location" placeholder="Room 204" /></div>
			<div><label class="label" for="pa">Access code <span class="font-normal text-muted-ink">(LAN)</span></label><input class="input" id="pa" name="accessCode" placeholder="Optional" /></div>
			<div><label class="label" for="pc">AMS units</label>
				<select class="select" id="pc" name="amsCount"><option value="0">None</option><option value="1">1 (4 slots)</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select>
			</div>
		</div>
		<div class="flex justify-end gap-2 pt-2">
			<button type="button" class="btn btn-secondary" onclick={() => (addOpen = false)}>Cancel</button>
			<button class="btn btn-primary">Add printer</button>
		</div>
	</form>
</Modal>
