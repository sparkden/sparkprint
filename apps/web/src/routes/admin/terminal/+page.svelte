<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data } = $props();

	const MARK = '\x1e\x1eSPARKterm\x1e'; // must match TERM_MARK in shell.ts

	let cwd = $state(data.cwd);
	let asRoot = $state(false);
	let command = $state('');
	let running = $state(false);
	let output = $state(''); // rendered console text
	let controller: AbortController | null = null;
	let history: string[] = $state([]);
	let histIdx = $state(-1);
	let pane = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	const prompt = $derived(`${data.runAs}@${data.host}:${cwd}${asRoot ? ' #' : ' $'}`);

	// Strip ANSI escape sequences + lone carriage returns so output reads cleanly.
	function clean(s: string): string {
		return s
			.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC
			.replace(/\x1b[@-Z\\-_]/g, '')
			.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI
			.replace(/\r(?!\n)/g, '');
	}
	async function append(s: string) {
		output += clean(s);
		if (output.length > 300000) output = output.slice(-250000); // cap memory
		await tick();
		if (pane) pane.scrollTop = pane.scrollHeight;
	}

	async function run() {
		const cmd = command.trim();
		if (!cmd || running) return;
		if (cmd === 'clear' || cmd === 'cls') { output = ''; command = ''; return; }
		history = [cmd, ...history.filter((h) => h !== cmd)].slice(0, 100);
		histIdx = -1;
		await append(`\n${prompt} ${cmd}\n`);
		command = '';
		running = true;
		controller = new AbortController();
		try {
			const res = await fetch('/admin/terminal/exec', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ command: cmd, asRoot }),
				signal: controller.signal
			});
			if (!res.ok || !res.body) { await append(`[${res.status}] ${(await res.text()) || 'request failed'}\n`); return; }
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let buf = '';
			let rc = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				const i = buf.indexOf(MARK);
				if (i !== -1) {
					await append(buf.slice(0, i));
					const parts = buf.slice(i + MARK.length).split('\x1e');
					rc = parts[0] ?? '';
					if (parts[1]) cwd = parts[1];
					buf = '';
					break;
				}
				// hold back a possible partial marker at the tail
				if (buf.length > MARK.length) { await append(buf.slice(0, buf.length - MARK.length)); buf = buf.slice(-MARK.length); }
			}
			if (buf && !buf.includes(MARK)) await append(buf);
			if (rc && rc !== '0') await append(`\x1b[dim][exit ${rc}]\n`.replace('\x1b[dim]', ''));
		} catch (e) {
			if ((e as Error).name !== 'AbortError') await append(`\n[client error: ${(e as Error).message}]\n`);
			else await append('\n^C\n');
		} finally {
			running = false;
			controller = null;
			await tick();
			inputEl?.focus();
		}
	}

	function stop() { controller?.abort(); }

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); run(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); if (histIdx < history.length - 1) { histIdx++; command = history[histIdx]; } }
		else if (e.key === 'ArrowDown') { e.preventDefault(); if (histIdx > 0) { histIdx--; command = history[histIdx]; } else { histIdx = -1; command = ''; } }
		else if (e.key === 'c' && e.ctrlKey) { if (running) { e.preventDefault(); stop(); } }
		else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); output = ''; }
	}
</script>

<svelte:head><title>Terminal · LataPrint</title></svelte:head>

<div class="mb-4">
	<h1 class="text-2xl font-semibold">Server terminal</h1>
	<p class="mt-1 text-sm text-soft-ink">Run commands on the Pi as <code class="rounded bg-warm-100 px-1">{data.runAs}</code> on <b>{data.host}</b>.</p>
</div>

{#if !data.enabled}
	<div class="card border-warning/40 bg-warning/5 p-5 text-sm">
		<div class="flex items-center gap-2 font-semibold text-[#a35f00]"><Icon name="alert" size={18} /> Terminal disabled</div>
		<p class="mt-1 text-soft-ink">It's turned off by <code>ADMIN_TERMINAL="off"</code> in <code>apps/web/.env</code>. Set it to <code>on</code> and restart to enable.</p>
	</div>
{:else}
	<div class="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
		<Icon name="alert" size={18} />
		<span>
			This runs real commands on the server with full access as <b>{data.runAs}</b>.
			{#if data.publicOrigin}<b> This site is published publicly</b> — anyone who gets admin access can control this machine.{/if}
		</span>
	</div>

	<div class="overflow-hidden rounded-xl border border-warm-300 bg-[#12110f] shadow-lg">
		<div class="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-white/70">
			<span class="flex gap-1.5"><span class="h-3 w-3 rounded-full bg-[#ff5f56]"></span><span class="h-3 w-3 rounded-full bg-[#ffbd2e]"></span><span class="h-3 w-3 rounded-full bg-[#27c93f]"></span></span>
			<span class="ml-2 font-mono">{prompt}</span>
			<div class="ml-auto flex items-center gap-3">
				{#if data.rootAvailable}
					<label class="flex items-center gap-1.5 {asRoot ? 'text-danger' : ''}"><input type="checkbox" bind:checked={asRoot} class="accent-[#1e2f66]" /> root (sudo)</label>
				{:else}
					<span class="text-white/30" title="Passwordless sudo isn't configured for {data.runAs}">root: n/a</span>
				{/if}
				<button type="button" class="hover:text-white" onclick={() => (output = '')} title="Clear (Ctrl+L)">clear</button>
			</div>
		</div>

		<div bind:this={pane} class="h-[60vh] min-h-[320px] overflow-y-auto px-3 py-2 font-mono text-[13px] leading-relaxed text-[#e6e1d6]" onclick={() => inputEl?.focus()} role="presentation">
			{#if output}<pre class="whitespace-pre-wrap break-words">{output}</pre>{:else}<p class="text-white/30">Type a command and press Enter. `cd` persists. Up/Down for history, Ctrl+C to stop, Ctrl+L to clear.</p>{/if}
		</div>

		<div class="flex items-center gap-2 border-t border-white/10 px-3 py-2 font-mono text-[13px]">
			<span class="shrink-0 text-[#7fd08a]">{asRoot ? '#' : '$'}</span>
			<input
				bind:this={inputEl}
				bind:value={command}
				onkeydown={onKey}
				disabled={running}
				spellcheck="false"
				autocomplete="off"
				autocapitalize="off"
				placeholder={running ? 'running… (Ctrl+C to stop)' : 'command'}
				class="flex-1 bg-transparent text-[#e6e1d6] outline-none placeholder:text-white/25 disabled:opacity-60"
			/>
			{#if running}
				<button type="button" onclick={stop} class="rounded bg-danger/80 px-2.5 py-1 text-xs font-semibold text-white hover:bg-danger">Stop</button>
			{:else}
				<button type="button" onclick={run} disabled={!command.trim()} class="rounded bg-spark px-2.5 py-1 text-xs font-semibold text-white hover:bg-spark-deep disabled:opacity-40">Run</button>
			{/if}
		</div>
	</div>

	<p class="mt-2 text-xs text-muted-ink">Tip: interactive programs (vim, top, ssh prompts) aren't supported — use non-interactive flags (e.g. <code>apt-get -y</code>, <code>journalctl -n 200</code>).</p>
{/if}
