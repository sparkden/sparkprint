<script lang="ts">
	import { enhance } from '$app/forms';
	import StudioEditor from '$lib/components/StudioEditor.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();

	let name = $state('');
	let selected = $state<(typeof data.colors)[number] | null>(data.colors.find((c) => c.available) ?? data.colors[0] ?? null);
	let quality = $state(0.2); // layer height
	let supports = $state(false);
	let raft = $state(false);
	let copies = $state(1);
	let mode = $state<'design' | 'upload'>('design'); // 'upload' = print a Bambu Studio .gcode.3mf
	let stats = $state<{ bbox: { x: number; y: number; z: number }; volumeMm3: number; triangles: number; objects: number } | null>(null);
	let submitting = $state(false);

	let editor: StudioEditor;
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);

	// Default build plate (256³); auto-assigned later to whichever printer has the color.
	const plate = { x: 256, y: 256, z: 256 };
	const hasModel = $derived((stats?.objects ?? 0) > 0);
	const canSubmit = $derived(hasModel && !!selected && !!name);

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
</script>

<svelte:head><title>New print · SparkPrint</title></svelte:head>

<div class="mx-auto max-w-7xl">
	<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<div><h1 class="text-2xl font-semibold">New print</h1><p class="mt-1 text-sm text-soft-ink">Add your model, pick a color, and send it to the lab.</p></div>
		{#if !form?.success}
			<div class="inline-flex rounded-xl border border-warm-200 bg-surface p-1 text-sm shadow-xs">
				<button type="button" onclick={() => (mode = 'design')} class="rounded-lg px-3 py-1.5 font-medium {mode === 'design' ? 'bg-spark-soft text-spark-deep' : 'text-muted-ink hover:text-ink'}">Design &amp; slice</button>
				<button type="button" onclick={() => (mode = 'upload')} class="rounded-lg px-3 py-1.5 font-medium {mode === 'upload' ? 'bg-spark-soft text-spark-deep' : 'text-muted-ink hover:text-ink'}">Upload sliced file</button>
			</div>
		{/if}
	</div>

	{#if form?.success}
		<!-- Success: tell the student exactly where it's printing -->
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
	{:else}
		{#if form?.error}<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>{/if}

		{#if mode === 'design'}
		<form method="POST" action="?/submit" enctype="multipart/form-data"
			use:enhance={({ formData, cancel }) => {
				if (!canSubmit) { cancel(); return; }
				submitting = true;
				const stl = editor?.exportSTL?.();
				if (stl) formData.set('file', stl, (name || 'model') + '.stl');
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
			class="grid gap-5 lg:grid-cols-12">
			<input bind:this={fileInput} type="file" accept=".stl,.obj,.3mf" multiple class="hidden" onchange={onInput} />

			<!-- Editor -->
			<div class="lg:col-span-8">
				<div class="relative h-[440px] lg:h-[620px]" role="button" tabindex="0"
					ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)} ondrop={onDrop}>
					<StudioEditor bind:this={editor} colorHex={selected?.colorHex ?? '#FF5B14'} {plate} onstats={(s) => (stats = s)} />
					{#if !hasModel}
						<button type="button" onclick={() => fileInput?.click()}
							class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed {dragOver ? 'border-spark bg-spark-soft/50' : 'border-warm-300'} transition-colors">
							<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-spark-soft text-spark-deep"><Icon name="upload" size={26} /></div>
							<div class="text-center"><p class="font-semibold text-ink">Drop a model or click to browse</p><p class="text-sm text-muted-ink">STL, OBJ, or 3MF · add as many as you like</p></div>
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

			<!-- Simple settings -->
			<div class="space-y-4 lg:col-span-4">
				<div class="card space-y-4 p-5">
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
						{/if}
					</div>
				</div>

				<div class="card space-y-4 p-5">
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
				</div>

				<div class="card space-y-3 p-5">
					{#if data.approvalMode}<div class="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-[#a35f00]"><Icon name="clock" size={16} /> A teacher approves before it prints.</div>{/if}
					<div class="flex items-center justify-between text-sm"><span class="text-muted-ink">Quota left</span><span class="font-semibold text-ink">{data.usage.gramsRemaining ?? '∞'} g · {data.usage.jobsRemaining ?? '∞'} prints</span></div>
					<button class="btn btn-primary w-full" disabled={!canSubmit || submitting}>
						{#if submitting}Sending…{:else}<Icon name="bolt" size={16} /> {data.approvalMode ? 'Submit for approval' : 'Send to print'}{/if}
					</button>
					{#if !canSubmit}<p class="text-center text-xs text-muted-ink">Add a model, name, and color to continue.</p>{/if}
				</div>
			</div>
		</form>
		{:else}
		<!-- Upload a file already sliced in Bambu Studio / OrcaSlicer -->
		<form method="POST" action="?/uploadSliced" enctype="multipart/form-data"
			use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }}
			class="mx-auto grid max-w-2xl gap-4 card p-6">
			<div>
				<p class="text-sm text-soft-ink">Already sliced your plate in <b>Bambu Studio</b>? Export it (File → Export → <b>Export plate sliced file</b>, a <code>.gcode.3mf</code>) and drop it here — it prints as-is, no re-slicing.</p>
			</div>
			<div>
				<label class="label" for="uf">Sliced file (.gcode.3mf)</label>
				<input class="input" id="uf" name="file" type="file" accept=".3mf,.gcode.3mf" required />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div><label class="label" for="un">Name</label><input class="input" id="un" name="name" placeholder="My print" /></div>
				<div><label class="label" for="ucp">Copies</label><input class="input" id="ucp" name="copies" type="number" min="1" max="20" value="1" /></div>
			</div>
			<div>
				<div class="mb-2 flex items-center justify-between"><span class="label mb-0">Color to route to</span>{#if selected}<span class="text-xs text-muted-ink">{selected.colorName ?? selected.colorHex} · {selected.filamentType}</span>{/if}</div>
				{#if data.colors.length === 0}<p class="text-sm text-muted-ink">No colors loaded yet. Ask your teacher.</p>
				{:else}
					<div class="flex flex-wrap gap-2">
						{#each data.colors as c}
							<button type="button" title="{c.colorName ?? c.colorHex} · {c.filamentType}" onclick={() => (selected = c)}
								class="relative h-9 w-9 rounded-lg border-2 transition-transform hover:scale-110 {selected?.colorHex === c.colorHex && selected?.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{c.colorHex}">
								{#if c.available}<span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-success"></span>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<input type="hidden" name="colorHex" value={selected?.colorHex ?? '#FF5B14'} />
			<input type="hidden" name="colorName" value={selected?.colorName ?? ''} />
			<input type="hidden" name="filamentType" value={selected?.filamentType ?? 'PLA'} />
			<button class="btn btn-primary w-full" disabled={submitting || !selected}>
				{#if submitting}Sending…{:else}<Icon name="bolt" size={16} /> Send sliced file to print{/if}
			</button>
			{#if !selected}<p class="text-center text-xs text-muted-ink">Pick a color so we can route it to a printer that has it.</p>{/if}
		</form>
		{/if}
	{/if}
</div>
