<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import { colorDistance } from '$lib/color';
	import { build3MF, type Part } from '$lib/threemf';

	type V3 = { x: number; y: number; z: number };
	type Stats = { bbox: V3; volumeMm3: number; triangles: number; objects: number };
	type LabColor = { colorHex: string; colorName?: string | null; filamentType: string; available?: boolean };
	type ObjRow = { id: string; name: string; color: LabColor };

	let {
		colorHex = '#FF5B14',
		plate = { x: 256, y: 256, z: 256 },
		labColors = [],
		defaultColor = null,
		onstats
	}: { colorHex?: string; plate?: V3; labColors?: LabColor[]; defaultColor?: LabColor | null; onstats?: (s: Stats) => void } = $props();

	const FALLBACK: LabColor = { colorHex, filamentType: 'PLA' };
	function baseColor(): LabColor {
		return defaultColor ?? labColors.find((c) => c.available) ?? labColors[0] ?? FALLBACK;
	}
	function nearestLab(hex: string): LabColor {
		if (!labColors.length) return { colorHex: hex, filamentType: 'PLA' };
		let best = labColors[0], bd = Infinity;
		for (const c of labColors) { const d = colorDistance(hex, c.colorHex); if (d < bd) { bd = d; best = c; } }
		return best;
	}
	let paletteOpenId = $state<string | null>(null);
	let fullscreen = $state(false);

	let objects = $state<ObjRow[]>([]);
	let selectedId = $state<string | null>(null);
	let mode = $state<'translate' | 'rotate' | 'scale'>('translate');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let selInfo = $state<{ w: number; d: number; h: number; scalePct: number; rx: number; ry: number; rz: number } | null>(null);

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

	function addGeometry(geometry: any, name: string, srcHex?: string | null) {
		let g = geometry.index ? geometry.toNonIndexed() : geometry;
		g.rotateX(-Math.PI / 2); // model Z-up → three Y-up (display)
		g.computeVertexNormals();
		g.center();
		const id = uid();
		// Colors imported from the file (e.g. Fusion 3MF bodies) map to the nearest lab color and
		// are treated as user-set so the default-color picker doesn't override them.
		const custom = !!srcHex;
		const color = srcHex ? nearestLab(srcHex) : baseColor();
		const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color.colorHex), roughness: 0.5, metalness: 0.04 });
		const m = new THREE.Mesh(g, mat);
		m.castShadow = true;
		m.userData.id = id;
		m.userData.custom = custom;
		scene.add(m);
		dropToPlate(m);
		meshes.set(id, m);
		objects = [...objects, { id, name, color }];
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
				// Fusion / Studio 3MFs can hold several colored bodies — import each as its own object
				// so their colors come through (auto-mapped to your lab colors).
				const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
				const gg = new ThreeMFLoader().parse(buf);
				const parts: { geo: any; hex: string | null }[] = [];
				gg.traverse((c: any) => {
					if (c.isMesh && c.geometry?.getAttribute?.('position')) {
						const col = c.material?.color ?? (Array.isArray(c.material) ? c.material[0]?.color : null);
						parts.push({ geo: c.geometry, hex: col ? '#' + col.getHexString() : null });
					}
				});
				if (!parts.length) throw new Error('No printable mesh found.');
				if (typeof pushUndo === 'function') pushUndo();
				const base = file.name.replace(/\.(stl|obj|3mf)$/i, '');
				parts.forEach((p, i) => addGeometry(p.geo, parts.length > 1 ? `${base} ${i + 1}` : base, p.hex));
				return;
			} else throw new Error('Unsupported file. Use STL, OBJ, or 3MF.');
			if (!geometry) throw new Error('No printable mesh found.');
			if (typeof pushUndo === 'function') pushUndo();
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
		if (typeof pushUndo === 'function') pushUndo();
		const m = meshes.get(id);
		if (m) {
			if (gizmo && selectedId === id) gizmo.detach();
			scene.remove(m); m.material.dispose(); // keep geometry for undo
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
		pushUndo();
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
	function arrange() { if (typeof pushUndo === 'function') pushUndo(); autoArrange(); }
	function layFlatSelected() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		if (typeof pushUndo === 'function') pushUndo();
		m.rotation.set(0, 0, 0);
		dropToPlate(m);
		updateSelInfo(); emitStats();
	}
	function mirrorSelected(axis: 'x' | 'y' | 'z') {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		if (typeof pushUndo === 'function') pushUndo();
		m.scale[axis] *= -1;
		dropToPlate(m); updateSelInfo(); emitStats();
	}

	// UI build axes → display axes (display is Y-up): X→x, Y→z, Z(up)→y.
	const AX: Record<'x' | 'y' | 'z', 'x' | 'y' | 'z'> = { x: 'x', y: 'z', z: 'y' };

	/** Resize the selected object so its build-axis dimension is `mm`, keeping proportions. */
	function resizeTo(uiAxis: 'x' | 'y' | 'z', mm: number) {
		const m = selectedId && meshes.get(selectedId);
		if (!m || !(mm > 0)) return;
		const box = new THREE.Box3().setFromObject(m); const s = new THREE.Vector3(); box.getSize(s);
		const cur = { x: s.x, y: s.z, z: s.y }[uiAxis]; // build dim
		if (!(cur > 0)) return;
		pushUndo();
		const f = mm / cur;
		m.scale.multiplyScalar(f);
		dropToPlate(m); updateSelInfo(); emitStats();
	}
	function setScalePct(pct: number) {
		const m = selectedId && meshes.get(selectedId);
		if (!m || !(pct > 0)) return;
		pushUndo();
		const f = pct / 100 / Math.abs(m.scale.x || 1);
		m.scale.multiplyScalar(f);
		dropToPlate(m); updateSelInfo(); emitStats();
	}
	function setRotation(uiAxis: 'x' | 'y' | 'z', deg: number) {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		pushUndo();
		m.rotation[AX[uiAxis]] = (deg * Math.PI) / 180;
		dropToPlate(m); updateSelInfo(); emitStats();
	}
	function rotate90(uiAxis: 'x' | 'y' | 'z') {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		pushUndo();
		m.rotation[AX[uiAxis]] += Math.PI / 2;
		dropToPlate(m); updateSelInfo(); emitStats();
	}
	function centerSelected() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		pushUndo();
		m.position.x = 0; m.position.z = 0; dropToPlate(m); updateSelInfo(); emitStats();
	}
	function fitToPlate() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		const box = new THREE.Box3().setFromObject(m); const s = new THREE.Vector3(); box.getSize(s);
		const f = Math.min((plate.x * 0.9) / s.x, (plate.y * 0.9) / s.z, (plate.z * 0.95) / s.y);
		if (!(f > 0) || !isFinite(f)) return;
		pushUndo();
		m.scale.multiplyScalar(f);
		m.position.x = 0; m.position.z = 0; dropToPlate(m); updateSelInfo(); emitStats();
	}
	function resetTransform() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) return;
		pushUndo();
		m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); m.position.x = 0; m.position.z = 0;
		dropToPlate(m); updateSelInfo(); emitStats();
	}

	function updateSelInfo() {
		const m = selectedId && meshes.get(selectedId);
		if (!m) { selInfo = null; return; }
		const box = new THREE.Box3().setFromObject(m); const s = new THREE.Vector3(); box.getSize(s);
		const deg = (r: number) => Math.round((((r * 180) / Math.PI) % 360 + 360) % 360);
		selInfo = {
			w: +s.x.toFixed(1), d: +s.z.toFixed(1), h: +s.y.toFixed(1),
			scalePct: Math.round(Math.abs(m.scale.x) * 100),
			rx: deg(m.rotation.x), ry: deg(m.rotation.z), rz: deg(m.rotation.y)
		};
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
	$effect(() => { plate.x; plate.y; if (THREE && scene) buildPlate(); });

	/** Recolor all objects that the user hasn't individually set (the single-color / default path). */
	export function setDefaultColor(c: LabColor) {
		for (const o of objects) {
			const m = meshes.get(o.id);
			if (m && !m.userData.custom) { m.material.color = new THREE.Color(c.colorHex); o.color = c; }
		}
		objects = [...objects];
	}
	/** Set one object's color (marks it user-set so the default picker won't override it). */
	function setObjectColor(id: string, c: LabColor) {
		const m = meshes.get(id);
		if (m) { m.material.color = new THREE.Color(c.colorHex); m.userData.custom = true; }
		objects = objects.map((o) => (o.id === id ? { ...o, color: c } : o));
		paletteOpenId = null;
	}
	/** Distinct colors across all objects, first-seen order → the filament list. */
	export function getColorRequest(): { filamentType: string; colorHex: string; colorName?: string }[] {
		const out: { filamentType: string; colorHex: string; colorName?: string }[] = [];
		for (const o of objects) {
			if (!out.some((c) => c.colorHex === o.color.colorHex && c.filamentType === o.color.filamentType)) {
				out.push({ filamentType: o.color.filamentType, colorHex: o.color.colorHex, colorName: o.color.colorName ?? undefined });
			}
		}
		return out.length ? out : [{ filamentType: baseColor().filamentType, colorHex: baseColor().colorHex, colorName: baseColor().colorName ?? undefined }];
	}
	export function multicolor(): boolean {
		return getColorRequest().length > 1;
	}
	/** Painted Bambu 3MF: each object's facets tagged with its color's filament index (0-based). */
	export function exportPainted3MF(): Blob | null {
		if (!objects.length) return null;
		const palette = getColorRequest();
		const idxOf = (o: ObjRow) => Math.max(0, palette.findIndex((c) => c.colorHex === o.color.colorHex && c.filamentType === o.color.filamentType));
		const parts: Part[] = [];
		for (const o of objects) {
			const m = meshes.get(o.id);
			if (!m) continue;
			m.updateMatrixWorld(true);
			const g = m.geometry.clone();
			g.applyMatrix4(m.matrixWorld);
			g.rotateX(Math.PI / 2); // Y-up display → Z-up for slicing
			const ng = g.index ? g.toNonIndexed() : g;
			const pos = ng.getAttribute('position').array as Float32Array;
			const nTri = pos.length / 9;
			const fil = idxOf(o);
			parts.push({
				positions: new Float32Array(pos),
				support: new Uint8Array(nTri),
				seam: new Uint8Array(nTri),
				colorIndex: new Int16Array(nTri).fill(fil)
			});
		}
		if (!parts.length) return null;
		const bytes = build3MF(parts, palette.length);
		return new Blob([bytes as BlobPart], { type: 'model/3mf' });
	}

	// ── Undo / redo + snapping ────────────────────────────────────────────────
	type Snap = { id: string; name: string; geo: any; matrix: any; color: string; labColor: LabColor; custom: boolean };
	let undoStack: Snap[][] = [];
	let redoStack: Snap[][] = [];
	let shiftDown = false;
	let dragStartScale: any = null;

	function snapshot(): Snap[] {
		return objects.map((o) => { const m = meshes.get(o.id); m.updateMatrix(); return { id: o.id, name: o.name, geo: m.geometry, matrix: m.matrix.clone(), color: '#' + m.material.color.getHexString(), labColor: o.color, custom: !!m.userData.custom }; });
	}
	function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
	function restore(snap: Snap[]) {
		const keep = new Set(snap.map((s) => s.id));
		for (const [id, m] of [...meshes]) if (!keep.has(id)) { if (gizmo && selectedId === id) gizmo.detach(); scene.remove(m); meshes.delete(id); }
		for (const s of snap) {
			let m = meshes.get(s.id);
			if (!m) { m = new THREE.Mesh(s.geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color), roughness: 0.5, metalness: 0.04 })); m.castShadow = true; m.userData.id = s.id; scene.add(m); meshes.set(s.id, m); }
			m.matrix.copy(s.matrix); m.matrix.decompose(m.position, m.quaternion, m.scale); m.material.color = new THREE.Color(s.color); m.userData.custom = s.custom;
		}
		objects = snap.map((s) => ({ id: s.id, name: s.name, color: s.labColor }));
		if (selectedId && !keep.has(selectedId)) selectedId = objects[0]?.id ?? null;
		select(selectedId);
		emitStats();
	}
	function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()!); }
	function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()!); }

	function setShift(on: boolean) {
		shiftDown = on;
		if (gizmo?.setTranslationSnap) {
			gizmo.setTranslationSnap(on ? 10 : null);
			gizmo.setRotationSnap(on ? (15 * Math.PI) / 180 : null);
		}
	}

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
		if (e.key === 'Shift') { setShift(true); return; }
		const k = e.key.toLowerCase();
		const mod = e.ctrlKey || e.metaKey;
		if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
		if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
		if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
		if (mod) return;
		if (k === 'm') applyMode('translate');
		else if (k === 'r') applyMode('rotate');
		else if (k === 's') applyMode('scale');
		else if (k === 'a') arrange();
		else if (k === 'l') layFlatSelected();
		else if (k === 'f') frameCamera();
		else if (k === 'escape') { if (fullscreen) fullscreen = false; else select(null); }
		else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(); }
		else return;
	}
	function onKeyUp(e: KeyboardEvent) { if (e.key === 'Shift') setShift(false); }

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
				if (e.value) {
					pushUndo();
					const m = selectedId && meshes.get(selectedId);
					dragStartScale = m ? m.scale.clone() : null;
				} else if (selectedId) {
					const m = meshes.get(selectedId);
					if (m && mode !== 'translate') dropToPlate(m);
					dragStartScale = null;
					updateSelInfo(); emitStats();
				}
			});
			gizmo.addEventListener('objectChange', () => {
				const m = selectedId ? meshes.get(selectedId) : null;
				// Shift while scaling → uniform (scale the whole thing, not one side).
				if (shiftDown && mode === 'scale' && dragStartScale && m) {
					const rs = [m.scale.x / dragStartScale.x, m.scale.y / dragStartScale.y, m.scale.z / dragStartScale.z];
					let r = 1, best = 0;
					for (const c of rs) if (Math.abs(c - 1) > best) { best = Math.abs(c - 1); r = c; }
					m.scale.set(dragStartScale.x * r, dragStartScale.y * r, dragStartScale.z * r);
				}
				// Never let a part sink through the plate — keep its bottom on (or above) z=0.
				if (m) {
					m.updateMatrixWorld(true);
					const minY = new THREE.Box3().setFromObject(m).min.y;
					if (minY < 0) m.position.y -= minY;
				}
				updateSelInfo();
			});

			const el = renderer.domElement;
			el.addEventListener('pointerdown', onPointerDown);
			window.addEventListener('keydown', onKey);
			window.addEventListener('keyup', onKeyUp);

			function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
			ro = new ResizeObserver(resize); ro.observe(container); resize();
			(function animate() { raf = requestAnimationFrame(animate); orbit.update(); renderer.render(scene, camera); })();
		})();
		return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); renderer?.dispose?.(); if (renderer?.domElement && container?.contains(renderer.domElement)) container.removeChild(renderer.domElement); };
	});

	const tools = [
		{ id: 'translate', icon: 'move', label: 'Move', key: 'M' },
		{ id: 'rotate', icon: 'rotate', label: 'Rotate', key: 'R' },
		{ id: 'scale', icon: 'scale', label: 'Scale', key: 'S' }
	] as const;
</script>

<div class="{fullscreen ? 'fixed inset-0 z-[60]' : 'relative h-full w-full rounded-xl border border-warm-200'} overflow-hidden bg-soft-paper" bind:this={container}>
	<button type="button" title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'} onclick={() => (fullscreen = !fullscreen)} class="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-warm-200 bg-surface/95 text-soft-ink shadow-lg backdrop-blur hover:bg-warm-100">
		<Icon name={fullscreen ? 'minimize' : 'maximize'} size={17} />
	</button>
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
			<button type="button" title="Auto-arrange (A)" onclick={arrange} class="flex h-9 w-9 items-center justify-center rounded-lg text-soft-ink hover:bg-warm-100"><Icon name="dashboard" size={18} /></button>
			<span class="my-0.5 h-px w-full bg-warm-200"></span>
			<button type="button" title="Undo (Ctrl+Z)" onclick={undo} class="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-soft-ink hover:bg-warm-100">↶</button>
			<button type="button" title="Redo (Ctrl+Y)" onclick={redo} class="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-soft-ink hover:bg-warm-100">↷</button>
		</div>

		<!-- Object list -->
		<div class="absolute right-3 top-14 max-h-[55%] w-52 overflow-y-auto rounded-xl border border-warm-200 bg-surface/95 p-2 text-ink shadow-lg backdrop-blur">
			<p class="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-ink">Objects{#if multicolor()} · multicolor{/if}</p>
			{#each objects as o}
				<div class="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs {o.id === selectedId ? 'bg-spark-soft text-spark-deep' : ''}">
					{#if labColors.length}
						<button type="button" title="Set color: {o.color.colorName ?? o.color.colorHex}" onclick={() => (paletteOpenId = paletteOpenId === o.id ? null : o.id)} class="h-4 w-4 shrink-0 rounded border border-warm-300" style="background:{o.color.colorHex}"></button>
					{/if}
					<button type="button" class="flex-1 truncate text-left hover:text-spark" onclick={() => select(o.id)}>{o.name}</button>
					<button type="button" title="Duplicate (Ctrl+D)" class="text-muted-ink hover:text-ink" onclick={() => { select(o.id); duplicateSelected(); }}><Icon name="plus" size={13} /></button>
					<button type="button" title="Delete (Del)" class="text-muted-ink hover:text-danger" onclick={() => removeObject(o.id)}><Icon name="trash" size={13} /></button>
				</div>
				{#if paletteOpenId === o.id && labColors.length}
					<div class="mb-1 flex flex-wrap gap-1 rounded-lg bg-warm-50 p-1.5">
						{#each labColors as c}
							<button type="button" title="{c.colorName ?? c.colorHex} · {c.filamentType}" onclick={() => setObjectColor(o.id, c)}
								class="h-6 w-6 rounded border-2 hover:scale-110 {o.color.colorHex === c.colorHex && o.color.filamentType === c.filamentType ? 'border-ink' : 'border-warm-300'}" style="background:{c.colorHex}"></button>
						{/each}
					</div>
				{/if}
			{/each}
		</div>

		<!-- Object manipulation panel (Bambu-style) -->
		{#if selected && selInfo}
			<div class="absolute bottom-3 left-16 w-64 rounded-xl border border-warm-200 bg-surface/95 p-3 text-ink shadow-lg backdrop-blur">
				<p class="mb-2 truncate text-xs font-semibold">{selected.name}</p>
				<div class="space-y-2 text-[11px]">
					<div>
						<div class="mb-1 text-muted-ink">Size (mm)</div>
						<div class="grid grid-cols-3 gap-1.5">
							{#each [['x', selInfo.w], ['y', selInfo.d], ['z', selInfo.h]] as [ax, val]}
								<label class="flex items-center gap-1"><span class="w-3 text-faint-ink uppercase">{ax}</span>
									<input class="input px-1.5 py-1 text-[11px]" type="number" min="1" step="0.1" value={val} onchange={(e) => resizeTo(ax as 'x', +e.currentTarget.value)} /></label>
							{/each}
						</div>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-muted-ink">Scale</span>
						<input class="input px-1.5 py-1 text-[11px]" style="width:4rem" type="number" min="1" step="1" value={selInfo.scalePct} onchange={(e) => setScalePct(+e.currentTarget.value)} /><span class="text-faint-ink">%</span>
						<button type="button" class="ml-auto rounded bg-warm-100 px-1.5 py-0.5 hover:bg-warm-200" title="Scale to fill the plate" onclick={fitToPlate}>Fit</button>
					</div>
					<div>
						<div class="mb-1 text-muted-ink">Rotate (°)</div>
						<div class="grid grid-cols-3 gap-1.5">
							{#each [['x', selInfo.rx], ['y', selInfo.ry], ['z', selInfo.rz]] as [ax, val]}
								<label class="flex items-center gap-1"><span class="w-3 text-faint-ink uppercase">{ax}</span>
									<input class="input px-1.5 py-1 text-[11px]" type="number" step="15" value={val} onchange={(e) => setRotation(ax as 'x', +e.currentTarget.value)} /></label>
							{/each}
						</div>
					</div>
					<div class="flex flex-wrap items-center gap-1 pt-0.5">
						<span class="text-muted-ink">90°</span>
						{#each ['x', 'y', 'z'] as ax}<button type="button" class="rounded bg-warm-100 px-1.5 py-0.5 hover:bg-warm-200" onclick={() => rotate90(ax as 'x')}>{ax.toUpperCase()}</button>{/each}
						<span class="ml-1 text-muted-ink">Mirror</span>
						{#each ['x', 'y', 'z'] as ax}<button type="button" class="rounded bg-warm-100 px-1.5 py-0.5 hover:bg-warm-200" onclick={() => mirrorSelected(ax as 'x')}>{ax.toUpperCase()}</button>{/each}
					</div>
					<div class="flex gap-1.5 pt-0.5">
						<button type="button" class="flex-1 rounded bg-warm-100 px-1.5 py-1 hover:bg-warm-200" onclick={centerSelected}>Center</button>
						<button type="button" class="flex-1 rounded bg-warm-100 px-1.5 py-1 hover:bg-warm-200" onclick={layFlatSelected}>Lay flat</button>
						<button type="button" class="flex-1 rounded bg-warm-100 px-1.5 py-1 hover:bg-warm-200" onclick={resetTransform}>Reset</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Shortcut hint -->
		<div class="pointer-events-none absolute bottom-3 right-3 rounded-md border border-warm-200 bg-surface/80 px-2 py-1 text-[10px] text-muted-ink backdrop-blur">
			M/R/S move·rotate·scale · A arrange · L flat · Del delete · Ctrl+Z/Y undo/redo · Shift = snap / uniform
		</div>
	{/if}
</div>
