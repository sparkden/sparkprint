<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';

	type V3 = { x: number; y: number; z: number };
	type Stats = { bbox: V3; volumeMm3: number; triangles: number; objects: number };
	type ObjRow = { id: string; name: string };

	let {
		colorHex = '#FF5B14',
		plate = { x: 256, y: 256, z: 256 },
		onstats
	}: { colorHex?: string; plate?: V3; onstats?: (s: Stats) => void } = $props();

	let objects = $state<ObjRow[]>([]);
	let selectedId = $state<string | null>(null);
	let mode = $state<'translate' | 'rotate' | 'scale'>('translate');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let selInfo = $state<{ w: number; d: number; h: number; scalePct: number } | null>(null);

	let container: HTMLDivElement;
	let THREE: any, STLExporter: any;
	let renderer: any, scene: any, camera: any, orbit: any, gizmo: any, gizmoHelper: any, raycaster: any;
	let plateGroup: any;
	const meshes = new Map<string, any>(); // id → Mesh (Y-up display; transform authoritative)

	const uid = () => 'o' + Math.random().toString(36).slice(2, 9);
	const selected = $derived(objects.find((o) => o.id === selectedId) ?? null);

	export function captureThumbnail(): string | null {
		if (!renderer) return null;
		const wasVisible = gizmoHelper?.visible;
		if (gizmoHelper) gizmoHelper.visible = false;
		renderer.render(scene, camera);
		let url: string | null = null;
		try { url = renderer.domElement.toDataURL('image/png'); } catch { /* */ }
		if (gizmoHelper) gizmoHelper.visible = wasVisible;
		return url;
	}
	export function count() { return objects.length; }
	export function hasPaint() { return false; }

	/** Export all objects as one binary STL, converted back to Z-up for the slicer. */
	export function exportSTL(): Blob | null {
		if (!objects.length || !STLExporter) return null;
		const group = new THREE.Group();
		for (const o of objects) {
			const m = meshes.get(o.id);
			if (!m) continue;
			m.updateMatrixWorld(true);
			const g = m.geometry.clone();
			g.applyMatrix4(m.matrixWorld);
			g.rotateX(Math.PI / 2); // Y-up display → Z-up for slicing
			group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
		}
		group.updateMatrixWorld(true);
		const out = new STLExporter().parse(group, { binary: true });
		const buf = out instanceof DataView ? out.buffer : out;
		return new Blob([buf as BlobPart], { type: 'model/stl' });
	}

	// ── geometry / objects ────────────────────────────────────────────────────
	function signedVolume(geom: any): number {
		const p = geom.getAttribute('position');
		let v = 0;
		for (let i = 0; i < p.count; i += 3) {
			const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i), bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1), cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
			v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
		}
		return Math.abs(v);
	}
	function dropToPlate(m: any) {
		m.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(m);
		m.position.y -= box.min.y; // sit on plate (y = 0)
	}

	function addGeometry(geometry: any, name: string) {
		let g = geometry.index ? geometry.toNonIndexed() : geometry;
		g.rotateX(-Math.PI / 2); // model Z-up → three Y-up (display)
		g.computeVertexNormals();
		g.center();
		const id = uid();
		const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.5, metalness: 0.04 });
		const m = new THREE.Mesh(g, mat);
		m.castShadow = true;
		m.userData.id = id;
		scene.add(m);
		dropToPlate(m);
		meshes.set(id, m);
		objects = [...objects, { id, name }];
		selectedId = id;
		autoArrange();
		frameCamera();
		select(id);
		emitStats();
	}

	export async function addObject(file: File) {
		if (!THREE) return;
		loading = true; errorMsg = null;
		try {
			const buf = await file.arrayBuffer();
			const ext = file.name.split('.').pop()?.toLowerCase();
			let geometry: any;
			if (ext === 'stl') {
				const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
				geometry = new STLLoader().parse(buf);
			} else if (ext === 'obj') {
				const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
				const o = new OBJLoader().parse(new TextDecoder().decode(buf));
				o.traverse((c: any) => { if (c.isMesh && !geometry) geometry = c.geometry; });
			} else if (ext === '3mf') {
				const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
				const gg = new ThreeMFLoader().parse(buf);
				gg.traverse((c: any) => { if (c.isMesh && !geometry) geometry = c.geometry; });
			} else throw new Error('Unsupported file. Use STL, OBJ, or 3MF.');
			if (!geometry) throw new Error('No printable mesh found.');
			addGeometry(geometry, file.name.replace(/\.(stl|obj|3mf)$/i, ''));
		} catch (e: any) {
			errorMsg = e?.message ?? 'Could not load model.';
		} finally {
			loading = false;
		}
	}

	function select(id: string | null) {
		selectedId = id;
		if (gizmo) {
			const m = id ? meshes.get(id) : null;
			if (m) gizmo.attach(m); else gizmo.detach();
		}
		updateSelInfo();
	}
	function removeSelected() {
		if (!selectedId) return;
		removeObject(selectedId);
	}
	function removeObject(id: string) {
		const m = meshes.get(id);
		if (m) {
			if (gizmo && selectedId === id) gizmo.detach();
			scene.remove(m); m.geometry.dispose(); m.material.dispose();
		}
		meshes.delete(id);
		objects = objects.filter((o) => o.id !== id);
		select(objects[0]?.id ?? null);
		emitStats();
	}
	function duplicateSelected() {
		if (!selectedId) return;
		const src = meshes.get(selectedId); const row = objects.find((o) => o.id === selectedId);
		if (!src || !row) return;
		addGeometry(src.geometry.clone().applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)), row.name + ' copy');
		// (re-bake to Z-up first so addGeometry's -90 X restores orientation)
	}

	function footprint(m: any) {
		const box = new THREE.Box3().setFromObject(m); const s = new THREE.Vector3(); box.getSize(s);
		return { w: s.x, d: s.z };
	}
	function autoArrange() {
		const gap = 8;
		let x = -plate.x / 2 + gap, z = -plate.y / 2 + gap, rowD = 0;
		for (const o of objects) {
			const m = meshes.get(o.id); if (!m) continue;
			const fp = footprint(m);
			if (x + fp.w > plate.x / 2 - gap) { x = -plate.x / 2 + gap; z += rowD + gap; rowD = 0; }
			m.position.x = +(x + fp.w / 2).toFixed(2);
			m.position.z = +(z + fp.d / 2).toFixed(2);
			dropToPlate(m);
			x += fp.w + gap; rowD = Math.max(rowD, fp.d);
		}
		emitStats();
	}
	function layFlatSelected() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		m.rotation.set(0, 0, 0);
		dropToPlate(m);
		updateSelInfo(); emitStats();
	}
	function mirrorSelected(axis: 'x' | 'y' | 'z') {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		m.scale[axis] *= -1;
		dropToPlate(m); updateSelInfo(); emitStats();
	}

	function updateSelInfo() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) { selInfo = null; return; }
		const box = new THREE.Box3().setFromObject(m); const s = new THREE.Vector3(); box.getSize(s);
		selInfo = { w: +s.x.toFixed(1), d: +s.z.toFixed(1), h: +s.y.toFixed(1), scalePct: Math.round(Math.abs(m.scale.x) * 100) };
	}
	function emitStats() {
		if (!objects.length) { onstats?.({ bbox: { x: 0, y: 0, z: 0 }, volumeMm3: 0, triangles: 0, objects: 0 }); return; }
		const box = new THREE.Box3(); let tris = 0, vol = 0;
		for (const o of objects) { const m = meshes.get(o.id); if (!m) continue; box.expandByObject(m); tris += m.geometry.getAttribute('position').count / 3; vol += signedVolume(m.geometry) * Math.abs(m.scale.x * m.scale.y * m.scale.z); }
		const s = new THREE.Vector3(); box.getSize(s);
		onstats?.({ bbox: { x: +s.x.toFixed(1), y: +s.z.toFixed(1), z: +s.y.toFixed(1) }, volumeMm3: Math.round(vol), triangles: Math.round(tris), objects: objects.length });
	}
	function frameCamera() {
		if (!objects.length) return;
		const box = new THREE.Box3(); for (const o of objects) { const m = meshes.get(o.id); if (m) box.expandByObject(m); }
		const s = new THREE.Vector3(); box.getSize(s); const c = new THREE.Vector3(); box.getCenter(c);
		const d = Math.max(s.x, s.y, s.z, 60) * 2 + 100;
		camera.position.set(c.x + d * 0.7, c.y + d * 0.6, c.z + d * 0.7); orbit.target.copy(c); orbit.update();
	}

	function buildPlate() {
		if (plateGroup) scene.remove(plateGroup);
		plateGroup = new THREE.Group();
		const mx = Math.max(plate.x, plate.y);
		const grid = new THREE.GridHelper(mx, Math.round(mx / 20), 0xb6aba0, 0xd6ccbc);
		(grid.material as any).opacity = 0.8; (grid.material as any).transparent = true;
		plateGroup.add(grid);
		const plane = new THREE.Mesh(new THREE.PlaneGeometry(plate.x, plate.y), new THREE.MeshStandardMaterial({ color: 0xece3d5, roughness: 0.95 }));
		plane.rotation.x = -Math.PI / 2; plane.position.y = -0.12; plane.receiveShadow = true; plateGroup.add(plane);
		plateGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(plate.x, 0.2, plate.y)), new THREE.LineBasicMaterial({ color: 0xff5b14 })));

		// Ruler: labeled ticks every 50 mm along the front (X) and left (Y) edges.
		const label = (text: string) => {
			const c = document.createElement('canvas');
			c.width = 96; c.height = 48;
			const ctx = c.getContext('2d')!;
			ctx.fillStyle = '#5d534a'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText(text, 48, 24);
			const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }));
			spr.scale.set(24, 12, 1);
			return spr;
		};
		for (let d = 0; d <= plate.x; d += 50) {
			const s = label(String(d)); s.position.set(-plate.x / 2 + d, 1, plate.y / 2 + 13); plateGroup.add(s);
		}
		for (let d = 0; d <= plate.y; d += 50) {
			if (d === 0) continue; // 0 already shown on the X edge corner
			const s = label(String(d)); s.position.set(-plate.x / 2 - 14, 1, -plate.y / 2 + d); plateGroup.add(s);
		}
		const unit = label('mm'); unit.position.set(-plate.x / 2 - 14, 1, plate.y / 2 + 13); plateGroup.add(unit);

		scene.add(plateGroup);
	}

	function applyMode(m: 'translate' | 'rotate' | 'scale') {
		mode = m;
		if (gizmo && gizmo.setMode) {
			gizmo.setMode(m);
			gizmo.showX = true;
			gizmo.showZ = true;
			gizmo.showY = m !== 'translate';
		}
	}
	$effect(() => { for (const o of objects) { const m = meshes.get(o.id); if (m) m.material.color = new THREE.Color(colorHex); } void colorHex; });
	$effect(() => { plate.x; plate.y; if (THREE && scene) buildPlate(); });

	function onPointerDown(ev: PointerEvent) {
		if (gizmo?.dragging) return;
		const rect = renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
		raycaster.setFromCamera(ndc, camera);
		const hit = raycaster.intersectObjects([...meshes.values()], false)[0];
		if (hit?.object?.userData?.id) select(hit.object.userData.id);
	}
	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		const k = e.key.toLowerCase();
		if (k === 'm') { applyMode('translate'); }
		else if (k === 'r') { applyMode('rotate'); }
		else if (k === 's') { applyMode('scale'); }
		else if (k === 'a') { autoArrange(); }
		else if (k === 'l') { layFlatSelected(); }
		else if (k === 'escape') { select(null); }
		else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(); }
		else if (k === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); duplicateSelected(); }
		else return;
	}

	onMount(() => {
		let raf = 0, ro: ResizeObserver;
		(async () => {
			THREE = await import('three');
			({ STLExporter } = await import('three/addons/exporters/STLExporter.js'));
			const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
			const { TransformControls } = await import('three/addons/controls/TransformControls.js');

			scene = new THREE.Scene();
			scene.background = new THREE.Color('#FBF5EC'); // light warm-paper viewport
			camera = new THREE.PerspectiveCamera(45, 1, 0.1, 9000);
			camera.position.set(240, 200, 240);
			renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
			renderer.shadowMap.enabled = true;
			container.appendChild(renderer.domElement);

			orbit = new OrbitControls(camera, renderer.domElement);
			orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.maxPolarAngle = Math.PI / 2.02;
			raycaster = new THREE.Raycaster();

			scene.add(new THREE.HemisphereLight(0xffffff, 0xd6ccbc, 1.15));
			const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(120, 240, 150); key.castShadow = true;
			key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 1; key.shadow.camera.far = 1600; scene.add(key);
			buildPlate();

			gizmo = new TransformControls(camera, renderer.domElement);
			gizmo.setMode(mode);
			gizmo.setSize(0.9);
			gizmoHelper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
			scene.add(gizmoHelper);
			gizmo.addEventListener('dragging-changed', (e: any) => {
				orbit.enabled = !e.value;
				if (!e.value && selectedId) { const m = meshes.get(selectedId); if (m && mode !== 'translate') dropToPlate(m); updateSelInfo(); emitStats(); }
			});
			gizmo.addEventListener('objectChange', () => { updateSelInfo(); });

			const el = renderer.domElement;
			el.addEventListener('pointerdown', onPointerDown);
			window.addEventListener('keydown', onKey);

			function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
			ro = new ResizeObserver(resize); ro.observe(container); resize();
			(function animate() { raf = requestAnimationFrame(animate); orbit.update(); renderer.render(scene, camera); })();
		})();
		return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('keydown', onKey); renderer?.dispose?.(); if (renderer?.domElement && container?.contains(renderer.domElement)) container.removeChild(renderer.domElement); };
	});

	const tools = [
		{ id: 'translate', icon: 'move', label: 'Move', key: 'M' },
		{ id: 'rotate', icon: 'rotate', label: 'Rotate', key: 'R' },
		{ id: 'scale', icon: 'scale', label: 'Scale', key: 'S' }
	] as const;
</script>

<div class="relative h-full w-full overflow-hidden rounded-xl border border-warm-200 bg-soft-paper" bind:this={container}>
	<div class="pointer-events-none absolute left-3 top-3 rounded-md border border-warm-200 bg-surface/80 px-2 py-1 text-[11px] font-medium text-soft-ink backdrop-blur">
		{plate.x} × {plate.y} × {plate.z} mm{#if objects.length} · {objects.length} object{objects.length === 1 ? '' : 's'}{/if}
	</div>
	{#if loading}<div class="absolute inset-0 flex items-center justify-center bg-surface/60 text-sm text-soft-ink">Loading…</div>{/if}
	{#if errorMsg}<div role="button" tabindex="0" onclick={() => (errorMsg = null)} onkeydown={() => (errorMsg = null)} class="absolute inset-x-3 bottom-3 z-10 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{errorMsg}</div>{/if}
	{#if objects.length === 0 && !loading}<div class="absolute inset-0 flex items-center justify-center text-sm text-muted-ink">Add a model to start</div>{/if}

	{#if objects.length}
		<!-- Tool rail -->
		<div class="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-warm-200 bg-surface/95 p-1.5 shadow-lg backdrop-blur">
			{#each tools as t}
				<button type="button" title="{t.label} ({t.key})" onclick={() => applyMode(t.id)} class="flex h-9 w-9 items-center justify-center rounded-lg transition-colors {mode === t.id ? 'bg-spark text-white' : 'text-soft-ink hover:bg-warm-100'}"><Icon name={t.icon} size={18} /></button>
			{/each}
			<span class="my-0.5 h-px w-full bg-warm-200"></span>
			<button type="button" title="Lay flat (L)" onclick={layFlatSelected} class="flex h-9 w-9 items-center justify-center rounded-lg text-soft-ink hover:bg-warm-100"><Icon name="layers" size={18} /></button>
			<button type="button" title="Auto-arrange (A)" onclick={autoArrange} class="flex h-9 w-9 items-center justify-center rounded-lg text-soft-ink hover:bg-warm-100"><Icon name="dashboard" size={18} /></button>
		</div>

		<!-- Object list -->
		<div class="absolute right-3 top-3 max-h-[45%] w-52 overflow-y-auto rounded-xl border border-warm-200 bg-surface/95 p-2 text-ink shadow-lg backdrop-blur">
			<p class="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-ink">Objects</p>
			{#each objects as o}
				<div class="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs {o.id === selectedId ? 'bg-spark-soft text-spark-deep' : ''}">
					<button type="button" class="flex-1 truncate text-left hover:text-spark" onclick={() => select(o.id)}>{o.name}</button>
					<button type="button" title="Duplicate (Ctrl+D)" class="text-muted-ink hover:text-ink" onclick={() => { select(o.id); duplicateSelected(); }}><Icon name="plus" size={13} /></button>
					<button type="button" title="Delete (Del)" class="text-muted-ink hover:text-danger" onclick={() => removeObject(o.id)}><Icon name="trash" size={13} /></button>
				</div>
			{/each}
		</div>

		<!-- Selected object info + mirror -->
		{#if selected && selInfo}
			<div class="absolute bottom-3 left-16 rounded-xl border border-warm-200 bg-surface/95 px-3 py-2 text-ink shadow-lg backdrop-blur">
				<div class="flex items-center gap-3 text-xs">
					<span class="font-semibold">{selected.name}</span>
					<span class="text-muted-ink">{selInfo.w} × {selInfo.d} × {selInfo.h} mm</span>
					<span class="text-muted-ink">{selInfo.scalePct}%</span>
					<span class="h-3 w-px bg-warm-200"></span>
					<span class="text-muted-ink">Mirror</span>
					{#each ['x', 'y', 'z'] as ax}
						<button type="button" class="rounded bg-warm-100 px-1.5 py-0.5 hover:bg-warm-200" onclick={() => mirrorSelected(ax as 'x')}>{ax.toUpperCase()}</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Shortcut hint -->
		<div class="pointer-events-none absolute bottom-3 right-3 rounded-md border border-warm-200 bg-surface/80 px-2 py-1 text-[10px] text-muted-ink backdrop-blur">
			M move · R rotate · S scale · A arrange · L flat · Del delete
		</div>
	{/if}
</div>
