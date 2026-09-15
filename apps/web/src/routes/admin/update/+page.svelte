<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data } = $props();

	const OK = '__UPDATE_OK__';
	const FAIL = '__UPDATE_FAIL__';

	let version = $state(data.version);
	let running = $state(false);
	let phase = $state<'idle' | 'building' | 'restarting' | 'done' | 'failed'>('idle');
	let output = $state('');
	let pane = $state<HTMLDivElement | null>(null);

	async function append(s: string) {
		output += s;
		await tick();
		if (pane) pane.scrollTop = pane.scrollHeight;
	}

	async function waitForRestart() {
		// Poll the health endpoint until the freshly restarted server answers, then reload.
		for (let i = 0; i < 120; i++) {
			await new Promise((r) => setTimeout(r, 2000));
			try {
				const res = await fetch('/healthz', { cache: 'no-store' });
				if (res.ok) { await append('\n✓ Back online — reloading…\n'); setTimeout(() => location.reload(), 800); return; }
			} catch { /* still down */ }
			await append('.');
		}
		await append('\nStill waiting… reload the page manually in a moment.\n');
	}

	async function update() {
		if (running) return;
		running = true; phase = 'building'; output = '';
		await append('Starting update…\n');
		try {
			const res = await fetch('/admin/update/run', { method: 'POST' });
			if (!res.ok || !res.body) { await append(`[${res.status}] ${(await res.text()) || 'failed to start'}\n`); phase = 'failed'; running = false; return; }
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let sawOk = false;
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					const chunk = dec.decode(value, { stream: true });
					if (chunk.includes(OK)) { sawOk = true; phase = 'restarting'; }
					if (chunk.includes(FAIL)) phase = 'failed';
					await append(chunk.replaceAll(OK, '').replaceAll(FAIL, ''));
				}
			} catch { /* connection dropped — expected when the server exits to restart */ }
			if (sawOk || phase === 'restarting') { phase = 'restarting'; await waitForRestart(); }
			else if (phase !== 'failed') { phase = 'failed'; await append('\nUpdate ended unexpectedly.\n'); }
		} catch (e) {
			phase = 'failed'; await append(`\n[client error: ${(e as Error).message}]\n`);
		} finally {
			if (phase === 'failed') running = false;
		}
	}
</script>

<svelte:head><title>Update · SparkPrint</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<div class="mb-4">
		<h1 class="text-2xl font-semibold">Software update</h1>
		<p class="mt-1 text-sm text-soft-ink">Pull the latest code, rebuild, and restart — all from here.</p>
	</div>

	<div class="card space-y-4 p-5">
		<div class="flex items-center justify-between gap-3">
			<div>
				<div class="text-xs uppercase tracking-wide text-muted-ink">Current version</div>
				<div class="font-mono text-sm text-ink">{version}</div>
			</div>
			<button type="button" class="btn btn-primary" onclick={update} disabled={running}>
				{#if phase === 'building'}<Icon name="refresh" size={16} /> Updating…
				{:else if phase === 'restarting'}<Icon name="refresh" size={16} /> Restarting…
				{:else}<Icon name="refresh" size={16} /> Check &amp; update now{/if}
			</button>
		</div>

		{#if phase !== 'idle'}
			<div bind:this={pane} class="max-h-[45vh] overflow-y-auto rounded-lg bg-[#12110f] p-3 font-mono text-[12px] leading-relaxed text-[#e6e1d6]">
				<pre class="whitespace-pre-wrap break-words">{output}</pre>
			</div>
		{/if}

		{#if phase === 'restarting'}
			<p class="text-sm text-soft-ink">The server is restarting on the new version — this page will reload automatically when it's back (usually ~10s).</p>
		{:else if phase === 'failed'}
			<p class="text-sm text-danger">Update failed — the previous version is still running, so nothing is broken. Check the log above, or use the terminal.</p>
		{/if}
	</div>

	<p class="mt-3 text-xs text-muted-ink">Updates come from the <code>main</code> branch on GitHub. If dependencies changed, this also runs a fresh install, so it can take a few minutes on a Pi.</p>
</div>
