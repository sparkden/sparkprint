<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { unzipSync, strFromU8 } from 'fflate';
	import StudioEditor from '$lib/components/StudioEditor.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { colorDistance } from '$lib/color';
	let { data, form } = $props();

	let printOpen = $state(true); // the print-settings panel (bottom sheet on phones)
	const PANEL_W = 340;

	// On phones the panel is a bottom sheet, so the editor keeps the full width (no right inset).
	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		const update = () => (isMobile = mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});

	type LabColor = (typeof data.colors)[number];
	// Render a stored color safely: ensure a leading #, tolerate 8-digit RRGGBBAA, else fall back.
	function swatch(hex: string | null | undefined): string {
		if (!hex) return '#cccccc';
		let h = hex.trim().replace(/^#/, '');
		if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return '#cccccc';
		return '#' + h.slice(0, 6);
	}
	let name = $state('');
	let selected = $state<LabColor | null>(data.colors.find((c) => c.available) ?? data.colors[0] ?? null);
	let anyColor = $state(false); // "no preference" — let the lab pick the most-available color

	// ── Color availability ───────────────────────────────────────────────────
	// The editor reports the colors actually on the model (1 = single, >1 = multicolor). We combine
	// that with the lab's live AMS availability to tell the student whether their print goes now or
	// queues, and — for multicolor — whether the chosen colors all live in one AMS.
	let usedColors = $state<{ filamentType: string; colorHex: string; colorName?: string }[]>([]);
	const keyOf = (c: { filamentType: string; colorHex: string }) => `${c.filamentType}|${c.colorHex.toLowerCase()}`;
	const colorByKey = $derived(new Map(data.colors.map((c) => [keyOf(c), c])));
	const printColors = $derived(anyColor ? [] : usedColors.length ? usedColors : selected ? [selected] : []);
	const colorStatus = $derived.by(() => {
		if (anyColor || printColors.length === 0) return { kind: 'ok' as const };
		const keys = [...new Set(printColors.map(keyOf))];
		if (keys.length <= 1) {
			const c = colorByKey.get(keys[0]);
			if (!c) return { kind: 'offline' as const };
			if (c.available) return { kind: 'available' as const };
			return { kind: c.inUse ? 'queue' : 'offline' } as const;
		}
		// Multicolor: every color must live in a single AMS unit.
		const fit = data.amsGroups.filter((g) => keys.every((k) => g.colorKeys.includes(k)));
		if (fit.length === 0) return { kind: 'unfit' as const };
		if (fit.some((g) => g.free)) return { kind: 'available' as const };
		return { kind: fit.some((g) => g.online) ? 'queue' : 'offline' } as const;
	});
	let quality = $state(0.2); // layer height
	let infill = $state(15); // infill density %
	let supports = $state(false);
	let raft = $state(false);
	let copies = $state(1);
	let speed = $state(2); // Bambu speed profile: 1 Silent · 2 Standard · 3 Sport · 4 Ludicrous
	let bedTemp = $state<number | null>(null); // bed temperature °C; null = auto (per-material default)
	const SPEED = [
		{ v: 1, label: 'Silent' },
		{ v: 2, label: 'Standard' },
		{ v: 3, label: 'Sport' },
		{ v: 4, label: 'Ludicrous' }
	];
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
		uploadPreview = null;
		if (!f) return;
		try {
			const bytes = new Uint8Array(await f.arrayBuffer());
			try { uploadPreview = previewFrom3mf(bytes); } catch { uploadPreview = null; }
			const files = unzipSync(bytes);
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
		filamentColors.map((c, i) => ({ filamentType: c?.filamentType ?? detected[i]?.type ?? 'PLA', colorHex: c?.colorHex ?? '#1E2F66', colorName: c?.colorName ?? '' }))
	);
	const uploadReady = $derived(detected.length > 0 && filamentColors.every((c) => !!c));
	let stats = $state<{ bbox: { x: number; y: number; z: number }; volumeMm3: number; triangles: number; objects: number } | null>(null);
	let submitting = $state(false);

	// ── Sliced preview shown before printing ──────────────────────────────────────
	type Preview = { preslicedKey?: string; thumbnail: string | null; grams: number; timeSec: number; layers: number };
	let preview = $state<Preview | null>(null); // design-mode slice result
	let uploadPreview = $state<Preview | null>(null); // upload-mode file's own slice
	let slicing = $state(false);
	let sliceError = $state<string | null>(null);
	let sliceNote = $state<string | null>(null);
	let sliceModalOpen = $state(false); // "Print sliced" result modal shown after a slice completes
	/** Any design/geometry change makes the last slice stale. */
	function invalidatePreview() { preview = null; sliceError = null; sliceNote = null; sliceModalOpen = false; }

	function fmtTime(sec: number): string {
		if (!sec || sec < 0) return '—';
		const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
		return h ? `${h}h ${m}m` : `${m}m`;
	}
	function fmtGrams(g: number): string { return g > 0 ? `${g.toFixed(g < 10 ? 1 : 0)} g` : '—'; }

	/** Pull the rendered plate image + metrics out of a sliced .gcode.3mf, client-side. */
	function previewFrom3mf(bytes: Uint8Array): Preview {
		const files = unzipSync(bytes);
		const names = Object.keys(files);
		const pngName = names.find((n) => /^Metadata\/plate_\d+\.png$/i.test(n)) || names.find((n) => /\.png$/i.test(n) && !/_small/i.test(n));
		let thumbnail: string | null = null;
		if (pngName) {
			const b = files[pngName]; let s = '';
			for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
			thumbnail = 'data:image/png;base64,' + btoa(s);
		}
		let grams = 0, timeSec = 0, layers = 0;
		const gName = names.find((n) => /^Metadata\/plate_\d+\.gcode$/i.test(n)) || names.find((n) => n.toLowerCase().endsWith('.gcode'));
		if (gName) {
			const raw = files[gName];
			const head = strFromU8(raw.slice(0, 4000)) + '\n' + strFromU8(raw.slice(Math.max(0, raw.length - 4000)));
			grams = parseFloat(/filament used\s*\[g\]\s*[:=]\s*([\d.]+)/i.exec(head)?.[1] ?? '') || 0;
			const hms = /(?:model printing time|total estimated time|estimated printing time)\D*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(head);
			if (hms) timeSec = +(hms[1] || 0) * 3600 + +(hms[2] || 0) * 60 + +(hms[3] || 0);
			layers = parseInt(/(?:total layer number|total_layer_count|LAYER_COUNT)\s*[:=]\s*(\d+)/i.exec(head)?.[1] ?? '0', 10) || 0;
		}
		return { thumbnail, grams, timeSec, layers };
	}

	let editor: StudioEditor;
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);

	// Default build plate (256³); auto-assigned later to whichever printer has the color.
	const plate = { x: 256, y: 256, z: 256 };
	// Track object count from BOTH the stats callback and directly after a load, so the empty-state
	// overlay reliably lifts once a model is in the editor.
	let objectCount = $state(0);
	let editorError = $state<string | null>(null);
	const hasModel = $derived(objectCount > 0);
	const hasColor = $derived(anyColor || !!selected);
	const canSlice = $derived(hasModel && hasColor);
	const canSubmit = $derived(hasModel && hasColor && !!name);

	// Keep un-recolored objects on the picked color (single-color path); per-object colors set in
	// the editor's object list stay put. untrack() so this effect only depends on `selected` —
	// setDefaultColor reads+writes the editor's object list, which would otherwise self-retrigger
	// the effect (effect_update_depth_exceeded).
	$effect(() => {
		const c = selected;
		if (c) untrack(() => editor?.setDefaultColor?.(c));
	});

	const QUALITY = [
		{ label: 'Draft', h: 0.28 },
		{ label: 'Standard', h: 0.2 },
		{ label: 'Fine', h: 0.12 }
	];

	async function addFiles(files: FileList | null | undefined) {
		if (!files) return;
		for (const f of Array.from(files)) {
			await editor?.addObject(f);
			if (!name) name = f.name.replace(/\.(stl|obj|3mf)$/i, '');
		}
		// Read the count straight from the editor so the overlay lifts even if the stats callback lagged.
		objectCount = editor?.count?.() ?? objectCount;
	}
	function onInput(e: Event) { addFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }
	function onDrop(e: DragEvent) { e.preventDefault(); dragOver = false; addFiles(e.dataTransfer?.files); }
	let showRef = $state(false); // scale-reference objects (pencil + paperclip) beside the plate
</script>

<svelte:head><title>New print · LataPrint</title></svelte:head>

<!-- Fullscreen editor workspace (covers the app sidebar) -->
<div class="fixed inset-0 z-40 bg-soft-paper">
	<input bind:this={fileInput} type="file" accept=".stl,.obj,.3mf" multiple class="hidden" onchange={onInput} />

	<!-- Editor fills the screen -->
	<div class="absolute inset-0" role="button" tabindex="0"
		ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)} ondrop={onDrop}>
		<StudioEditor bind:this={editor} colorHex={selected?.colorHex ?? '#1E2F66'} labColors={data.colors} defaultColor={selected} reference={showRef} embedded insetRight={!isMobile && printOpen && !form?.success ? PANEL_W : 0} {plate} onstats={(s) => { stats = s; objectCount = s.objects; invalidatePreview(); }} oncolors={(cols) => (usedColors = cols)} onerror={(m) => (editorError = m)} />
		{#if !hasModel}
			<button type="button" onclick={() => fileInput?.click()}
				class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 {dragOver ? 'bg-spark-soft/40' : ''} transition-colors">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-spark-soft text-spark-deep"><Icon name="upload" size={28} /></div>
				<div class="text-center"><p class="text-lg font-semibold text-ink">Drop a model or click to browse</p><p class="text-sm text-muted-ink">STL, OBJ, or 3MF · add as many as you like</p></div>
				{#if editorError}<div class="mt-2 max-w-md rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{editorError}</div>{/if}
			</button>
		{/if}
	</div>

	<!-- Top-left workspace bar -->
	<div class="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-xl border border-warm-200 bg-surface/95 px-2 py-1.5 shadow-lg backdrop-blur">
		<a href="/app" class="flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-soft-ink hover:bg-warm-100" title="Exit"><Icon name="chevronRight" size={15} /><span class="rotate-180"></span><span class="hidden sm:inline">Exit</span></a>
		<span class="h-5 w-px bg-warm-200"></span>
		<button type="button" title="Add model" class="btn btn-secondary btn-sm" onclick={() => fileInput?.click()}><Icon name="plus" size={14} /> <span class="hidden sm:inline">Add model</span></button>
		<button type="button" title="Show a pencil & paperclip beside the plate for scale" onclick={() => (showRef = !showRef)} class="btn btn-sm {showRef ? 'btn-primary' : 'btn-secondary'}"><Icon name="scale" size={14} /> <span class="hidden sm:inline">Reference</span></button>
		{#if !form?.success && !printOpen}
			<button type="button" title="Print" class="btn btn-primary btn-sm" onclick={() => (printOpen = true)}><Icon name="bolt" size={14} /> <span class="hidden sm:inline">Print</span></button>
		{/if}
		{#if stats}<span class="hidden px-1 text-xs text-muted-ink lg:inline">{stats.bbox.x}×{stats.bbox.y}×{stats.bbox.z} mm</span>{/if}
	</div>

	<!-- Print settings — a bottom sheet on phones, docked to the right edge on wider screens. -->
	{#if !form?.success && printOpen}
		<aside class="absolute inset-x-0 bottom-0 z-30 flex max-h-[78svh] flex-col rounded-t-2xl border-t border-warm-200 bg-surface/95 shadow-xl backdrop-blur md:inset-x-auto md:right-0 md:top-0 md:max-h-none md:w-[340px] md:rounded-none md:border-l md:border-t-0">
			<header class="flex items-center gap-2 border-b border-warm-200 px-4 py-3">
				<Icon name="bolt" size={16} /><span class="flex-1 text-sm font-semibold text-ink">Print</span>
				<button type="button" title="Hide" class="rounded p-1 text-muted-ink hover:bg-warm-100 hover:text-ink" onclick={() => (printOpen = false)}><Icon name="x" size={16} /></button>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#if form?.error}<div class="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{form.error}</div>{/if}
			<div class="mb-3 inline-flex rounded-lg border border-warm-200 bg-warm-50 p-0.5 text-xs">
				<button type="button" onclick={() => (mode = 'design')} class="rounded-md px-2.5 py-1 font-medium {mode === 'design' ? 'bg-spark-soft text-spark-deep' : 'text-muted-ink'}">This design</button>
				<button type="button" onclick={() => (mode = 'upload')} class="rounded-md px-2.5 py-1 font-medium {mode === 'upload' ? 'bg-spark-soft text-spark-deep' : 'text-muted-ink'}">Upload sliced</button>
			</div>

			{#if mode === 'design'}
				<form id="printForm" method="POST" action="?/slice" enctype="multipart/form-data"
					use:enhance={({ formData, action, cancel }) => {
						const isSlice = action.search.includes('slice');
						if (isSlice ? !canSlice : !canSubmit) { cancel(); return; }
						// Any paint (multicolor, support or seam) → painted 3MF + one filament per color.
						const mc = (editor?.multicolor?.() ?? false) || (editor?.hasPaint?.() ?? false);
						const useAny = anyColor && !mc; // "no preference" only applies to a single-color print
						if (mc) {
							const painted = editor?.exportPainted3MF?.();
							if (painted) formData.set('file', painted, (name || 'model') + '.3mf');
							formData.set('colorRequest', JSON.stringify(editor!.getColorRequest()));
						} else {
							const stl = editor?.exportSTL?.();
							if (stl) formData.set('file', stl, (name || 'model') + '.stl');
							if (useAny) formData.set('colorRequest', JSON.stringify([{ any: true, filamentType: 'PLA', colorHex: '#CCCCCC', colorName: 'Any (most available)' }]));
						}
						formData.set('meta', JSON.stringify({ bbox: stats!.bbox, volumeMm3: stats!.volumeMm3, triangles: stats!.triangles }));
						formData.set('colorHex', useAny ? '#CCCCCC' : selected!.colorHex);
						formData.set('colorName', useAny ? 'Any (most available)' : (selected!.colorName ?? ''));
						formData.set('filamentType', useAny ? 'PLA' : selected!.filamentType);
						formData.set('layerHeightMm', String(quality));
						formData.set('infillPct', String(infill));
						formData.set('supports', String(supports));
						formData.set('raft', String(raft));
						formData.set('copies', String(copies));
						formData.set('speedLevel', String(speed));
						formData.set('printerModelTarget', 'auto');
						formData.set('process', JSON.stringify({ layerHeightMm: quality, infillPct: infill, supports, raft, adhesion: raft ? 'raft' : 'none', ...(bedTemp ? { bedTempC: bedTemp } : {}) }));
						const thumb = editor?.captureThumbnail?.();
						if (thumb) formData.set('thumbnail', thumb);

						if (isSlice) {
							slicing = true; sliceError = null; sliceNote = null;
							return async ({ result }) => {
								slicing = false;
								if (result.type === 'success') {
									const p = (result.data?.preview ?? null) as Preview | null;
									preview = p;
									sliceNote = p ? null : 'No slicer is set up here, so there’s no detailed preview — you can still send it to print.';
									sliceModalOpen = true; // show the "Print sliced" result modal
								} else if (result.type === 'failure') {
									sliceError = (result.data?.sliceError as string) ?? (result.data?.error as string) ?? 'Slicing failed.';
								} else {
									sliceError = 'Upload/slice failed — the model may exceed the server upload limit, or the slicer errored. Check the server logs.';
								}
								// keep the panel open; don't touch the page form state
							};
						}
						// Send to print — reuse the file we just sliced for the preview.
						submitting = true;
						if (preview?.preslicedKey) {
							formData.set('preslicedKey', preview.preslicedKey);
							formData.set('preslicedGrams', String(preview.grams));
							formData.set('preslicedTimeSec', String(preview.timeSec));
						}
						return async ({ update }) => { await update(); submitting = false; sliceModalOpen = false; };
					}}
					class="space-y-4">
					<div><label class="label" for="pn">Print name</label><input class="input" id="pn" name="name" bind:value={name} placeholder="My cool model" required /></div>

					<div>
						<div class="mb-2 flex items-center justify-between"><span class="label mb-0">Color</span>{#if anyColor}<span class="text-xs text-muted-ink">No preference</span>{:else if selected}<span class="text-xs text-muted-ink">{selected.colorName ?? selected.colorHex} · {selected.filamentType}</span>{/if}</div>
						{#if data.colors.length === 0}<p class="text-sm text-muted-ink">No colors loaded yet. Ask your teacher.</p>
						{:else}
							<div class="flex flex-wrap items-center gap-2">
								<button type="button" title="Let the lab pick whichever color is most available" onclick={() => { anyColor = true; selected = null; invalidatePreview(); }}
									class="flex h-9 items-center gap-1.5 rounded-lg border-2 px-2.5 text-xs font-medium transition-colors {anyColor ? 'border-ink bg-spark-soft text-spark-deep' : 'border-warm-300 text-soft-ink hover:bg-warm-100'}">
									<Icon name="spool" size={14} /> No preference
								</button>
								<span class="h-6 w-px bg-warm-200"></span>
								{#each data.colors as c}
									<button type="button" title="{c.colorName ?? c.colorHex} · {c.filamentType}{c.available ? ' · available now' : c.inUse ? ' · in use (will queue)' : ' · offline'}" onclick={() => { selected = c; anyColor = false; invalidatePreview(); }}
										class="relative h-9 w-9 rounded-lg border-2 transition-transform hover:scale-110 {!anyColor && selected?.colorHex === c.colorHex && selected?.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{swatch(c.colorHex)}">
										{#if c.available}<span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-success" title="Available now"></span>
										{:else if c.inUse}<span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-danger" title="In use — will queue"></span>{/if}
									</button>
								{/each}
							</div>
							<p class="mt-1.5 text-xs text-muted-ink">{anyColor ? 'We’ll route it to whichever printer has the fullest spool loaded.' : 'Recolor individual objects with the paint tools in the editor.'}</p>
							{#if colorStatus.kind === 'queue'}
								<p class="mt-2 flex items-start gap-1.5 rounded-lg bg-danger/5 px-2.5 py-1.5 text-xs font-medium text-danger"><span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-danger"></span> Your print will be queued up — the printer that prints with this color is in use right now.</p>
							{:else if colorStatus.kind === 'unfit'}
								<p class="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-[#9c5a00]">For a multi-color print, every color has to be loaded in one printer's AMS. Some of these aren't in the same AMS, so it can't print as a single job — pick colors that share one AMS.</p>
							{:else if colorStatus.kind === 'offline'}
								<p class="mt-2 rounded-lg bg-warm-100 px-2.5 py-1.5 text-xs text-muted-ink">This color isn't loaded on an online printer right now — your print will wait in the queue until it is.</p>
							{:else if colorStatus.kind === 'available'}
								<p class="mt-2 flex items-center gap-1.5 text-xs font-medium text-success"><span class="h-2 w-2 rounded-full bg-success"></span> Available now — prints as soon as it's your turn.</p>
							{/if}
						{/if}
					</div>

					<div>
						<span class="label">Quality</span>
						<div class="grid grid-cols-3 gap-1.5">
							{#each QUALITY as q}<button type="button" onclick={() => { quality = q.h; invalidatePreview(); }} class="btn btn-sm {quality === q.h ? 'btn-primary' : 'btn-secondary'}">{q.label}</button>{/each}
						</div>
						<p class="mt-1 text-xs text-muted-ink">Layer height {quality} mm</p>
					</div>

					<div>
						<div class="mb-1 flex items-center justify-between"><span class="label mb-0">Infill</span><span class="text-xs font-semibold text-ink">{infill}%</span></div>
						<input type="range" min="0" max="100" step="5" bind:value={infill} onchange={invalidatePreview} class="w-full accent-[#1e2f66]" />
						<div class="mt-1 flex flex-wrap gap-1.5">
							{#each [{ l: 'Hollow', v: 0 }, { l: 'Light', v: 10 }, { l: 'Standard', v: 15 }, { l: 'Strong', v: 40 }, { l: 'Solid', v: 100 }] as pr}
								<button type="button" onclick={() => { infill = pr.v; invalidatePreview(); }} class="rounded px-2 py-0.5 text-xs {infill === pr.v ? 'bg-spark-soft text-spark-deep' : 'bg-warm-100 text-muted-ink hover:bg-warm-200'}">{pr.l}</button>
							{/each}
						</div>
					</div>

					<div>
						<span class="label">Print speed</span>
						<div class="grid grid-cols-4 gap-1.5">
							{#each SPEED as s}<button type="button" onclick={() => (speed = s.v)} class="btn btn-sm {speed === s.v ? 'btn-primary' : 'btn-secondary'}">{s.label}</button>{/each}
						</div>
						<p class="mt-1 text-xs text-muted-ink">Faster prints can lower quality. You can change this mid-print too.</p>
					</div>

					<div>
						<div class="mb-1 flex items-center justify-between"><span class="label mb-0">Bed temperature</span><span class="text-xs font-semibold text-ink">{bedTemp ? `${bedTemp}°C` : 'Auto'}</span></div>
						<input type="range" min="0" max="110" step="5" value={bedTemp ?? 60} oninput={(e) => { bedTemp = Number(e.currentTarget.value); invalidatePreview(); }} class="w-full accent-[#1e2f66]" />
						<div class="mt-1 flex flex-wrap gap-1.5">
							<button type="button" onclick={() => { bedTemp = null; invalidatePreview(); }} class="rounded px-2 py-0.5 text-xs {bedTemp === null ? 'bg-spark-soft text-spark-deep' : 'bg-warm-100 text-muted-ink hover:bg-warm-200'}">Auto</button>
							{#each [55, 60, 65, 75, 90] as t}
								<button type="button" onclick={() => { bedTemp = t; invalidatePreview(); }} class="rounded px-2 py-0.5 text-xs {bedTemp === t ? 'bg-spark-soft text-spark-deep' : 'bg-warm-100 text-muted-ink hover:bg-warm-200'}">{t}°</button>
							{/each}
						</div>
						<p class="mt-1 text-xs text-muted-ink">Auto uses the recommended temp (PLA 60°C). Higher helps the first layer stick.</p>
					</div>

					<label class="flex items-center gap-2.5 text-sm font-medium text-soft-ink"><input type="checkbox" bind:checked={supports} onchange={invalidatePreview} class="h-4 w-4 rounded accent-[#1e2f66]" /> Supports <span class="text-xs font-normal text-muted-ink">— for overhangs</span></label>
					<label class="flex items-center gap-2.5 text-sm font-medium text-soft-ink"><input type="checkbox" bind:checked={raft} onchange={invalidatePreview} class="h-4 w-4 rounded accent-[#1e2f66]" /> Raft <span class="text-xs font-normal text-muted-ink">— helps stick to the plate</span></label>
					<div><label class="label" for="cp">Copies</label><input class="input max-w-[6rem]" id="cp" name="copies" type="number" min="1" max="20" bind:value={copies} /></div>

					<div class="space-y-3 border-t border-warm-200 pt-3">
						{#if sliceError}<div class="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{sliceError}</div>{/if}

						{#if data.approvalMode}<div class="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-[#a35f00]"><Icon name="clock" size={16} /> A teacher approves before it prints.</div>{/if}
						<div class="flex items-center justify-between text-sm"><span class="text-muted-ink">Quota left</span><span class="font-semibold text-ink">{data.usage.gramsRemaining ?? '∞'} g · {data.usage.jobsRemaining ?? '∞'} prints</span></div>

						{#if preview || sliceNote}
							<button type="button" onclick={() => (sliceModalOpen = true)} class="btn btn-primary w-full"><Icon name="eye" size={16} /> Review &amp; print</button>
							<button type="submit" formaction="?/slice" class="btn btn-secondary btn-sm w-full" disabled={slicing}>
								{#if slicing}Re-slicing…{:else}Re-slice{/if}
							</button>
						{:else}
							<button type="submit" formaction="?/slice" class="btn btn-primary w-full" disabled={!canSlice || slicing}>
								{#if slicing}Slicing…{:else}<Icon name="layers" size={16} /> Slice &amp; preview{/if}
							</button>
							{#if !canSlice}<p class="text-center text-xs text-muted-ink">Add a model and color to slice.</p>{/if}
						{/if}
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

					<!-- Preview baked into the sliced file -->
					{#if uploadPreview}
						<div class="overflow-hidden rounded-xl border border-warm-200">
							{#if uploadPreview.thumbnail}
								<img src={uploadPreview.thumbnail} alt="Sliced plate preview" class="block w-full bg-[#2b2b2b] object-contain" />
							{/if}
							<div class="grid grid-cols-3 divide-x divide-warm-200 {uploadPreview.thumbnail ? 'border-t border-warm-200' : ''} text-center">
								<div class="px-1 py-2"><div class="text-xs text-muted-ink">Time</div><div class="text-sm font-semibold text-ink">{fmtTime(uploadPreview.timeSec)}</div></div>
								<div class="px-1 py-2"><div class="text-xs text-muted-ink">Filament</div><div class="text-sm font-semibold text-ink">{fmtGrams(uploadPreview.grams)}</div></div>
								<div class="px-1 py-2"><div class="text-xs text-muted-ink">Layers</div><div class="text-sm font-semibold text-ink">{uploadPreview.layers || '—'}</div></div>
							</div>
						</div>
					{/if}

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
													class="relative h-8 w-8 rounded-lg border-2 transition-transform hover:scale-110 {filamentColors[i]?.colorHex === c.colorHex && filamentColors[i]?.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{swatch(c.colorHex)}">
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
					<input type="hidden" name="colorHex" value={filamentColors[0]?.colorHex ?? '#1E2F66'} />
					<input type="hidden" name="filamentType" value={filamentColors[0]?.filamentType ?? 'PLA'} />
					<button class="btn btn-primary w-full" disabled={submitting || !uploadReady}>
						{#if submitting}Sending…{:else}<Icon name="bolt" size={16} /> Send sliced file to print{/if}
					</button>
					{#if detected.length && !uploadReady}<p class="text-center text-xs text-muted-ink">Pick a lab color for each filament.</p>{/if}
				</form>
			{/if}
			</div>
		</aside>
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

<!-- "Print sliced" result modal — rendered at the page root (not inside the backdrop-blurred side
     panel, whose filter would otherwise trap this fixed overlay) so it covers the whole page. The
     Print-now button is linked to the design form via form="printForm". -->
{#if sliceModalOpen}
	<Modal bind:open={sliceModalOpen} title="Print sliced">
		<div class="space-y-4">
			<div class="flex items-center gap-3">
				<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"><Icon name="check" size={24} /></div>
				<div class="min-w-0">
					<p class="text-base font-semibold text-ink">Your model is sliced and ready</p>
					<p class="truncate text-sm text-muted-ink">{name || 'Untitled print'}{selected ? ` · ${selected.colorName ?? selected.colorHex}` : anyColor ? ' · No color preference' : ''}</p>
				</div>
			</div>

			{#if preview}
				{#if preview.thumbnail}
					<img src={preview.thumbnail} alt="Sliced plate preview" class="block max-h-72 w-full rounded-xl border border-warm-200 bg-[#2b2b2b] object-contain" />
				{/if}
				<div class="grid grid-cols-3 divide-x divide-warm-200 rounded-xl border border-warm-200 text-center">
					<div class="px-2 py-3"><div class="text-xs text-muted-ink">Time</div><div class="text-base font-semibold text-ink">{fmtTime(preview.timeSec)}</div></div>
					<div class="px-2 py-3"><div class="text-xs text-muted-ink">Filament</div><div class="text-base font-semibold text-ink">{fmtGrams(preview.grams)}</div></div>
					<div class="px-2 py-3"><div class="text-xs text-muted-ink">Layers</div><div class="text-base font-semibold text-ink">{preview.layers || '—'}</div></div>
				</div>
			{:else if sliceNote}
				<div class="rounded-lg bg-warm-50 px-3 py-2 text-sm text-muted-ink">{sliceNote}</div>
			{/if}

			<div class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
				<span class="text-muted-ink">Quality <span class="font-medium text-ink">{quality} mm · {infill}% infill</span></span>
				<span class="text-muted-ink">Speed <span class="font-medium text-ink">{SPEED.find((s) => s.v === speed)?.label}</span></span>
				{#if copies > 1}<span class="text-muted-ink">Copies <span class="font-medium text-ink">{copies}</span></span>{/if}
			</div>

			{#if data.approvalMode}<div class="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-[#a35f00]"><Icon name="clock" size={16} /> A teacher approves before it prints.</div>{/if}

			<p class="pt-1 text-center text-base font-semibold text-ink">Print now?</p>
			<div class="flex gap-2">
				<button type="button" class="btn btn-secondary flex-1" onclick={() => (sliceModalOpen = false)}>Back</button>
				<button type="submit" form="printForm" formaction="?/submit" class="btn btn-primary flex-1" disabled={!canSubmit || submitting}>
					{#if submitting}Sending…{:else}<Icon name="bolt" size={16} /> {data.approvalMode ? 'Submit for approval' : 'Print now'}{/if}
				</button>
			</div>
			{#if !canSubmit}<p class="text-center text-xs text-muted-ink">Add a print name to send it.</p>{/if}
		</div>
	</Modal>
{/if}
