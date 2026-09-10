<script lang="ts">
	let {
		size = 28,
		showText = true,
		tone = 'ink'
	}: { size?: number; showText?: boolean; tone?: 'ink' | 'light' } = $props();
</script>

<span class="inline-flex items-center gap-2 select-none">
	<svg
		width={size}
		height={size}
		viewBox="0 0 32 32"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
	>
		<rect width="32" height="32" rx="9" fill="#FF5B14" />
		<path
			d="M17.6 5.5 9 17.4h5.2L13.2 26.5 23 13.9h-5.4l0.9-8.4Z"
			fill="#fff"
			stroke="#fff"
			stroke-width="0.5"
			stroke-linejoin="round"
		/>
	</svg>
	{#if showText}
		<span
			class="font-display text-[1.15rem] font-semibold tracking-tight {tone === 'light' ? 'text-paper' : 'text-ink'}"
			style="font-family: var(--font-display)"
		>
			Spark<span class="text-spark">Print</span>
		</span>
	{/if}
</span>
