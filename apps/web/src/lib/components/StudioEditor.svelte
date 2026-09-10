<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import { build3MF } from '$lib/threemf';

	type V3 = { x: number; y: number; z: number };
	type Obj = {
		id: string;
		name: string;
		color: string;
		pos: { x: number; y: number };
		rot: V3;
		scale: V3;
		mirror: { x: boolean; y: boolean; z: boolean };
	};
	type Stats = { bbox: V3; volumeMm3: number; triangles: number; objects: number };

	type Swatch = { colorHex: string; colorName?: string | null; filamentType: string };
	let {
		colorHex = '#FF5B14',
		plate = { x: 256, y: 256, z: 256 },
		palette = [],
		onstats
	}: { colorHex?: string; plate?: V3; palette?: Swatch[]; onstats?: (s: Stats) => void } = $props();

	// Reactive UI state
	let objects = $state<Obj[]>([]);
	let selectedId = $state<string | null>(null);
	let tool = $state<'move' | 'rotate' | 'scale' | 'mirror' | 'cut' | 'boolean' | 'text' | 'paint'>('move');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let busy = $state<string | null>(null);

	// Tool params
	let cutZ = $state(10);
	let boolOp = $state<'union' | 'difference' | 'intersection'>('difference');
	let textValue = $state('SparkPrint');
	let textSize = $state(10);
	let textDepth = $state(2);
	let paintMode = $state<'color' | 'support' | 'seam'>('support');
	let paintColorHex = $state<string>('#00AE42'); // brush color (from palette) for color paint
	let supportSub = $state<'enforcer' | 'blocker'>('enforcer');
	let painting = false;
	let paintVersion = $state(0); // bumps when paint changes, so hasPaint/usedColors recompute

	const selected = $derived(objects.find((o) => o.id === selectedId) ?? null);

	// Per-facet paint state, non-reactive, keyed by object id.
	// colorHex[f] = '' (base) or a hex; support[f] = 0 none|1 enforcer|2 blocker; seam[f] = 0|1
	type Paint = { colorHex: string[]; support: Uint8Array; seam: Uint8Array };
	const paintData = new Map<string, Paint>();

	// Non-reactive three.js state
	let container: HTMLDivElement;
	let THREE: any, STLExporter: any, csg: any, font: any, FontLoader: any, TextGeometry: any;
	let renderer: any, scene: any, camera: any, controls: any, raycaster: any;
	let world: any; // group rotated so model Z-up → three Y-up
	let plateGroup: any;
	const meshes = new Map<string, any>(); // id → THREE.Mesh (geometry in model space)
	const geoms = new Map<string, any>(); // id → base BufferGeometry (model space, min z 0, centered xy)

	const rad = (d: number) => (d * Math.PI) / 180;
	const uid = () => 'o' + Math.random().toString(36).slice(2, 9);

	export function captureThumbnail(): string | null {
		if (!renderer) return null;
		renderer.render(scene, camera);
		try { return renderer.domElement.toDataURL('image/png'); } catch { return null; }
	}

	export function count() { return objects.length; }

	/** Combine all objects (model-space, transforms baked) into one binary STL. */
	export function exportSTL(): Blob | null {
		if (!objects.length || !STLExporter) return null;
		const group = new THREE.Group();
		for (const o of objects) {
			const g = geoms.get(o.id);
			if (!g) continue;
			const m = new THREE.Mesh(g.clone(), new THREE.MeshStandardMaterial());
			applyModelTransform(m, o);
			group.add(m);
		}
		group.updateMatrixWorld(true);
		const out = new STLExporter().parse(group, { binary: true });
		const buf = out instanceof DataView ? out.buffer : out;
		return new Blob([buf], { type: 'model/stl' });
	}

	function usedPaintColorList(): string[] {
		const set: string[] = [];
		for (const p of paintData.values()) for (const h of p.colorHex) if (h && !set.includes(h)) set.push(h);
		return set;
	}
	export function hasPaint(): boolean {
		void paintVersion;
		for (const p of paintData.values()) {
			if (p.support.some((v) => v) || p.seam.some((v) => v) || p.colorHex.some((h) => h)) return true;
		}
		return false;
	}
	export function hasSupportPaint(): boolean {
		void paintVersion;
		for (const p of paintData.values()) if (p.support.some((v) => v === 1)) return true;
		return false;
	}
	/** Distinct painted colors mapped to palette swatches — the extra filaments (index 1..N). */
	export function usedColors(): Swatch[] {
		void paintVersion;
		return usedPaintColorList().map(
			(hex) => palette.find((s) => s.colorHex.toLowerCase() === hex.toLowerCase()) ?? { colorHex: hex, colorName: null, filamentType: 'PLA' }
		);
	}
	/** Export a Bambu 3MF carrying per-triangle support/seam/color paint. */
	export function export3MF(): Blob | null {
		if (!objects.length) return null;
		const used = usedPaintColorList();
		const parts = objects.map((o) => {
			const g = bakedGeometry(o);
			const pos = g.getAttribute('position').array as Float32Array;
			const p = paintData.get(o.id)!;
			const n = pos.length / 9;
			const colorIndex = new Int16Array(n);
			for (let i = 0; i < n; i++) { const h = p.colorHex[i]; colorIndex[i] = h ? used.indexOf(h) + 1 : 0; }
			return { positions: pos, support: p.support, seam: p.seam, colorIndex };
		});
		return new Blob([build3MF(parts, 1 + used.length) as BlobPart], { type: 'model/3mf' });
	}

	// ── geometry helpers ──────────────────────────────────────────────────────
	function prep(geometry: any) {
		// non-indexed + vertex colors so painting works; centered in XY, min Z = 0
		let g = geometry.index ? geometry.toNonIndexed() : geometry;
		g.computeVertexNormals();
		g.computeBoundingBox();
		const b = g.boundingBox;
		const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
		g.translate(-cx, -cy, -b.min.z);
		if (!g.getAttribute('color')) {
			const n = g.getAttribute('position').count;
			const col = new Float32Array(n * 3).fill(1);
			g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		}
		return g;
	}

	function applyModelTransform(m: any, o: Obj) {
		m.scale.set(o.scale.x * (o.mirror.x ? -1 : 1), o.scale.y * (o.mirror.y ? -1 : 1), o.scale.z * (o.mirror.z ? -1 : 1));
		m.rotation.set(rad(o.rot.x), rad(o.rot.y), rad(o.rot.z));
		m.position.set(0, 0, 0);
		m.updateMatrix();
		const box = new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position')).applyMatrix4(m.matrix);
		m.position.set(o.pos.x, o.pos.y, -box.min.z);
		m.updateMatrix();
	}

	function addGeometry(geometry: any, name: string, color: string) {
		const id = uid();
		const g = prep(geometry);
		geoms.set(id, g);
		const faces = g.getAttribute('position').count / 3;
		paintData.set(id, { colorHex: new Array(faces).fill(''), support: new Uint8Array(faces), seam: new Uint8Array(faces) });
		const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.5, metalness: 0.04, vertexColors: true, side: THREE.DoubleSide });
		// vertexColors multiplies material color; set material white so object color comes from a tint attr — simpler: keep material color and paint overrides via color attr set to white initially → shows material color. We set vertexColors true and fill white so base = material color.
		const m = new THREE.Mesh(g, mat);
		m.castShadow = true;
		m.userData.id = id;
		world.add(m);
		meshes.set(id, m);
		const o: Obj = { id, name, color, pos: { x: 0, y: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, mirror: { x: false, y: false, z: false } };
		applyModelTransform(m, o);
		objects = [...objects, o];
		selectedId = id;
		autoArrange();
		frameCamera();
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
				const g = new ThreeMFLoader().parse(buf);
				g.traverse((c: any) => { if (c.isMesh && !geometry) geometry = c.geometry; });
			} else throw new Error('Unsupported file. Use STL, OBJ, or 3MF.');
			if (!geometry) throw new Error('No printable mesh found.');
			addGeometry(geometry, file.name.replace(/\.(stl|obj|3mf)$/i, ''), colorHex);
		} catch (e: any) {
			errorMsg = e?.message ?? 'Could not load model.';
		} finally {
			loading = false;
		}
	}

	function removeObject(id: string) {
		const m = meshes.get(id);
		if (m) { world.remove(m); m.geometry.dispose(); m.material.dispose(); }
		meshes.delete(id); geoms.delete(id); paintData.delete(id);
		objects = objects.filter((o) => o.id !== id);
		if (selectedId === id) selectedId = objects[0]?.id ?? null;
		emitStats();
	}

	function duplicate(id: string) {
		const g = geoms.get(id); const o = objects.find((x) => x.id === id);
		if (!g || !o) return;
		addGeometry(g.clone(), o.name + ' copy', o.color);
	}

	// ── auto arrange (grid bin-pack by footprint) ───────────────────────────────
	function footprint(id: string, o: Obj) {
		const m = meshes.get(id); if (!m) return { w: 50, d: 50 };
		m.scale.set(o.scale.x, o.scale.y, o.scale.z); m.rotation.set(rad(o.rot.x), rad(o.rot.y), rad(o.rot.z));
		m.position.set(0, 0, 0); m.updateMatrix();
		const b = new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position')).applyMatrix4(m.matrix);
		return { w: b.max.x - b.min.x, d: b.max.y - b.min.y };
	}
	function autoArrange() {
		const gap = 8;
		const items = objects.map((o) => ({ o, fp: footprint(o.id, o) }));
		let x = -plate.x / 2 + gap, y = plate.y / 2 - gap, rowH = 0;
		for (const { o, fp } of items) {
			if (x + fp.w > plate.x / 2 - gap) { x = -plate.x / 2 + gap; y -= rowH + gap; rowH = 0; }
			o.pos = { x: +(x + fp.w / 2).toFixed(1), y: +(y - fp.d / 2).toFixed(1) };
			x += fp.w + gap; rowH = Math.max(rowH, fp.d);
		}
		objects = [...objects];
	}

	// ── CSG ──────────────────────────────────────────────────────────────────
	function bakedGeometry(o: Obj) {
		const g = geoms.get(o.id)!.clone();
		const m = new THREE.Mesh(g);
		applyModelTransform(m, o);
		m.updateMatrix();
		g.applyMatrix4(m.matrix);
		return g;
	}
	function evalCSG(gA: any, gB: any, op: any) {
		const { Brush, Evaluator } = csg;
		const a = new Brush(gA); a.updateMatrixWorld();
		const b = new Brush(gB); b.updateMatrixWorld();
		const res = new Evaluator().evaluate(a, b, op);
		return res.geometry;
	}
	function doCut() {
		if (!selected) return; busy = 'Cutting…';
		try {
			const g = bakedGeometry(selected);
			g.computeBoundingBox(); const b = g.boundingBox;
			const mk = (minZ: number, maxZ: number) => {
				const box = new THREE.BoxGeometry(plate.x * 2, plate.y * 2, maxZ - minZ);
				box.translate(0, 0, (minZ + maxZ) / 2);
				return box;
			};
			const bottom = evalCSG(g.clone(), mk(cutZ, b.max.z + 1), csg.SUBTRACTION);
			const top = evalCSG(g.clone(), mk(b.min.z - 1, cutZ), csg.SUBTRACTION);
			const name = selected.name;
			removeObject(selected.id);
			addGeometry(bottom, name + ' (bottom)', colorHex);
			addGeometry(top, name + ' (top)', colorHex);
		} catch (e: any) { errorMsg = 'Cut failed: ' + (e?.message ?? ''); }
		busy = null;
	}
	function doBoolean() {
		if (objects.length < 2 || !selected) { errorMsg = 'Select the first object; needs 2 objects.'; return; }
		const other = objects.find((o) => o.id !== selectedId);
		if (!other) return;
		busy = 'Computing…';
		try {
			const op = boolOp === 'union' ? csg.ADDITION : boolOp === 'intersection' ? csg.INTERSECTION : csg.SUBTRACTION;
			const result = evalCSG(bakedGeometry(selected), bakedGeometry(other), op);
			const name = selected.name;
			removeObject(selected.id); removeObject(other.id);
			addGeometry(result, name + ' (bool)', colorHex);
		} catch (e: any) { errorMsg = 'Boolean failed: ' + (e?.message ?? ''); }
		busy = null;
	}
	function addText() {
		if (!font || !TextGeometry) { errorMsg = 'Font still loading…'; return; }
		try {
			const tg = new TextGeometry(textValue || 'Text', { font, size: textSize, height: textDepth, depth: textDepth, curveSegments: 6, bevelEnabled: false });
			tg.computeBoundingBox();
			addGeometry(tg, `“${textValue}”`, colorHex);
		} catch (e: any) { errorMsg = 'Text failed: ' + (e?.message ?? ''); }
	}

	// ── paint (raycast brush on selected) ───────────────────────────────────────
	function paintAt(ev: PointerEvent) {
		if (tool !== 'paint' || !selected) return;
		const m = meshes.get(selected.id); const p = paintData.get(selected.id); if (!m || !p) return;
		const rect = renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
		raycaster.setFromCamera(ndc, camera);
		const hit = raycaster.intersectObject(m, false)[0];
		if (!hit || hit.faceIndex == null) return;
		const f = hit.faceIndex;
		let tintHex: string;
		if (paintMode === 'support') { p.support[f] = supportSub === 'enforcer' ? 1 : 2; p.seam[f] = 0; tintHex = supportSub === 'enforcer' ? '#3b76c4' : '#8a7e72'; }
		else if (paintMode === 'seam') { p.seam[f] = 1; p.support[f] = 0; tintHex = '#e04f35'; }
		else { p.colorHex[f] = paintColorHex; tintHex = paintColorHex; }
		const tint = new THREE.Color(tintHex);
		const colAttr = m.geometry.getAttribute('color');
		const a = f * 3;
		for (let i = 0; i < 3; i++) colAttr.setXYZ(a + i, tint.r, tint.g, tint.b);
		colAttr.needsUpdate = true;
		paintVersion++;
	}

	// ── per-object apply + lifecycle ─────────────────────────────────────────────
	$effect(() => {
		for (const o of objects) {
			const m = meshes.get(o.id); if (!m) continue;
			m.material.color = new THREE.Color(o.color);
			applyModelTransform(m, o);
			m.material.emissive = new THREE.Color(o.id === selectedId ? '#4a2a10' : '#000000');
		}
		emitStats();
	});
	$effect(() => { plate.x; plate.y; if (THREE && scene) buildPlate(); });
	$effect(() => { if (controls) controls.enabled = tool !== 'paint'; });

	function emitStats() {
		if (!objects.length) { onstats?.({ bbox: { x: 0, y: 0, z: 0 }, volumeMm3: 0, triangles: 0, objects: 0 }); return; }
		const box = new THREE.Box3();
		let tris = 0, vol = 0;
		for (const o of objects) {
			const m = meshes.get(o.id); if (!m) continue;
			box.expandByObject(m);
			tris += m.geometry.getAttribute('position').count / 3;
			vol += signedVolume(m.geometry) * Math.abs(o.scale.x * o.scale.y * o.scale.z);
		}
		const size = new THREE.Vector3(); box.getSize(size);
		onstats?.({ bbox: { x: +size.x.toFixed(1), y: +size.z.toFixed(1), z: +size.y.toFixed(1) }, volumeMm3: Math.round(vol), triangles: Math.round(tris), objects: objects.length });
	}
	function signedVolume(g: any) {
		const p = g.getAttribute('position'); let v = 0;
		for (let i = 0; i < p.count; i += 3) {
			const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i), bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1), cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
			v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
		}
		return Math.abs(v);
	}

	function frameCamera() {
		if (!objects.length) return;
		const box = new THREE.Box3();
		for (const o of objects) { const m = meshes.get(o.id); if (m) box.expandByObject(m); }
		const size = new THREE.Vector3(); box.getSize(size); const c = new THREE.Vector3(); box.getCenter(c);
		const d = Math.max(size.x, size.y, size.z, 60) * 2 + 90;
		camera.position.set(c.x + d * 0.7, c.y + d * 0.6, c.z + d * 0.7); controls.target.copy(c); controls.update();
	}

	function buildPlate() {
		if (plateGroup) scene.remove(plateGroup);
		plateGroup = new THREE.Group();
		const mx = Math.max(plate.x, plate.y);
		const grid = new THREE.GridHelper(mx, Math.round(mx / 16), 0x6b5d50, 0x3a322b);
		(grid.material as any).opacity = 0.6; (grid.material as any).transparent = true;
		plateGroup.add(grid);
		const plane = new THREE.Mesh(new THREE.PlaneGeometry(plate.x, plate.y), new THREE.MeshStandardMaterial({ color: 0x2a231d, roughness: 0.9 }));
		plane.rotation.x = -Math.PI / 2; plane.position.y = -0.1; plane.receiveShadow = true; plateGroup.add(plane);
		plateGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(plate.x, 0.2, plate.y)), new THREE.LineBasicMaterial({ color: 0xff5b14 })));
		scene.add(plateGroup);
	}

	// selection by clicking an object (when not painting)
	function onPointerDown(ev: PointerEvent) {
		if (tool === 'paint') { painting = true; paintAt(ev); return; }
		const rect = renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
		raycaster.setFromCamera(ndc, camera);
		const hit = raycaster.intersectObjects([...meshes.values()], false)[0];
		if (hit?.object?.userData?.id) selectedId = hit.object.userData.id;
	}

	onMount(() => {
		let raf = 0, ro: ResizeObserver;
		(async () => {
			THREE = await import('three');
			({ STLExporter } = await import('three/addons/exporters/STLExporter.js'));
			csg = await import('three-bvh-csg');
			({ FontLoader } = await import('three/addons/loaders/FontLoader.js'));
			({ TextGeometry } = await import('three/addons/geometries/TextGeometry.js'));
			const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

			scene = new THREE.Scene();
			scene.background = new THREE.Color('#1c1714');
			camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000);
			camera.position.set(240, 200, 240);
			renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
			renderer.shadowMap.enabled = true;
			container.appendChild(renderer.domElement);
			controls = new OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI / 2.02;
			raycaster = new THREE.Raycaster();
			world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);
			scene.add(new THREE.HemisphereLight(0xffffff, 0x2a231d, 1.0));
			const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(120, 220, 140); key.castShadow = true;
			key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 1; key.shadow.camera.far = 1400; scene.add(key);
			buildPlate();

			try {
				font = await new Promise((res, rej) => new FontLoader().load('/fonts/helvetiker_regular.typeface.json', res, undefined, rej));
			} catch { /* text tool will warn */ }

			const el = renderer.domElement;
			el.addEventListener('pointerdown', onPointerDown);
			el.addEventListener('pointermove', (e: PointerEvent) => { if (painting) paintAt(e); });
			window.addEventListener('pointerup', () => (painting = false));

			function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
			ro = new ResizeObserver(resize); ro.observe(container); resize();
			(function animate() { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
		})();
		return () => { cancelAnimationFrame(raf); ro?.disconnect(); renderer?.dispose?.(); if (renderer?.domElement && container?.contains(renderer.domElement)) container.removeChild(renderer.domElement); };
	});

	const uniformScale = $derived(selected ? Math.round(selected.scale.x * 100) : 100);
	function setUniform(v: number) { if (selected) { const r = v / 100; selected.scale = { x: r, y: r, z: r }; objects = [...objects]; } }
	function rot90(ax: 'x' | 'y' | 'z') { if (selected) { selected.rot[ax] = (selected.rot[ax] + 90) % 360; objects = [...objects]; } }
	function resetSel() { if (selected) { selected.rot = { x: 0, y: 0, z: 0 }; selected.scale = { x: 1, y: 1, z: 1 }; selected.mirror = { x: false, y: false, z: false }; objects = [...objects]; } }
	function flip(ax: 'x' | 'y' | 'z') { if (selected) { selected.mirror[ax] = !selected.mirror[ax]; objects = [...objects]; } }

	const tools = [
		{ id: 'move', icon: 'move', label: 'Move' },
		{ id: 'rotate', icon: 'rotate', label: 'Rotate' },
		{ id: 'scale', icon: 'scale', label: 'Scale' },
		{ id: 'mirror', icon: 'mirror', label: 'Mirror' },
		{ id: 'cut', icon: 'layers', label: 'Cut' },
		{ id: 'boolean', icon: 'box', label: 'Boolean' },
		{ id: 'text', icon: 'plus', label: 'Text' },
		{ id: 'paint', icon: 'palette', label: 'Paint' }
	] as const;
</script>

<div class="relative h-full w-full overflow-hidden rounded-xl border border-warm-800 bg-[#1c1714]" bind:this={container}>
	<div class="pointer-events-none absolute left-3 top-3 rounded-md bg-black/30 px-2 py-1 text-[11px] font-medium text-warm-200 backdrop-blur">
		{plate.x} × {plate.y} × {plate.z} mm{#if objects.length} · {objects.length} object{objects.length === 1 ? '' : 's'}{/if}
	</div>
	{#if loading}<div class="absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-warm-200">Loading…</div>{/if}
	{#if busy}<div class="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-spark px-3 py-1 text-xs text-white">{busy}</div>{/if}
	{#if errorMsg}<div class="absolute inset-x-3 bottom-3 rounded-lg border border-danger/40 bg-danger/20 px-3 py-2 text-sm text-white" role="button" tabindex="0" onclick={() => (errorMsg = null)} onkeydown={() => (errorMsg = null)}>{errorMsg}</div>{/if}
	{#if objects.length === 0 && !loading}<div class="absolute inset-0 flex items-center justify-center text-sm text-warm-400">Add a model to start</div>{/if}

	{#if objects.length}
		<!-- Tool rail -->
		<div class="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-warm-800 bg-[#2a231d]/90 p-1.5 shadow-lg backdrop-blur">
			{#each tools as t}
				<button type="button" title={t.label} onclick={() => (tool = t.id)} class="flex h-9 w-9 items-center justify-center rounded-lg transition-colors {tool === t.id ? 'bg-spark text-white' : 'text-warm-200 hover:bg-white/10'}"><Icon name={t.icon} size={18} /></button>
			{/each}
		</div>

		<!-- Object list -->
		<div class="absolute right-3 top-3 max-h-[40%] w-48 overflow-y-auto rounded-xl border border-warm-800 bg-[#2a231d]/90 p-2 text-warm-100 shadow-lg backdrop-blur">
			<p class="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-warm-400">Objects</p>
			{#each objects as o}
				<div class="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs {o.id === selectedId ? 'bg-white/10' : ''}">
					<button type="button" class="flex-1 truncate text-left hover:text-white" onclick={() => (selectedId = o.id)}>{o.name}</button>
					<button type="button" title="Duplicate" class="text-warm-400 hover:text-white" onclick={() => duplicate(o.id)}><Icon name="plus" size={13} /></button>
					<button type="button" title="Delete" class="text-warm-400 hover:text-danger" onclick={() => removeObject(o.id)}><Icon name="trash" size={13} /></button>
				</div>
			{/each}
			<button type="button" class="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20" onclick={autoArrange}>Auto-arrange</button>
		</div>

		<!-- Tool panel -->
		{#if selected}
			<div class="absolute left-16 top-3 w-60 rounded-xl border border-warm-800 bg-[#2a231d]/95 p-3 text-warm-100 shadow-lg backdrop-blur">
				{#if tool === 'move'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Move (mm)</p>
					<div class="grid grid-cols-2 gap-2">
						<label class="text-xs">X<input type="number" bind:value={selected.pos.x} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-2 py-1 text-sm text-white" /></label>
						<label class="text-xs">Y<input type="number" bind:value={selected.pos.y} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-2 py-1 text-sm text-white" /></label>
					</div>
				{:else if tool === 'rotate'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Rotate (°)</p>
					<div class="grid grid-cols-3 gap-1.5">
						<label class="text-xs uppercase">x<input type="number" step="15" bind:value={selected.rot.x} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-1.5 py-1 text-sm text-white" /></label>
						<label class="text-xs uppercase">y<input type="number" step="15" bind:value={selected.rot.y} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-1.5 py-1 text-sm text-white" /></label>
						<label class="text-xs uppercase">z<input type="number" step="15" bind:value={selected.rot.z} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-1.5 py-1 text-sm text-white" /></label>
					</div>
					<div class="mt-2 flex gap-1">
						<button type="button" class="flex-1 rounded-md bg-white/10 px-1 py-1 text-xs hover:bg-white/20" onclick={() => rot90('x')}>+90X</button>
						<button type="button" class="flex-1 rounded-md bg-white/10 px-1 py-1 text-xs hover:bg-white/20" onclick={() => rot90('y')}>+90Y</button>
						<button type="button" class="flex-1 rounded-md bg-white/10 px-1 py-1 text-xs hover:bg-white/20" onclick={() => rot90('z')}>+90Z</button>
						<button type="button" class="flex-1 rounded-md bg-white/10 px-1 py-1 text-xs hover:bg-white/20" onclick={resetSel}>Reset</button>
					</div>
				{:else if tool === 'scale'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Scale</p>
					<label class="block text-xs">Uniform ({uniformScale}%)<input type="range" min="10" max="400" value={uniformScale} oninput={(e) => setUniform(+e.currentTarget.value)} class="mt-1 w-full accent-[#FF5B14]" /></label>
					<div class="mt-2 grid grid-cols-3 gap-1.5">
						<label class="text-xs uppercase">x<input type="number" step="0.05" min="0.1" bind:value={selected.scale.x} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-1.5 py-1 text-sm text-white" /></label>
						<label class="text-xs uppercase">y<input type="number" step="0.05" min="0.1" bind:value={selected.scale.y} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-1.5 py-1 text-sm text-white" /></label>
						<label class="text-xs uppercase">z<input type="number" step="0.05" min="0.1" bind:value={selected.scale.z} oninput={() => (objects = [...objects])} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-1.5 py-1 text-sm text-white" /></label>
					</div>
				{:else if tool === 'mirror'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Mirror</p>
					<div class="flex gap-1.5">
						<button type="button" onclick={() => flip('x')} class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {selected.mirror.x ? 'bg-spark text-white' : 'bg-white/10 hover:bg-white/20'}">X</button>
						<button type="button" onclick={() => flip('y')} class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {selected.mirror.y ? 'bg-spark text-white' : 'bg-white/10 hover:bg-white/20'}">Y</button>
						<button type="button" onclick={() => flip('z')} class="flex-1 rounded-md px-2 py-1.5 text-xs font-semibold {selected.mirror.z ? 'bg-spark text-white' : 'bg-white/10 hover:bg-white/20'}">Z</button>
					</div>
				{:else if tool === 'cut'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Plane cut</p>
					<label class="block text-xs">Cut height Z = {cutZ} mm<input type="range" min="1" max="200" bind:value={cutZ} class="mt-1 w-full accent-[#FF5B14]" /></label>
					<button type="button" class="mt-2 w-full rounded-md bg-spark px-2 py-1.5 text-xs font-semibold text-white hover:bg-spark-deep" onclick={doCut}>Cut into top + bottom</button>
				{:else if tool === 'boolean'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Boolean (selected vs other)</p>
					<select bind:value={boolOp} class="w-full rounded-md border border-warm-700 bg-black/20 px-2 py-1 text-sm text-white">
						<option value="difference">Difference (subtract)</option>
						<option value="union">Union (merge)</option>
						<option value="intersection">Intersection</option>
					</select>
					<button type="button" class="mt-2 w-full rounded-md bg-spark px-2 py-1.5 text-xs font-semibold text-white hover:bg-spark-deep" onclick={doBoolean}>Apply</button>
				{:else if tool === 'text'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Add 3D text</p>
					<input bind:value={textValue} class="w-full rounded-md border border-warm-700 bg-black/20 px-2 py-1 text-sm text-white" placeholder="Text" />
					<div class="mt-2 grid grid-cols-2 gap-2">
						<label class="text-xs">Size<input type="number" min="2" bind:value={textSize} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-2 py-1 text-sm text-white" /></label>
						<label class="text-xs">Depth<input type="number" min="0.5" step="0.5" bind:value={textDepth} class="mt-1 w-full rounded-md border border-warm-700 bg-black/20 px-2 py-1 text-sm text-white" /></label>
					</div>
					<button type="button" class="mt-2 w-full rounded-md bg-spark px-2 py-1.5 text-xs font-semibold text-white hover:bg-spark-deep" onclick={addText}>Add text object</button>
					<p class="mt-1 text-[10px] text-warm-400">Tip: position it, then use Boolean → Union/Difference to emboss or engrave.</p>
				{:else if tool === 'paint'}
					<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-300">Paint — drag on the model</p>
					<div class="flex gap-1">
						<button type="button" class="flex-1 rounded-md px-1.5 py-1 text-xs {paintMode === 'support' ? 'bg-spark text-white' : 'bg-white/10'}" onclick={() => (paintMode = 'support')}>Support</button>
						<button type="button" class="flex-1 rounded-md px-1.5 py-1 text-xs {paintMode === 'seam' ? 'bg-spark text-white' : 'bg-white/10'}" onclick={() => (paintMode = 'seam')}>Seam</button>
						<button type="button" class="flex-1 rounded-md px-1.5 py-1 text-xs {paintMode === 'color' ? 'bg-spark text-white' : 'bg-white/10'}" onclick={() => (paintMode = 'color')}>Color</button>
					</div>
					{#if paintMode === 'support'}
						<div class="mt-2 flex gap-1">
							<button type="button" class="flex-1 rounded-md px-1.5 py-1 text-xs {supportSub === 'enforcer' ? 'bg-[#3b76c4] text-white' : 'bg-white/10'}" onclick={() => (supportSub = 'enforcer')}>Enforce</button>
							<button type="button" class="flex-1 rounded-md px-1.5 py-1 text-xs {supportSub === 'blocker' ? 'bg-warm-500 text-white' : 'bg-white/10'}" onclick={() => (supportSub = 'blocker')}>Block</button>
						</div>
					{:else if paintMode === 'color'}
						{#if palette.length}
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each palette as sw}
									<button type="button" title={sw.colorName ?? sw.colorHex} onclick={() => (paintColorHex = sw.colorHex)} class="h-7 w-7 rounded-md border-2 {paintColorHex.toLowerCase() === sw.colorHex.toLowerCase() ? 'border-white' : 'border-warm-700'}" style="background:{sw.colorHex}"></button>
								{/each}
							</div>
						{:else}
							<p class="mt-2 text-[10px] text-warm-400">No lab colors to paint with yet.</p>
						{/if}
					{/if}
					<p class="mt-1 text-[10px] text-warm-400">Orbit is off while painting; switch tools to rotate the view.</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
