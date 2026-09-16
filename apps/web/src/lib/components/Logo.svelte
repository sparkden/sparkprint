<script lang="ts">
	let {
		size = 30,
		showText = true,
		tone = 'ink'
	}: { size?: number; showText?: boolean; tone?: 'ink' | 'light' } = $props();
</script>

<span class="inline-flex items-center gap-2.5 select-none">
	<img
		src="/immaculata-seal.png"
		alt="Immaculata High School crest"
		width={size}
		height={size}
		class="shrink-0 object-contain"
		style="width:{size}px;height:{size}px"
	/>
	{#if showText}
		<span
			class="font-display text-[1.15rem] font-semibold tracking-tight {tone === 'light'
				? 'text-paper'
				: 'text-ink'}"
			style="font-family: var(--font-display)"
		>
			Lata<span class={tone === 'light' ? 'text-paper' : 'text-spark'}>Print</span>
		</span>
	{/if}
</span>
