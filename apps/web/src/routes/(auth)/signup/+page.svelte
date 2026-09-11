<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();
	let loading = $state(false);
	const firstRun = $derived(data.firstRun);
</script>

<svelte:head><title>{firstRun ? 'Create your lab' : 'Sign up'} · SparkPrint</title></svelte:head>

<div class="card p-8">
	{#if firstRun}
		<h1 class="text-2xl font-semibold">Set up your lab</h1>
		<p class="mt-1.5 text-sm text-soft-ink">You're the first user, so you'll be the owner. Everyone else joins this lab afterward.</p>
	{:else}
		<h1 class="text-2xl font-semibold">Create your account</h1>
		<p class="mt-1.5 text-sm text-soft-ink">Join {data.orgName ?? 'the lab'} on SparkPrint.</p>
	{/if}

	{#if form?.error}
		<div class="mt-5 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
			{form.error}
		</div>
	{/if}

	<form
		method="POST"
		class="mt-6 space-y-4"
		use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				await update();
				loading = false;
			};
		}}
	>
		{#if firstRun}
			<div>
				<label class="label" for="schoolName">School / lab name</label>
				<input class="input" id="schoolName" name="schoolName" value={form?.values?.schoolName ?? ''} placeholder="Lincoln High Makerspace" required />
			</div>
		{/if}
		<div>
			<label class="label" for="name">Your name</label>
			<input class="input" id="name" name="name" value={form?.values?.name ?? ''} placeholder="Alex Rivera" required />
		</div>
		<div>
			<label class="label" for="email">Email</label>
			<input class="input" id="email" name="email" type="email" value={form?.values?.email ?? ''} placeholder="you@school.edu" required />
		</div>
		<div>
			<label class="label" for="password">Password</label>
			<input class="input" id="password" name="password" type="password" placeholder="At least 8 characters" required />
		</div>
		<button class="btn btn-primary w-full" disabled={loading}>
			{#if loading}Creating…{:else}{firstRun ? 'Create lab' : 'Create account'} <Icon name="chevronRight" size={16} />{/if}
		</button>
	</form>

	<p class="mt-5 text-center text-sm text-soft-ink">
		Already have an account? <a href="/login" class="font-semibold text-spark hover:underline">Log in</a>
	</p>
</div>
