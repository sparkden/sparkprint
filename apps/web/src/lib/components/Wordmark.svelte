<script lang="ts">
	// The Immaculata "IMMACULATA HIGH SCHOOL" wordmark. The source PNG is white on
	// transparent; we render it through a CSS mask so it can be tinted any color
	// (navy on light surfaces, white on dark ones, grey/black anywhere).
	let {
		height = 40,
		color = 'var(--color-spark)',
		class: cls = ''
	}: { height?: number; color?: string; class?: string } = $props();
</script>

<div
	class={cls}
	role="img"
	aria-label="Immaculata High School"
	style="height:{height}px; aspect-ratio:666/375; max-width:100%; background-color:{color};
		-webkit-mask:url(/immaculata-wordmark-white.png) center/contain no-repeat;
		mask:url(/immaculata-wordmark-white.png) center/contain no-repeat;"
></div>
