<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import StudioEditor from '$lib/components/StudioEditor.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { modelInfo } from '$lib/bambuModels';
	import { DEFAULT_PROCESS, QUALITY_PRESETS, INFILL_PATTERNS, SEAM_OPTIONS, SPEED_OPTIONS, type Process } from '$lib/process';
	let { data, form } = $props();

	let name = $state('');
	let selected = $state<(typeof data.colors)[number] | null>(data.colors.find((c) => c.available) ?? data.colors[0] ?? null);
	let copies = $state(1);
	let printerTarget = $state('auto');
	let stats = $state<{ bbox: { x: number; y: number; z: number }; volumeMm3: number; triangles: number; objects: number } | null>(null);
	let process = $state<Process>({ ...DEFAULT_PROCESS });
	let submitting = $state(false);

	let editor: StudioEditor;
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);

	const plate = $derived(printerTarget === 'auto' ? { x: 256, y: 256, z: 256 } : modelInfo(printerTarget).bed);
	const hasModel = $derived((stats?.objects ?? 0) > 0);
	const canSubmit = $derived(hasModel && !!selected && !!name);

	function addFiles(files: FileList | null | undefined) {
		if (!files) return;
		for (const f of Array.from(files)) {
			editor?.addObject(f);
			if (!name) name = f.name.replace(/\.(stl|obj|3mf)$/i, '');
		}
	}
	function onInput(e: Event) { addFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }
	function onDrop(e: DragEvent) { e.preventDefault(); dragOver = false; addFiles(e.dataTransfer?.files); }

	$effect(() => { if (form?.success && form.jobId) goto(`/app/jobs/${form.jobId}`); });
</script>

<svelte:head><title>New print · SparkPrint</title></svelte:head>

<div class="mx-auto max-w-7xl">
	<div class="mb-5 flex items-center justify-between">
		<div><h1 class="text-2xl font-semibold">New print</h1><p class="mt-1 text-sm text-soft-ink">Import, arrange, edit, and send to the lab.</p></div>
	</div>

	{#if form?.error}<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>{/if}

	<form method="POST" action="?/submit" enctype="multipart/form-data"
		use:enhance={({ formData, cancel }) => {
			if (!canSubmit) { cancel(); return; }
			submitting = true;
			const painted = editor?.hasPaint?.() ?? false;
			const out = painted ? editor?.export3MF?.() : editor?.exportSTL?.();
			if (out) formData.set('file', out, (name || 'model') + (painted ? '.3mf' : '.stl'));
			// Painted support enforcers require support to be enabled for the slicer to honor them.
			if (editor?.hasSupportPaint?.()) process.supports = true;
			formData.set('meta', JSON.stringify({ bbox: stats!.bbox, volumeMm3: stats!.volumeMm3, triangles: stats!.triangles }));
			// Primary color + any painted colors (filament order matches the 3MF indices).
			const extra = (editor?.usedColors?.() ?? []).map((s) => ({ filamentType: s.filamentType, colorHex: s.colorHex, colorName: s.colorName ?? undefined }));
			const colorRequest = [{ filamentType: selected!.filamentType, colorHex: selected!.colorHex, colorName: selected!.colorName ?? undefined }, ...extra];
			formData.set('colorRequest', JSON.stringify(colorRequest));
			formData.set('colorHex', selected!.colorHex);
			formData.set('colorName', selected!.colorName ?? '');
			formData.set('filamentType', selected!.filamentType);
			formData.set('process', JSON.stringify(process));
			formData.set('layerHeightMm', String(process.layerHeightMm));
			formData.set('infillPct', String(process.infillPct));
			formData.set('supports', String(process.supports));
			formData.set('copies', String(copies));
			formData.set('printerModelTarget', printerTarget);
			const thumb = editor?.captureThumbnail?.();
			if (thumb) formData.set('thumbnail', thumb);
			return async ({ update }) => { await update(); submitting = false; };
		}}
		class="grid gap-5 lg:grid-cols-12">
		<input bind:this={fileInput} type="file" accept=".stl,.obj,.3mf" multiple class="hidden" onchange={onInput} />

		<!-- Editor -->
		<div class="lg:col-span-8">
			<div class="relative h-[440px] lg:h-[620px]" role="button" tabindex="0"
				ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)} ondrop={onDrop}>
				<StudioEditor bind:this={editor} colorHex={selected?.colorHex ?? '#FF5B14'} palette={data.colors} {plate} onstats={(s) => (stats = s)} />
				{#if !hasModel}
					<button type="button" onclick={() => fileInput?.click()}
						class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed {dragOver ? 'border-spark bg-spark/10' : 'border-warm-700'} transition-colors">
						<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-spark-soft text-spark-deep"><Icon name="upload" size={26} /></div>
						<div class="text-center"><p class="font-semibold text-warm-100">Drop models or click to browse</p><p class="text-sm text-warm-400">STL, OBJ, or 3MF · add as many as you like</p></div>
					</button>
				{/if}
			</div>
			{#if hasModel}
				<div class="mt-3 flex items-center gap-3">
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => fileInput?.click()}><Icon name="plus" size={14} /> Add model</button>
					{#if stats}<span class="text-sm text-muted-ink">{stats.bbox.x} × {stats.bbox.y} × {stats.bbox.z} mm · {stats.triangles.toLocaleString()} tris</span>{/if}
				</div>
			{/if}
		</div>

		<!-- Settings -->
		<div class="space-y-4 lg:col-span-4">
			<div class="card space-y-4 p-5">
				<div><label class="label" for="pn">Print name</label><input class="input" id="pn" name="name" bind:value={name} placeholder="My cool model" required /></div>
				<div>
					<div class="mb-2 flex items-center justify-between"><span class="label mb-0">Color</span>{#if selected}<span class="text-xs text-muted-ink">{selected.colorName ?? selected.colorHex} · {selected.filamentType}</span>{/if}</div>
					{#if data.colors.length === 0}<p class="text-sm text-muted-ink">No colors loaded. Ask an admin to map AMS colors.</p>
					{:else}
						<div class="flex flex-wrap gap-2">
							{#each data.colors as c}
								<button type="button" title="{c.colorName ?? c.colorHex} · {c.filamentType}{c.available ? '' : ' (offline)'}" onclick={() => (selected = c)}
									class="relative h-9 w-9 rounded-lg border-2 transition-transform hover:scale-110 {selected?.colorHex === c.colorHex && selected?.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{c.colorHex}">
									{#if c.available}<span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-success"></span>{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="card space-y-4 p-5">
				<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-ink"><Icon name="sliders" size={15} /> Slicing settings</h2>
				<div>
					<span class="label">Quality</span>
					<div class="grid grid-cols-4 gap-1.5">
						{#each QUALITY_PRESETS as p}<button type="button" onclick={() => (process.layerHeightMm = p.h)} class="btn btn-sm {process.layerHeightMm === p.h ? 'btn-primary' : 'btn-secondary'} !px-1 !text-xs">{p.label}</button>{/each}
					</div>
					<p class="mt-1 text-xs text-muted-ink">Layer height {process.layerHeightMm} mm</p>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="text-sm">Walls<input type="number" min="1" max="8" bind:value={process.wallLoops} class="input mt-1" /></label>
					<label class="text-sm">Top/bottom<input type="number" min="0" max="12" bind:value={process.topBottomLayers} class="input mt-1" /></label>
				</div>
				<div>
					<label class="label" for="inf">Infill ({process.infillPct}%)</label>
					<input id="inf" type="range" min="0" max="100" step="5" bind:value={process.infillPct} class="w-full accent-[#FF5B14]" />
					<select class="select mt-2" bind:value={process.infillPattern}>{#each INFILL_PATTERNS as p}<option value={p}>{p}</option>{/each}</select>
				</div>
				<div class="space-y-2 border-t border-warm-200 pt-3">
					<label class="flex items-center gap-2 text-sm font-medium text-soft-ink"><input type="checkbox" bind:checked={process.supports} class="h-4 w-4 rounded accent-[#FF5B14]" /> Supports</label>
					{#if process.supports}
						<div class="grid grid-cols-2 gap-3 pl-6">
							<select class="select" bind:value={process.supportType}><option value="tree">Tree</option><option value="normal">Normal</option></select>
							<label class="text-xs text-muted-ink">Overhang °<input type="number" min="0" max="90" bind:value={process.supportThreshold} class="input mt-0.5" /></label>
						</div>
					{/if}
				</div>
				<div class="grid grid-cols-2 gap-3 border-t border-warm-200 pt-3">
					<label class="text-sm">Adhesion<select class="select mt-1" bind:value={process.adhesion}><option value="none">None</option><option value="skirt">Skirt</option><option value="brim">Brim</option></select></label>
					{#if process.adhesion === 'brim'}<label class="text-sm">Brim (mm)<input type="number" min="0" max="20" bind:value={process.brimWidth} class="input mt-1" /></label>{/if}
					<label class="text-sm">Seam<select class="select mt-1" bind:value={process.seam}>{#each SEAM_OPTIONS as s}<option value={s}>{s}</option>{/each}</select></label>
					<label class="text-sm">Speed<select class="select mt-1" bind:value={process.speed}>{#each SPEED_OPTIONS as s}<option value={s}>{s}</option>{/each}</select></label>
				</div>
				<div class="flex flex-wrap gap-x-4 gap-y-2 border-t border-warm-200 pt-3 text-sm text-soft-ink">
					<label class="flex items-center gap-2"><input type="checkbox" bind:checked={process.ironing} class="h-4 w-4 rounded accent-[#FF5B14]" /> Ironing</label>
					<label class="flex items-center gap-2"><input type="checkbox" bind:checked={process.fuzzySkin} class="h-4 w-4 rounded accent-[#FF5B14]" /> Fuzzy skin</label>
					<label class="flex items-center gap-2"><input type="checkbox" bind:checked={process.spiralVase} class="h-4 w-4 rounded accent-[#FF5B14]" /> Vase mode</label>
				</div>
				<div class="grid grid-cols-2 gap-3 border-t border-warm-200 pt-3">
					<label class="text-sm">Copies<input type="number" min="1" max="20" bind:value={copies} class="input mt-1" /></label>
					<label class="text-sm">Printer<select class="select mt-1" bind:value={printerTarget}><option value="auto">Any available</option>{#each data.printerModels as m}<option value={m}>{m}</option>{/each}</select></label>
				</div>
			</div>

			<div class="card space-y-3 p-5">
				{#if data.approvalMode}<div class="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-[#a35f00]"><Icon name="clock" size={16} /> Needs teacher approval.</div>{/if}
				<div class="flex items-center justify-between text-sm"><span class="text-muted-ink">Quota left</span><span class="font-semibold text-ink">{data.usage.gramsRemaining ?? '∞'} g · {data.usage.jobsRemaining ?? '∞'} prints</span></div>
				<button class="btn btn-primary w-full" disabled={!canSubmit || submitting}>
					{#if submitting}Slicing & sending…{:else}<Icon name="bolt" size={16} /> {data.approvalMode ? 'Submit for approval' : 'Slice & print'}{/if}
				</button>
				{#if !canSubmit}<p class="text-center text-xs text-muted-ink">Add a model, name, and color to continue.</p>{/if}
			</div>
		</div>
	</form>
</div>
