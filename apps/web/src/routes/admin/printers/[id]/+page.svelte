<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();

	type Slot = (typeof data.units)[number]['slots'][number];
	let editing = $state<null | (Slot & { amsIndex: number })>(null);
	let open = $state(false);

	// Local editable state for the modal
	let colorHex = $state('#161616');
	let colorName = $state('');
	let filamentType = $state('PLA');
	let filamentBrand = $state('Bambu');
	let remainingPct = $state<number | ''>(100);
	let empty = $state(false);

	function editSlot(slot: Slot, amsIndex: number) {
		editing = { ...slot, amsIndex };
		colorHex = slot.colorHex ?? '#161616';
		colorName = slot.colorName ?? '';
		filamentType = slot.filamentType ?? 'PLA';
		filamentBrand = slot.filamentBrand ?? 'Bambu';
		remainingPct = slot.remainingPct ?? 100;
		empty = slot.empty;
		open = true;
	}
	function pick(c: { name: string; hex: string }) {
		colorHex = c.hex;
		colorName = c.name;
		empty = false;
	}
	const FILAMENTS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'PA', 'PC', 'Support'];
</script>

<svelte:head><title>Map colors · {data.printer.name}</title></svelte:head>

<div class="mx-auto max-w-4xl">
	<a href="/admin/printers" class="mb-4 inline-flex items-center gap-1 text-sm text-muted-ink hover:text-ink">
		<Icon name="chevronRight" size={14} class="rotate-180" /> Printers
	</a>
	<PageHeader title="{data.printer.name}" subtitle="Map each AMS slot to the filament and color that's loaded.">
		{#snippet actions()}
			{#if data.printer.status === 'finished' || data.printer.currentJobId}
				<form method="POST" action="?/markFree" use:enhance style="display:inline">
					<button class="btn btn-secondary btn-sm" title="Bed cleared — free this printer for new jobs"><Icon name="check" size={15} /> Mark as free</button>
				</form>
			{/if}
			<form method="POST" action="?/reloadAms" use:enhance style="display:inline">
				<button class="btn btn-ghost btn-sm" title="Pull live AMS from the printer"><Icon name="refresh" size={15} /> Reload</button>
			</form>
			<form method="POST" action="?/addAms" use:enhance style="display:inline">
				<button class="btn btn-secondary btn-sm"><Icon name="plus" size={15} /> Add AMS</button>
			</form>
		{/snippet}
	</PageHeader>

	{#if form?.message}<div class="mb-4 rounded-lg border border-success/30 bg-success/5 px-3.5 py-2.5 text-sm text-success">{form.message}</div>{/if}
	{#if form?.error}<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>{/if}

	<!-- External spool — the single-color path for printers without an AMS (or the external tray). -->
	<div class="card mb-6 p-6">
		<div class="mb-3 flex items-center justify-between gap-3">
			<div>
				<h2 class="text-lg font-semibold">External spool</h2>
				<p class="text-sm text-muted-ink">For printers without an AMS — set the color that's loaded on the spool holder.</p>
			</div>
			{#if data.externalSpool && !data.externalSpool.empty}
				<span class="inline-flex items-center gap-2 text-sm"><span class="h-6 w-6 rounded-md border border-warm-300" style="background:{data.externalSpool.colorHex}"></span>{data.externalSpool.colorName ?? data.externalSpool.colorHex} · {data.externalSpool.filamentType}</span>
			{/if}
		</div>
		<form method="POST" action="?/setSpool" use:enhance class="flex flex-wrap items-end gap-3">
			<label class="text-sm">Color
				<input class="input mt-1 h-10 w-16 p-1" type="color" name="colorHex" value={data.externalSpool?.colorHex ?? '#FF5B14'} />
			</label>
			<label class="text-sm">Material
				<select class="select mt-1" name="filamentType" value={data.externalSpool?.filamentType ?? 'PLA'}>
					{#each ['PLA', 'PLA Matte', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PA-CF'] as t}<option value={t}>{t}</option>{/each}
				</select>
			</label>
			<label class="text-sm">Name <span class="text-muted-ink">(optional)</span>
				<input class="input mt-1" name="colorName" placeholder="e.g. Spark Orange" value={data.externalSpool?.colorName ?? ''} />
			</label>
			<button class="btn btn-primary btn-sm">Save spool</button>
			{#if data.externalSpool && !data.externalSpool.empty}
				<button class="btn btn-ghost btn-sm text-danger" formaction="?/setSpool" name="clear" value="true">Clear</button>
			{/if}
		</form>
	</div>

	{#if data.units.length === 0}
		<div class="card flex flex-col items-center gap-3 p-10 text-center">
			<p class="text-sm text-soft-ink">No AMS units yet. They import automatically from the printer, or add one to set colors manually.</p>
			<form method="POST" action="?/addAms" use:enhance><button class="btn btn-primary btn-sm"><Icon name="plus" size={15} /> Add AMS unit</button></form>
		</div>
	{:else}
		<div class="space-y-6">
			{#each data.units as unit}
				<div class="card p-6">
					<div class="mb-4 flex items-center justify-between">
						<h2 class="text-lg font-semibold">AMS {unit.amsIndex + 1}</h2>
						<div class="flex items-center gap-3">
							<span class="text-xs text-muted-ink">
								{#if unit.humidity != null}Humidity {unit.humidity}%{/if}
								{#if unit.temperature != null} · {unit.temperature}°C{/if}
							</span>
							<form method="POST" action="?/removeAms" use:enhance>
								<input type="hidden" name="unitId" value={unit.id} />
								<button class="btn btn-ghost btn-sm text-danger" title="Remove this AMS"><Icon name="trash" size={14} /></button>
							</form>
						</div>
					</div>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{#each unit.slots as slot}
							<button
								class="rounded-xl border border-warm-200 p-3 text-left transition-shadow hover:shadow-md"
								onclick={() => editSlot(slot, unit.amsIndex)}
							>
								<div class="flex items-center gap-2">
									<div class="h-9 w-9 flex-shrink-0 rounded-lg border border-warm-300 {slot.empty ? 'bg-warm-100' : ''}" style={slot.empty ? '' : `background:${slot.colorHex}`}></div>
									<div class="min-w-0">
										<p class="truncate text-sm font-semibold text-ink">
											{slot.empty ? 'Empty' : (slot.colorName ?? slot.colorHex ?? 'Set color')}
										</p>
										<p class="text-xs text-muted-ink">
											Slot {slot.slotIndex + 1}{slot.empty ? '' : ` · ${slot.filamentType ?? 'PLA'}`}
										</p>
									</div>
								</div>
								{#if !slot.empty && slot.remainingPct != null}
									<div class="mt-2 h-1 overflow-hidden rounded-full bg-warm-100">
										<div class="h-full rounded-full bg-spark" style="width:{slot.remainingPct}%"></div>
									</div>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if editing}
	<Modal bind:open title="AMS {editing.amsIndex + 1} · Slot {editing.slotIndex + 1}">
		<form method="POST" action="?/saveSlot" use:enhance={() => {
			return async ({ update, result }) => { await update({ reset: false }); if (result.type === 'success') open = false; };
		}} class="space-y-5">
			<input type="hidden" name="slotId" value={editing.id} />
			<input type="hidden" name="colorHex" value={colorHex} />
			<input type="hidden" name="colorName" value={colorName} />
			<input type="hidden" name="empty" value={empty.toString()} />

			<label class="flex items-center gap-2 text-sm font-medium text-soft-ink">
				<input type="checkbox" bind:checked={empty} class="h-4 w-4 rounded accent-[#FF5B14]" /> Slot is empty
			</label>

			{#if !empty}
				<!-- Palette -->
				<div>
					<p class="label">Color</p>
					<div class="flex flex-wrap gap-2">
						{#each data.palette as c}
							<button type="button" title={c.name} onclick={() => pick(c)}
								class="h-8 w-8 rounded-lg border-2 transition-transform hover:scale-110 {colorHex.toLowerCase() === c.hex.toLowerCase() ? 'border-ink' : 'border-warm-300'}"
								style="background:{c.hex}"></button>
						{/each}
					</div>
					<div class="mt-3 flex items-center gap-3">
						<input type="color" bind:value={colorHex} class="h-10 w-12 cursor-pointer rounded border border-warm-300 bg-transparent" />
						<input class="input flex-1" bind:value={colorName} placeholder="Color name (e.g. Sunflower Yellow)" />
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="label" for="ft">Filament type</label>
						<select class="select" id="ft" name="filamentType" bind:value={filamentType}>
							{#each FILAMENTS as f}<option value={f}>{f}</option>{/each}
						</select>
					</div>
					<div>
						<label class="label" for="fb">Brand</label>
						<input class="input" id="fb" name="filamentBrand" bind:value={filamentBrand} />
					</div>
					<div class="sm:col-span-2">
						<label class="label" for="rp">Remaining ({remainingPct === '' ? '—' : remainingPct}%)</label>
						<input class="w-full accent-[#FF5B14]" id="rp" name="remainingPct" type="range" min="0" max="100" bind:value={remainingPct} />
					</div>
				</div>
			{/if}

			<div class="flex items-center justify-between pt-2">
				{#if !empty}
					<button type="submit" formaction="?/unloadFilament" class="btn btn-ghost btn-sm text-danger" title="Unload this filament from the AMS">Unload filament</button>
				{:else}<span></span>{/if}
				<div class="flex gap-2">
					<button type="button" class="btn btn-secondary" onclick={() => (open = false)}>Cancel</button>
					<button class="btn btn-primary">Save slot</button>
				</div>
			</div>
		</form>
	</Modal>
{/if}
