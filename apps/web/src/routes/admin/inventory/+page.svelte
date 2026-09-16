<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();

	let open = $state(false);
	let editing = $state<null | (typeof data.filaments)[number]>(null);

	function add() { editing = null; open = true; }
	function edit(f: (typeof data.filaments)[number]) { editing = f; open = true; }

	function low(f: (typeof data.filaments)[number]) {
		return f.gramsInStock != null && f.lowStockThresholdG != null && f.gramsInStock <= f.lowStockThresholdG;
	}
	const totalValue = $derived(
		data.filaments.reduce((sum, f) => sum + (f.gramsInStock ?? 0) / 1000 * Number(f.costPerKg ?? 0), 0)
	);
</script>

<svelte:head><title>Filament · LataPrint Admin</title></svelte:head>

<div class="mx-auto max-w-5xl">
	<PageHeader title="Filament inventory" subtitle="Track spools, colors, and cost across the lab · est. value ${totalValue.toFixed(0)}">
		{#snippet actions()}
			<button class="btn btn-primary btn-sm" onclick={add}><Icon name="plus" size={16} /> Add filament</button>
		{/snippet}
	</PageHeader>

	{#if form?.error}<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>{/if}

	{#if data.filaments.length === 0}
		<div class="card flex flex-col items-center justify-center p-12 text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink"><Icon name="spool" size={24} /></div>
			<p class="text-sm text-soft-ink">No filament tracked yet.</p>
			<button class="btn btn-primary btn-sm mt-4" onclick={add}>Add your first spool</button>
		</div>
	{:else}
		<div class="card overflow-hidden">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b border-warm-200 bg-soft-paper text-left text-xs uppercase tracking-wide text-muted-ink">
						<tr><th class="px-5 py-3">Filament</th><th class="px-5 py-3">Type</th><th class="px-5 py-3">Stock</th><th class="px-5 py-3">$/kg</th><th class="px-5 py-3"></th></tr>
					</thead>
					<tbody class="divide-y divide-warm-200">
						{#each data.filaments as f}
							<tr class="hover:bg-soft-paper/50">
								<td class="px-5 py-3">
									<div class="flex items-center gap-3">
										<span class="h-7 w-7 flex-shrink-0 rounded-md border border-warm-300" style="background:{f.colorHex}"></span>
										<div><p class="font-medium text-ink">{f.name}</p><p class="text-xs text-muted-ink">{f.brand}</p></div>
									</div>
								</td>
								<td class="px-5 py-3 text-soft-ink">{f.type}</td>
								<td class="px-5 py-3">
									{#if f.gramsInStock != null}
										<span class="{low(f) ? 'font-semibold text-danger' : 'text-soft-ink'}">{f.gramsInStock} g</span>
										{#if low(f)}<span class="badge badge-danger ml-1">Low</span>{/if}
									{:else}<span class="text-muted-ink">—</span>{/if}
								</td>
								<td class="px-5 py-3 text-soft-ink">{f.costPerKg ? `$${f.costPerKg}` : '—'}</td>
								<td class="px-5 py-3 text-right">
									<button class="btn btn-secondary btn-sm" onclick={() => edit(f)}>Edit</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<Modal bind:open title={editing ? 'Edit filament' : 'Add filament'}>
	<form method="POST" action={editing ? '?/update' : '?/create'} use:enhance={() => {
		return async ({ update, result }) => { await update(); if (result.type === 'success') open = false; };
	}} class="space-y-4">
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<div class="grid gap-4 sm:grid-cols-2">
			<div><label class="label" for="fn">Name</label><input class="input" id="fn" name="name" value={editing?.name ?? ''} placeholder="Matte Black" required /></div>
			<div><label class="label" for="ft">Type</label>
				<select class="select" id="ft" name="type" value={editing?.type ?? 'PLA'}>
					{#each ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'PA', 'PC', 'Support'] as t}<option value={t}>{t}</option>{/each}
				</select>
			</div>
			<div><label class="label" for="fb">Brand</label><input class="input" id="fb" name="brand" value={editing?.brand ?? 'Bambu'} required /></div>
			<div>
				<label class="label" for="fc">Color</label>
				<input class="h-[42px] w-full cursor-pointer rounded-lg border border-warm-300 bg-transparent" id="fc" name="colorHex" type="color" value={editing?.colorHex ?? '#161616'} />
			</div>
			<div><label class="label" for="fs">In stock (g)</label><input class="input" id="fs" name="gramsInStock" type="number" min="0" value={editing?.gramsInStock ?? ''} placeholder="Not tracked" /></div>
			<div><label class="label" for="fl">Low-stock alert (g)</label><input class="input" id="fl" name="lowStockThresholdG" type="number" min="0" value={editing?.lowStockThresholdG ?? ''} placeholder="Optional" /></div>
			<div><label class="label" for="fk">Cost ($/kg)</label><input class="input" id="fk" name="costPerKg" type="number" step="0.01" min="0" value={editing?.costPerKg ?? ''} placeholder="Lab default" /></div>
		</div>
		<div class="flex items-center justify-between pt-2">
			{#if editing}
				<button type="submit" formaction="?/remove" class="btn btn-ghost btn-sm text-danger"><Icon name="trash" size={15} /> Remove</button>
			{:else}<span></span>{/if}
			<div class="flex gap-2">
				<button type="button" class="btn btn-secondary" onclick={() => (open = false)}>Cancel</button>
				<button class="btn btn-primary">{editing ? 'Save' : 'Add'}</button>
			</div>
		</div>
	</form>
</Modal>
