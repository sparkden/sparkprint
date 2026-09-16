<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data } = $props();

	let enabled = $state(data.enabled);
	let busy = $state(false);
	let output = $state('');
	let pane = $state<HTMLDivElement | null>(null);

	async function toggle(on: boolean) {
		if (busy) return;
		busy = true; output = on ? 'Setting up the kiosk (installing cage + chromium — a few minutes)…\n' : 'Disabling the kiosk…\n';
		try {
			const res = await fetch('/admin/kiosk/toggle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enable: on }) });
			if (!res.ok || !res.body) { output += `[${res.status}] ${(await res.text()) || 'failed'}\n`; return; }
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				output += dec.decode(value, { stream: true });
				await tick();
				if (pane) pane.scrollTop = pane.scrollHeight;
			}
			enabled = on;
		} catch (e) {
			output += `\n[error: ${(e as Error).message}]\n`;
		} finally {
			busy = false;
		}
	}

	const fullUrl = $derived(data.url ? `http://<pi-ip>:${data.port}${data.url}` : '');
</script>

<svelte:head><title>Kiosk · LataPrint</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<div class="mb-4">
		<h1 class="text-2xl font-semibold">Kiosk display</h1>
		<p class="mt-1 text-sm text-soft-ink">Turn a Raspberry Pi with a connected monitor into a fullscreen lab board — no desktop, no login. It updates live.</p>
	</div>

	<div class="card space-y-4 p-5">
		<div class="flex items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<span class="h-2.5 w-2.5 rounded-full {enabled ? 'bg-success' : 'bg-warm-300'}"></span>
				<span class="font-medium">{enabled ? 'Kiosk enabled' : 'Kiosk off'}</span>
			</div>
			{#if enabled}
				<button type="button" class="btn btn-secondary" onclick={() => toggle(false)} disabled={busy}>{busy ? 'Working…' : 'Disable kiosk'}</button>
			{:else}
				<button type="button" class="btn btn-primary" onclick={() => toggle(true)} disabled={busy}><Icon name="eye" size={16} /> {busy ? 'Setting up…' : 'Enable kiosk'}</button>
			{/if}
		</div>

		{#if data.url}
			<div class="rounded-lg bg-warm-50 px-3 py-2 text-sm">
				<div class="text-xs uppercase tracking-wide text-muted-ink">Board URL (no login)</div>
				<code class="break-all text-ink">{fullUrl}</code>
				<p class="mt-1 text-xs text-muted-ink">The Pi opens this on its own screen. You can also open it on any other display on the network. <a class="text-spark hover:underline" href={data.url} target="_blank" rel="noreferrer">Preview</a></p>
			</div>
		{/if}

		{#if output}
			<div bind:this={pane} class="max-h-[40vh] overflow-y-auto rounded-lg bg-[#12110f] p-3 font-mono text-[12px] leading-relaxed text-[#e6e1d6]"><pre class="whitespace-pre-wrap break-words">{output}</pre></div>
		{/if}
	</div>

	<div class="mt-3 space-y-1 text-xs text-muted-ink">
		<p><b>Requires:</b> the LataPrint Pi with a monitor plugged in (HDMI). Enabling installs a minimal Wayland kiosk (cage) + Chromium and starts it on boot — it can take a few minutes and may need one reboot the first time.</p>
		<p><b>Root access:</b> enabling runs a system setup script, which needs passwordless sudo for the <code>sparkprint</code> user (turn it on via the installer's "root terminal" prompt). If it fails with a sudo error, run this on the Pi instead:</p>
		<p class="rounded bg-warm-100 px-2 py-1 font-mono text-[11px] text-ink">sudo bash /opt/sparkprint/scripts/kiosk.sh enable "http://localhost:{data.port}{data.url ?? '/monitor'}"</p>
	</div>
</div>
