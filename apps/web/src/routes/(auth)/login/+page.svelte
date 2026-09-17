<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let loading = $state(false);
</script>

<svelte:head><title>Log in · LataPrint</title></svelte:head>

<div class="card p-8">
	<h1 class="text-2xl font-semibold">Welcome back</h1>
	<p class="mt-1.5 text-sm text-soft-ink">Log in to your lab.</p>

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
		<div>
			<label class="label" for="email">Email</label>
			<input class="input" id="email" name="email" type="email" value={form?.email ?? ''} placeholder="you@school.edu" required />
		</div>
		<div>
			<label class="label" for="password">Password</label>
			<input class="input" id="password" name="password" type="password" required />
		</div>
		<button class="btn btn-primary w-full" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</button>
	</form>

	{#if data.firstRun}
		<p class="mt-5 text-center text-sm text-soft-ink">
			New here? <a href="/signup" class="font-semibold text-spark hover:underline">Set up your lab</a>
		</p>
	{:else}
		<p class="mt-5 text-center text-sm text-muted-ink">
			Need access? Ask a staff member or admin for an invite link.
		</p>
	{/if}
</div>
