<script lang="ts">
	import { onMount } from 'svelte';

	type V3 = { x: number; y: number; z: number };
	type Stats = { bbox: V3; volumeMm3: number; triangles: number };
	let {
		file = null,
		colorHex = '#FF5B14',
		rotationDeg = { x: 0, y: 0, z: 0 },
		scaleXYZ = { x: 1, y: 1, z: 1 },
		mirror = { x: false, y: false, z: false },
		position = { x: 0, y: 0 },
		plate = { x: 256, y: 256, z: 256 },
		onstats
	}: {
		file?: File | null;
		colorHex?: string;
		rotationDeg?: V3;
		scaleXYZ?: V3;
		mirror?: { x: boolean; y: boolean; z: boolean };
		position?: { x: number; y: number };
		plate?: V3;
		onstats?: (s: Stats) => void;
	} = $props();

	let container: HTMLDivElement;
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	let THREE: any, STLExporter: any;
	let renderer: any, scene: any, camera: any, controls: any;
	let outer: any = null; // display orientation (Z-up → Y-up) + drop/offset
	let inner: any = null; // model-space transforms (scale/mirror/rotation)
	let baseGeometry: any = null;
	let plateGroup: any = null;

	export function captureThumbnail(): string | null {
		if (!renderer) return null;
		renderer.render(scene, camera);
		try { return renderer.domElement.toDataURL('image/png'); } catch { return null; }
	}

	/** Export the transformed model in model-space (Z-up) as a binary STL Blob. */
	export function exportSTL(): Blob | null {
		if (!inner || !baseGeometry || !STLExporter) return null;
		const tmp = new THREE.Mesh(baseGeometry.clone(), new THREE.MeshStandardMaterial());
		tmp.scale.copy(inner.scale);
		tmp.rotation.copy(inner.rotation);
		tmp.updateMatrixWorld(true);
		const out = new STLExporter().parse(tmp, { binary: true });
		const buf = out instanceof DataView ? out.buffer : out;
		return new Blob([buf], { type: 'model/stl' });
	}

	function signedVolume(geom: any): number {
		const p = geom.attributes.position;
		let v = 0;
		for (let i = 0; i < p.count; i += 3) {
			const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
			const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
			const cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
			v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
		}
		return Math.abs(v);
	}
	const rad = (d: number) => (d * Math.PI) / 180;

	async function loadFile(f: File) {
		if (!THREE || !f) return;
		loading = true; errorMsg = null;
		try {
			const buf = await f.arrayBuffer();
			const ext = f.name.split('.').pop()?.toLowerCase();
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
			if (!geometry) throw new Error('No printable mesh found in file.');
			geometry.center();
			geometry.computeVertexNormals();
			baseGeometry = geometry;
			rebuild(); frameCamera(); emitStats();
		} catch (e: any) {
			errorMsg = e?.message ?? 'Could not load model.';
		} finally {
			loading = false;
		}
	}

	function rebuild() {
		if (!baseGeometry || !THREE) return;
		if (outer) scene.remove(outer);
		const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.5, metalness: 0.04, side: THREE.DoubleSide });
		inner = new THREE.Mesh(baseGeometry, mat);
		inner.castShadow = true;
		// model-space transforms
		inner.scale.set(
			scaleXYZ.x * (mirror.x ? -1 : 1),
			scaleXYZ.y * (mirror.y ? -1 : 1),
			scaleXYZ.z * (mirror.z ? -1 : 1)
		);
		inner.rotation.set(rad(rotationDeg.x), rad(rotationDeg.y), rad(rotationDeg.z));

		outer = new THREE.Group();
		outer.add(inner);
		outer.rotation.x = -Math.PI / 2; // Z-up model → Y-up display
		// drop onto plate + apply move offset
		const box = new THREE.Box3().setFromObject(outer);
		const c = new THREE.Vector3(); box.getCenter(c);
		outer.position.x -= c.x; outer.position.z -= c.z;
		outer.position.y -= box.min.y;
		outer.position.x += position.x;
		outer.position.z -= position.y;
		scene.add(outer);
	}

	function emitStats() {
		if (!outer || !baseGeometry) return;
		const box = new THREE.Box3().setFromObject(outer);
		const size = new THREE.Vector3(); box.getSize(size);
		const s = inner.scale;
		const vol = signedVolume(baseGeometry) * Math.abs(s.x * s.y * s.z);
		onstats?.({
			bbox: { x: +size.x.toFixed(1), y: +size.z.toFixed(1), z: +size.y.toFixed(1) },
			volumeMm3: Math.round(vol),
			triangles: baseGeometry.attributes.position.count / 3
		});
	}

	function frameCamera() {
		if (!outer) return;
		const box = new THREE.Box3().setFromObject(outer);
		const size = new THREE.Vector3(); box.getSize(size);
		const c = new THREE.Vector3(); box.getCenter(c);
		const maxDim = Math.max(size.x, size.y, size.z, 60);
		const dist = maxDim * 2.0 + 80;
		camera.position.set(c.x + dist * 0.75, c.y + dist * 0.6, c.z + dist * 0.75);
		controls.target.copy(c); controls.update();
	}

	function buildPlate() {
		if (plateGroup) scene.remove(plateGroup);
		plateGroup = new THREE.Group();
		const { x, y } = plate;
		const grid = new THREE.GridHelper(Math.max(x, y), Math.round(Math.max(x, y) / 16), 0x6b5d50, 0x3a322b);
		(grid.material as any).opacity = 0.6; (grid.material as any).transparent = true;
		plateGroup.add(grid);
		const plane = new THREE.Mesh(new THREE.PlaneGeometry(x, y), new THREE.MeshStandardMaterial({ color: 0x2a231d, roughness: 0.9 }));
		plane.rotation.x = -Math.PI / 2; plane.position.y = -0.1; plane.receiveShadow = true;
		plateGroup.add(plane);
		const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x, 0.2, y)), new THREE.LineBasicMaterial({ color: 0xff5b14 }));
		plateGroup.add(edge);
		scene.add(plateGroup);
	}

	$effect(() => { colorHex; if (inner) inner.material.color = new THREE.Color(colorHex); });
	$effect(() => {
		scaleXYZ.x; scaleXYZ.y; scaleXYZ.z; rotationDeg.x; rotationDeg.y; rotationDeg.z;
		mirror.x; mirror.y; mirror.z; position.x; position.y;
		if (baseGeometry) { rebuild(); emitStats(); }
	});
	$effect(() => { plate.x; plate.y; if (THREE && scene) buildPlate(); });
	$effect(() => { if (file) loadFile(file); });

	onMount(() => {
		let raf = 0, ro: ResizeObserver;
		(async () => {
			THREE = await import('three');
			({ STLExporter } = await import('three/addons/exporters/STLExporter.js'));
			const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
			scene = new THREE.Scene();
			scene.background = new THREE.Color('#1c1714');
			camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000);
			camera.position.set(220, 180, 220);
			renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
			renderer.shadowMap.enabled = true;
			container.appendChild(renderer.domElement);
			controls = new OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI / 2.02;
			scene.add(new THREE.HemisphereLight(0xffffff, 0x2a231d, 1.0));
			const key = new THREE.DirectionalLight(0xffffff, 1.5);
			key.position.set(120, 220, 140); key.castShadow = true;
			key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 1; key.shadow.camera.far = 1200;
			scene.add(key);
			buildPlate();
			function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
			ro = new ResizeObserver(resize); ro.observe(container); resize();
			(function animate() { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
			if (file) loadFile(file);
		})();
		return () => { cancelAnimationFrame(raf); ro?.disconnect(); renderer?.dispose?.(); if (renderer?.domElement && container?.contains(renderer.domElement)) container.removeChild(renderer.domElement); };
	});
</script>

<div class="relative h-full w-full overflow-hidden rounded-xl border border-warm-800 bg-[#1c1714]" bind:this={container}>
	<div class="pointer-events-none absolute left-3 top-3 rounded-md bg-black/30 px-2 py-1 text-[11px] font-medium text-warm-200 backdrop-blur">
		{plate.x} × {plate.y} × {plate.z} mm
	</div>
	{#if loading}<div class="absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-warm-200">Loading model…</div>{/if}
	{#if errorMsg}<div class="absolute inset-x-3 top-3 rounded-lg border border-danger/40 bg-danger/20 px-3 py-2 text-sm text-white">{errorMsg}</div>{/if}
	{#if !file && !loading}<div class="absolute inset-0 flex items-center justify-center text-sm text-warm-400">Your model will appear here</div>{/if}
</div>
