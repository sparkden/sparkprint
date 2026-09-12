<script lang="ts">
	import { enhance } from '$app/forms';
	import { unzipSync, strFromU8 } from 'fflate';
	import StudioEditor from '$lib/components/StudioEditor.svelte';
	import FloatingPanel from '$lib/components/FloatingPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { colorDistance } from '$lib/color';
	let { data, form } = $props();

	let printOpen = $state(false); // the floating "Print" window

	type LabColor = (typeof data.colors)[number];
	let name = $state('');
	let selected = $state<LabColor | null>(data.colors.find((c) => c.available) ?? data.colors[0] ?? null);
	let quality = $state(0.2); // layer height
	let supports = $state(false);
	let raft = $state(false);
	let copies = $state(1);
	let mode = $state<'design' | 'upload'>('design'); // 'upload' = print a Bambu Studio .gcode.3mf

	// Multicolor: filaments detected in an uploaded sliced 3mf, each mapped to a lab color.
	type DetectedFilament = { index: number; bakedHex: string | null; type: string };
	let detected = $state<DetectedFilament[]>([]);
	let filamentColors = $state<(LabColor | null)[]>([]);

	function nearestLabColor(hex: string | null): LabColor | null {
		if (!data.colors.length) return null;
		if (!hex) return data.colors.find((c) => c.available) ?? data.colors[0];
		let best = data.colors[0];
		let bestD = Infinity;
		for (const c of data.colors) {
			const d = colorDistance(hex, c.colorHex);
			if (d < bestD) { bestD = d; best = c; }
		}
		return best;
	}

	async function onSlicedFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		detected = [];
		filamentColors = [];
		if (!f) return;
		try {
			const files = unzipSync(new Uint8Array(await f.arrayBuffer()));
			const si = files['Metadata/slice_info.config'];
			if (si) {
				const xml = strFromU8(si);
				const plate = xml.split('<plate>')[1] ?? xml; // first plate
				const fils = [...plate.matchAll(/<filament\b[^>]*\/?>/g)];
				detected = fils.map((m, i) => ({
					index: i,
					bakedHex: (/color="([^"]+)"/i.exec(m[0])?.[1] ?? null)?.slice(0, 7) ?? null,
					type: /type="([^"]+)"/i.exec(m[0])?.[1] ?? 'PLA'
				}));
			}
			if (detected.length === 0) detected = [{ index: 0, bakedHex: null, type: 'PLA' }];
			filamentColors = detected.map((d) => nearestLabColor(d.bakedHex));
		} catch {
			detected = [{ index: 0, bakedHex: null, type: 'PLA' }];
			filamentColors = [nearestLabColor(null)];
		}
	}
	const uploadColorRequest = $derived(
		filamentColors.map((c, i) => ({ filamentType: c?.filamentType ?? detected[i]?.type ?? 'PLA', colorHex: c?.colorHex ?? '#FF5B14', colorName: c?.colorName ?? '' }))
	);
	const uploadReady = $derived(detected.length > 0 && filamentColors.every((c) => !!c));
	let stats = $state<{ bbox: { x: number; y: number; z: number }; volumeMm3: number; triangles: number; objects: number } | null>(null);
	let submitting = $state(false);

	let editor: StudioEditor;
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);

	// Default build plate (256³); auto-assigned later to whichever printer has the color.
	const plate = { x: 256, y: 256, z: 256 };
	const hasModel = $derived((stats?.objects ?? 0) > 0);
	const canSubmit = $derived(hasModel && !!selected && !!name);

	// Keep un-recolored objects on the picked color (single-color path); per-object colors set in
	// the editor's object list stay put.
	$effect(() => {
		if (selected) editor?.setDefaultColor?.(selected);
	});

	const QUALITY = [
		{ label: 'Draft', h: 0.28 },
		{ label: 'Standard', h: 0.2 },
		{ label: 'Fine', h: 0.12 }
	];

	function addFiles(files: FileList | null | undefined) {
		if (!files) return;
		for (const f of Array.from(files)) {
			editor?.addObject(f);
			if (!name) name = f.name.replace(/\.(stl|obj|3mf)$/i, '');
		}
	}
	function onInput(e: Event) { addFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }
	function onDrop(e: DragEvent) { e.preventDefault(); dragOver = false; addFiles(e.dataTransfer?.files); }
	let showRef = $state(false); // scale-reference objects (pencil + paperclip) beside the plate
</script>

<svelte:head><title>New print · SparkPrint</title></svelte:head>

<!-- Fullscreen editor workspace (covers the app sidebar) -->
<div class="fixed inset-0 z-40 bg-soft-paper">
	<input bind:this={fileInput} type="file" accept=".stl,.obj,.3mf" multiple class="hidden" onchange={onInput} />

	<!-- Editor fills the screen -->
	<div class="absolute inset-0" role="button" tabindex="0"
		ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)} ondrop={onDrop}>
		<StudioEditor bind:this={editor} colorHex={selected?.colorHex ?? '#FF5B14'} labColors={data.colors} defaultColor={selected} reference={showRef} embedded {plate} onstats={(s) => (stats = s)} />
		{#if !hasModel}
			<button type="button" onclick={() => fileInput?.click()}
				class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 {dragOver ? 'bg-spark-soft/40' : ''} transition-colors">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-spark-soft text-spark-deep"><Icon name="upload" size={28} /></div>
				<div class="text-center"><p class="text-lg font-semibold text-ink">Drop a model or click to browse</p><p class="text-sm text-muted-ink">STL, OBJ, or 3MF · add as many as you like</p></div>
			</button>
		{/if}
	</div>

	<!-- Top-left workspace bar -->
	<div class="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-xl border border-warm-200 bg-surface/95 px-2 py-1.5 shadow-lg backdrop-blur">
		<a href="/app" class="flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-soft-ink hover:bg-warm-100" title="Back"><Icon name="chevronRight" size={15} /><span class="rotate-180"></span>Exit</a>
		<span class="h-5 w-px bg-warm-200"></span>
		<button type="button" class="btn btn-secondary btn-sm" onclick={() => fileInput?.click()}><Icon name="plus" size={14} /> Add model</button>
		<button type="button" title="Show a pencil & paperclip beside the plate for scale" onclick={() => (showRef = !showRef)} class="btn btn-sm {showRef ? 'btn-primary' : 'btn-secondary'}"><Icon name="scale" size={14} /> Reference</button>
		{#if stats}<span class="hidden px-1 text-xs text-muted-ink sm:inline">{stats.bbox.x}×{stats.bbox.y}×{stats.bbox.z} mm</span>{/if}
	</div>

	<!-- Print now (opens the floating settings window) -->
	{#if !form?.success && !printOpen}
		<button type="button" onclick={() => (printOpen = true)} class="btn btn-primary btn-lg absolute bottom-5 right-5 z-30 shadow-lg"><Icon name="bolt" size={18} /> Print now</button>
	{/if}

	<!-- Print settings — draggable / snappable window -->
	{#if !form?.success}
		<FloatingPanel title="Print" icon="bolt" bind:open={printOpen} x={typeof window !== 'undefined' ? window.innerWidth - 400 : 900} y={70} w={370} h={560}>
			{#if form?.error}<div class="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{form.error}</div>{/if}
			<div class="mb-3 inline-flex rounded-lg border border-warm-200 bg-warm-50 p-0.5 text-xs">
				<button type="button" onclick={() => (mode = 'design')} class="rounded-md px-2.5 py-1 font-medium {mode === 'design' ? 'bg-spark-soft text-spark-deep' : 'text-muted-ink'}">This design</button>
				<button type="button" onclick={() => (mode = 'upload')} class="rounded-md px-2.5 py-1 font-medium {mode === 'upload' ? 'bg-spark-soft text-spark-deep' : 'text-muted-ink'}">Upload sliced</button>
			</div>

			{#if mode === 'design'}
				<form method="POST" action="?/submit" enctype="multipart/form-data"
					use:enhance={({ formData, cancel }) => {
						if (!canSubmit) { cancel(); return; }
						submitting = true;
						// Any paint (multicolor, support or seam) → painted 3MF + one filament per color.
						const mc = (editor?.multicolor?.() ?? false) || (editor?.hasPaint?.() ?? false);
						if (mc) {
							const painted = editor?.exportPainted3MF?.();
							if (painted) formData.set('file', painted, (name || 'model') + '.3mf');
							formData.set('colorRequest', JSON.stringify(editor!.getColorRequest()));
						} else {
							const stl = editor?.exportSTL?.();
							if (stl) formData.set('file', stl, (name || 'model') + '.stl');
						}
						formData.set('meta', JSON.stringify({ bbox: stats!.bbox, volumeMm3: stats!.volumeMm3, triangles: stats!.triangles }));
						formData.set('colorHex', selected!.colorHex);
						formData.set('colorName', selected!.colorName ?? '');
						formData.set('filamentType', selected!.filamentType);
						formData.set('layerHeightMm', String(quality));
						formData.set('infillPct', '15');
						formData.set('supports', String(supports));
						formData.set('copies', String(copies));
						formData.set('printerModelTarget', 'auto');
						formData.set('process', JSON.stringify({ layerHeightMm: quality, infillPct: 15, supports, raft, adhesion: raft ? 'raft' : 'none' }));
						const thumb = editor?.captureThumbnail?.();
						if (thumb) formData.set('thumbnail', thumb);
						return async ({ update }) => { await update(); submitting = false; };
					}}
					class="space-y-4">
					<div><label class="label" for="pn">Print name</label><input class="input" id="pn" name="name" bind:value={name} placeholder="My cool model" required /></div>

					<div>
						<div class="mb-2 flex items-center justify-between"><span class="label mb-0">Color</span>{#if selected}<span class="text-xs text-muted-ink">{selected.colorName ?? selected.colorHex} · {selected.filamentType}</span>{/if}</div>
						{#if data.colors.length === 0}<p class="text-sm text-muted-ink">No colors loaded yet. Ask your teacher.</p>
						{:else}
							<div class="flex flex-wrap gap-2">
								{#each data.colors as c}
									<button type="button" title="{c.colorName ?? c.colorHex} · {c.filamentType}{c.available ? '' : ' (offline)'}" onclick={() => (selected = c)}
										class="relative h-9 w-9 rounded-lg border-2 transition-transform hover:scale-110 {selected?.colorHex === c.colorHex && selected?.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{c.colorHex}">
										{#if c.available}<span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-success"></span>{/if}
									</button>
								{/each}
							</div>
							<p class="mt-1.5 text-xs text-muted-ink">Recolor individual objects with the paint tools in the editor.</p>
						{/if}
					</div>

					<div>
						<span class="label">Quality</span>
						<div class="grid grid-cols-3 gap-1.5">
							{#each QUALITY as q}<button type="button" onclick={() => (quality = q.h)} class="btn btn-sm {quality === q.h ? 'btn-primary' : 'btn-secondary'}">{q.label}</button>{/each}
						</div>
						<p class="mt-1 text-xs text-muted-ink">Layer height {quality} mm</p>
					</div>

					<label class="flex items-center gap-2.5 text-sm font-medium text-soft-ink"><input type="checkbox" bind:checked={supports} class="h-4 w-4 rounded accent-[#FF5B14]" /> Supports <span class="text-xs font-normal text-muted-ink">— for overhangs</span></label>
					<label class="flex items-center gap-2.5 text-sm font-medium text-soft-ink"><input type="checkbox" bind:checked={raft} class="h-4 w-4 rounded accent-[#FF5B14]" /> Raft <span class="text-xs font-normal text-muted-ink">— helps stick to the plate</span></label>
					<div><label class="label" for="cp">Copies</label><input class="input max-w-[6rem]" id="cp" name="copies" type="number" min="1" max="20" bind:value={copies} /></div>

					<div class="space-y-3 border-t border-warm-200 pt-3">
						{#if data.approvalMode}<div class="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-[#a35f00]"><Icon name="clock" size={16} /> A teacher approves before it prints.</div>{/if}
						<div class="flex items-center justify-between text-sm"><span class="text-muted-ink">Quota left</span><span class="font-semibold text-ink">{data.usage.gramsRemaining ?? '∞'} g · {data.usage.jobsRemaining ?? '∞'} prints</span></div>
						<button class="btn btn-primary w-full" disabled={!canSubmit || submitting}>
							{#if submitting}Sending…{:else}<Icon name="bolt" size={16} /> {data.approvalMode ? 'Submit for approval' : 'Send to print'}{/if}
						</button>
						{#if !canSubmit}<p class="text-center text-xs text-muted-ink">Add a model, name, and color to continue.</p>{/if}
					</div>
				</form>
			{:else}
				<!-- Upload a file already sliced in Bambu Studio / OrcaSlicer -->
				<form method="POST" action="?/uploadSliced" enctype="multipart/form-data"
					use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }}
					class="space-y-4">
					<p class="text-sm text-soft-ink">Already sliced your plate in <b>Bambu Studio</b>? Export it (File → Export → <b>Export plate sliced file</b>, a <code>.gcode.3mf</code>) and drop it here — it prints as-is, no re-slicing.</p>
					<div>
						<label class="label" for="uf">Sliced file (.gcode.3mf)</label>
						<input class="input" id="uf" name="file" type="file" accept=".3mf,.gcode.3mf" required onchange={onSlicedFile} />
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div><label class="label" for="un">Name</label><input class="input" id="un" name="name" placeholder="My print" /></div>
						<div><label class="label" for="ucp">Copies</label><input class="input" id="ucp" name="copies" type="number" min="1" max="20" value="1" /></div>
					</div>

					{#if data.colors.length === 0}
						<p class="text-sm text-muted-ink">No colors loaded yet. Ask your teacher.</p>
					{:else if detected.length === 0}
						<p class="rounded-lg bg-warm-50 px-3 py-2 text-sm text-muted-ink">Choose a sliced file above and we'll detect its colors.</p>
					{:else}
						<div>
							<span class="label">{detected.length > 1 ? `Map the ${detected.length} filaments to lab colors` : 'Color to route to'}</span>
							<div class="mt-1 space-y-3">
								{#each detected as f, i}
									<div class="rounded-lg border border-warm-200 p-3">
										<div class="mb-2 flex items-center gap-2 text-sm">
											<span class="inline-flex h-6 w-6 items-center justify-center rounded-md bg-warm-100 text-xs font-semibold text-muted-ink">{i + 1}</span>
											{#if f.bakedHex}<span class="h-4 w-4 rounded border border-warm-300" style="background:{f.bakedHex}"></span>{/if}
											<span class="text-muted-ink">Filament {i + 1} · {f.type}{f.bakedHex ? ` (${f.bakedHex})` : ''}</span>
											<span class="ml-auto text-xs font-medium text-ink">→ {filamentColors[i]?.colorName ?? filamentColors[i]?.colorHex ?? 'pick'}</span>
										</div>
										<div class="flex flex-wrap gap-2">
											{#each data.colors as c}
												<button type="button" title="{c.colorName ?? c.colorHex} · {c.filamentType}" onclick={() => (filamentColors[i] = c)}
													class="relative h-8 w-8 rounded-lg border-2 transition-transform hover:scale-110 {filamentColors[i]?.colorHex === c.colorHex && filamentColors[i]?.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{c.colorHex}">
													{#if c.available}<span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-success"></span>{/if}
												</button>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<input type="hidden" name="colorRequest" value={JSON.stringify(uploadColorRequest)} />
					<input type="hidden" name="colorHex" value={filamentColors[0]?.colorHex ?? '#FF5B14'} />
					<input type="hidden" name="filamentType" value={filamentColors[0]?.filamentType ?? 'PLA'} />
					<button class="btn btn-primary w-full" disabled={submitting || !uploadReady}>
						{#if submitting}Sending…{:else}<Icon name="bolt" size={16} /> Send sliced file to print{/if}
					</button>
					{#if detected.length && !uploadReady}<p class="text-center text-xs text-muted-ink">Pick a lab color for each filament.</p>{/if}
				</form>
			{/if}
		</FloatingPanel>
	{/if}

	<!-- Success overlay -->
	{#if form?.success}
		<div class="absolute inset-0 z-50 flex items-center justify-center bg-soft-paper/80 backdrop-blur">
			<div class="card mx-auto max-w-lg p-8 text-center">
				<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success"><Icon name="check" size={30} /></div>
				{#if form.printerName}
					<h2 class="text-2xl font-semibold">Your print will be on <span class="text-spark">{form.printerName}</span>! 🎉</h2>
					<p class="mt-2 text-sm text-soft-ink">It's queued and will start when the printer is free.</p>
				{:else if form.status === 'pending_approval'}
					<h2 class="text-2xl font-semibold">Sent for approval ✅</h2>
					<p class="mt-2 text-sm text-soft-ink">A teacher will review it, then it'll be assigned to a printer.</p>
				{:else}
					<h2 class="text-2xl font-semibold">Queued ✅</h2>
					<p class="mt-2 text-sm text-soft-ink">No printer has that exact color loaded right now — it'll go as soon as one does. Ask your teacher if it waits.</p>
				{/if}
				<div class="mt-6 flex justify-center gap-3">
					<a href="/app/jobs/{form.jobId}" class="btn btn-primary">View print</a>
					<a href="/app/design" class="btn btn-secondary">Start another</a>
				</div>
			</div>
		</div>
	{/if}
</div>
