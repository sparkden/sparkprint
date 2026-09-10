<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	let { data, form } = $props();

	let step = $state(data.user ? 2 : 1);
	let busy = $state(false);

	// Bambu connect sub-state
	let showCode = $state(false);
	let pendingEmail = $state('');
	let pendingRegion = $state('us');
	let inviteTok = $state<string | null>(null);
	let copied = $state(false);

	$effect(() => {
		if (form?.created && step < 2) step = 2;
		if (form?.saved && step < 3) step = 3;
		if (form?.connected && step < 4) step = 4;
		if (form?.needCode) {
			showCode = true;
			pendingEmail = form.email ?? '';
			pendingRegion = form.region ?? 'us';
		}
		if (form?.inviteToken) inviteTok = form.inviteToken;
	});

	const steps = [
		{ n: 1, label: 'Your lab', icon: 'bolt' },
		{ n: 2, label: 'Policies', icon: 'settings' },
		{ n: 3, label: 'Printers', icon: 'printer' },
		{ n: 4, label: 'Invite', icon: 'users' }
	];
	function inviteLink(t: string) {
		return `${page.url.origin}/join/${t}`;
	}
	async function copy(t: string) {
		await navigator.clipboard.writeText(inviteLink(t));
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
	const submit = () => {
		busy = true;
		return async ({ update }: any) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head><title>Set up SparkPrint</title></svelte:head>

<div class="flex min-h-full flex-col bg-soft-paper md:flex-row">
	<!-- Rail -->
	<aside class="flex flex-col justify-between border-b border-warm-200 bg-ink p-8 md:w-80 md:border-b-0 md:border-r">
		<div>
			<Logo size={30} tone="light" />
			<h1 class="accent-serif mt-8 text-3xl leading-tight text-white">Let's set up<br />your print lab.</h1>
			<p class="mt-3 text-sm text-warm-300">A few quick steps and your students can start printing.</p>

			<ol class="mt-10 space-y-1">
				{#each steps as s}
					<li class="flex items-center gap-3 rounded-lg px-3 py-2.5 {step === s.n ? 'bg-white/10' : ''}">
						<span class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold {step > s.n ? 'bg-spark text-white' : step === s.n ? 'bg-white text-ink' : 'bg-white/10 text-warm-300'}">
							{#if step > s.n}<Icon name="check" size={15} />{:else}{s.n}{/if}
						</span>
						<span class="text-sm font-medium {step >= s.n ? 'text-white' : 'text-warm-400'}">{s.label}</span>
					</li>
				{/each}
			</ol>
		</div>
		<p class="hidden text-xs text-warm-500 md:block">SparkPrint · Sparkden</p>
	</aside>

	<!-- Panel -->
	<main class="flex flex-1 items-center justify-center p-6 md:p-12">
		<div class="w-full max-w-md">
			{#if form?.error}
				<div class="mb-5 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>
			{/if}

			{#if step === 1}
				<h2 class="text-2xl font-semibold">Hi! 👋 Welcome to SparkPrint</h2>
				<p class="mt-1.5 text-sm text-soft-ink">First, create your admin account. You'll be the owner of the lab.</p>
				<form method="POST" action="?/createLab" use:enhance={submit} class="mt-6 space-y-4">
					<div><label class="label" for="schoolName">Lab / school name</label><input class="input" id="schoolName" name="schoolName" value={form?.values?.schoolName ?? ''} placeholder="Lincoln High Makerspace" required /></div>
					<div><label class="label" for="name">Your name</label><input class="input" id="name" name="name" value={form?.values?.name ?? ''} placeholder="Alex Rivera" required /></div>
					<div><label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" value={form?.values?.email ?? ''} placeholder="you@school.edu" required /></div>
					<div><label class="label" for="password">Password</label><input class="input" id="password" name="password" type="password" placeholder="At least 8 characters" required /></div>
					<button class="btn btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create lab'} <Icon name="chevronRight" size={16} /></button>
				</form>

			{:else if step === 2}
				<h2 class="text-2xl font-semibold">Set your lab's rules</h2>
				<p class="mt-1.5 text-sm text-soft-ink">You can change any of this later in Settings.</p>
				<form method="POST" action="?/savePolicies" use:enhance={submit} class="mt-6 space-y-5">
					<Toggle name="queueEnabled" checked={true} label="Print queue" description="Hold jobs and release them as printers free up." />
					<Toggle name="approvalMode" checked={false} label="Require approval" description="A teacher signs off before a print starts." />
					<div class="grid grid-cols-2 gap-4">
						<div><label class="label" for="g">Filament / student / mo (g)</label><input class="input" id="g" name="defaultMonthlyGramLimit" type="number" min="0" placeholder="Unlimited" /></div>
						<div><label class="label" for="j">Prints / student / mo</label><input class="input" id="j" name="defaultMonthlyJobLimit" type="number" min="0" placeholder="Unlimited" /></div>
					</div>
					<div class="max-w-[12rem]"><label class="label" for="cost">Material cost ($/kg)</label><input class="input" id="cost" name="defaultCostPerKg" type="number" step="0.01" min="0" value="24.00" /></div>
					<div class="flex justify-between pt-1">
						<button type="button" class="btn btn-ghost" onclick={() => (step = 1)}>Back</button>
						<button class="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'} <Icon name="chevronRight" size={16} /></button>
					</div>
				</form>

			{:else if step === 3}
				<h2 class="text-2xl font-semibold">Connect your Bambu account</h2>
				<p class="mt-1.5 text-sm text-soft-ink">Import your printers and stream live status. You can skip and do this later.</p>
				<div class="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-[#a35f00]">
					⚠ Connecting may sign the Bambu Handy app out (one session per account). Use a dedicated lab account.
				</div>

				{#if showCode}
					<form method="POST" action="?/bambuVerify" use:enhance={submit} class="mt-5 space-y-4">
						<input type="hidden" name="email" value={pendingEmail} />
						<input type="hidden" name="region" value={pendingRegion} />
						<p class="text-sm text-soft-ink">Enter the code Bambu emailed to <span class="font-semibold text-ink">{pendingEmail}</span>.</p>
						<input class="input tracking-widest" name="code" inputmode="numeric" placeholder="123456" autocomplete="one-time-code" required />
						<div class="flex justify-between">
							<button type="button" class="btn btn-ghost" onclick={() => (showCode = false)}>← Back</button>
							<button class="btn btn-primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify & import'}</button>
						</div>
					</form>
				{:else}
					<form method="POST" action="?/bambuLogin" use:enhance={submit} class="mt-5 space-y-4">
						<div><label class="label" for="be">Bambu email</label><input class="input" id="be" name="email" type="email" placeholder="lab@school.edu" required /></div>
						<div><label class="label" for="bp">Password</label><input class="input" id="bp" name="password" type="password" required /></div>
						<div><label class="label" for="br">Region</label><select class="select" id="br" name="region"><option value="us">United States / Global</option><option value="eu">Europe</option><option value="cn">China</option></select></div>
						<div class="flex items-center justify-between pt-1">
							<button type="button" class="btn btn-ghost" onclick={() => (step = 4)}>Skip for now</button>
							<button class="btn btn-primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect & import'}</button>
						</div>
					</form>
				{/if}

			{:else}
				<h2 class="text-2xl font-semibold">Invite your class 🎉</h2>
				<p class="mt-1.5 text-sm text-soft-ink">Share a link so students can join. You're all set!</p>
				{#if inviteTok}
					<div class="mt-5 rounded-xl border border-warm-200 bg-surface p-4">
						<p class="label">Student invite link</p>
						<div class="flex items-center gap-2">
							<code class="flex-1 truncate rounded-md bg-warm-100 px-2 py-1.5 text-xs text-soft-ink">{inviteLink(inviteTok)}</code>
							<button class="btn btn-secondary btn-sm" onclick={() => copy(inviteTok!)}>{copied ? 'Copied!' : 'Copy'}</button>
						</div>
						<p class="mt-2 text-xs text-muted-ink">Manage invites and roles anytime from the Invites page.</p>
					</div>
				{:else}
					<form method="POST" action="?/createInvite" use:enhance={submit} class="mt-5">
						<input type="hidden" name="role" value="student" />
						<button class="btn btn-secondary w-full" disabled={busy}>{busy ? 'Creating…' : 'Generate a student invite link'}</button>
					</form>
				{/if}
				<button class="btn btn-primary mt-5 w-full" onclick={() => goto('/admin')}>Go to my dashboard <Icon name="chevronRight" size={16} /></button>
			{/if}
		</div>
	</main>
</div>
