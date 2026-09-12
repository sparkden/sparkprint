<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Snippet } from 'svelte';

	// A draggable, resizable, edge-snappable floating window (CAD-style). Lives inside a
	// position:relative/fixed fullscreen host. Drag by the title bar; resize from the corner;
	// dragging to a screen edge snaps it flush (and to a left/right half at the far edge).
	let {
		title,
		open = $bindable(true),
		x = $bindable(80),
		y = $bindable(80),
		w = $bindable(340),
		h = $bindable(460),
		minW = 260,
		minH = 200,
		icon,
		children
	}: {
		title: string;
		open?: boolean;
		x?: number; y?: number; w?: number; h?: number;
		minW?: number; minH?: number;
		icon?: string;
		children: Snippet;
	} = $props();

	let dragging = $state(false), resizing = $state(false);
	let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
	let snapHint = $state<'' | 'left' | 'right' | 'top'>('');

	const vw = () => window.innerWidth;
	const vh = () => window.innerHeight;
	const M = 8; // edge margin

	function clamp() {
		w = Math.max(minW, Math.min(w, vw() - 2 * M));
		h = Math.max(minH, Math.min(h, vh() - 2 * M));
		x = Math.max(M, Math.min(x, vw() - w - M));
		y = Math.max(M, Math.min(y, vh() - h - M));
	}

	function onDragStart(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		dragging = true; sx = e.clientX; sy = e.clientY; ox = x; oy = y;
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragEnd);
		e.preventDefault();
	}
	function onDragMove(e: PointerEvent) {
		x = ox + (e.clientX - sx); y = oy + (e.clientY - sy);
		snapHint = e.clientX < 24 ? 'left' : e.clientX > vw() - 24 ? 'right' : e.clientY < 24 ? 'top' : '';
	}
	function onDragEnd() {
		dragging = false;
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragEnd);
		// Snap flush / half-dock based on where it was dropped.
		if (snapHint === 'left') { x = M; y = M; h = vh() - 2 * M; w = Math.max(minW, Math.round(vw() / 3)); }
		else if (snapHint === 'right') { w = Math.max(minW, Math.round(vw() / 3)); x = vw() - w - M; y = M; h = vh() - 2 * M; }
		else if (snapHint === 'top') { x = M; y = M; w = vw() - 2 * M; }
		snapHint = '';
		clamp();
	}

	function onResizeStart(e: PointerEvent) {
		resizing = true; sx = e.clientX; sy = e.clientY; ow = w; oh = h;
		window.addEventListener('pointermove', onResizeMove);
		window.addEventListener('pointerup', onResizeEnd);
		e.preventDefault(); e.stopPropagation();
	}
	function onResizeMove(e: PointerEvent) { w = ow + (e.clientX - sx); h = oh + (e.clientY - sy); clamp(); }
	function onResizeEnd() { resizing = false; window.removeEventListener('pointermove', onResizeMove); window.removeEventListener('pointerup', onResizeEnd); }
</script>

{#if open}
	{#if snapHint}
		<div class="pointer-events-none fixed z-[59] rounded-xl border-2 border-spark/60 bg-spark-soft/30"
			style="left:{snapHint === 'right' ? vw() - Math.round(vw() / 3) - M : M}px; top:{M}px; width:{snapHint === 'top' ? vw() - 2 * M : Math.round(vw() / 3)}px; height:{snapHint === 'top' ? Math.round(vh() / 2) : vh() - 2 * M}px"></div>
	{/if}
	<section class="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-warm-200 bg-surface shadow-lg {dragging || resizing ? 'select-none' : ''}"
		style="left:{x}px; top:{y}px; width:{w}px; height:{h}px">
		<header onpointerdown={onDragStart} class="flex cursor-move items-center gap-2 border-b border-warm-200 bg-warm-50 px-3 py-2">
			{#if icon}<Icon name={icon} size={15} />{/if}
			<span class="flex-1 truncate text-sm font-semibold text-ink">{title}</span>
			<button type="button" class="rounded p-0.5 text-muted-ink hover:bg-warm-200 hover:text-ink" title="Close" onclick={() => (open = false)}><Icon name="x" size={15} /></button>
		</header>
		<div class="min-h-0 flex-1 overflow-auto p-3">
			{@render children()}
		</div>
		<button type="button" aria-label="Resize" onpointerdown={onResizeStart} class="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" style="background:linear-gradient(135deg,transparent 50%,var(--color-warm-300) 50%)"></button>
	</section>
{/if}
