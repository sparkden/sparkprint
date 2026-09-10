<script lang="ts">
	import { enhance } from '$app/forms';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();
	let loading = $state(false);

	const roleLabel: Record<string, string> = {
		owner: 'an owner',
		admin: 'an admin',
		teacher: 'a teacher',
		student: 'a student'
	};
</script>

<svelte:head><title>Join · SparkPrint</title></svelte:head>

<div class="flex min-h-full flex-col bg-soft-paper">
	<header class="mx-auto w-full max-w-6xl px-6 py-5"><a href="/"><Logo /></a></header>
	<main class="flex flex-1 items-center justify-center px-6 py-10">
		<div class="w-full max-w-md">
			{#if data.status !== 'ok'}
				<div class="card p-8 text-center">
					<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10 text-danger">
						<Icon name="alert" size={24} />
					</div>
					<h1 class="text-xl font-semibold">Invite unavailable</h1>
					<p class="mt-2 text-sm text-soft-ink">
						{#if data.status === 'invalid'}This invite link is invalid.{:else if data.status === 'expired'}This invite has expired.{:else}This invite has been used up.{/if}
					</p>
					<a href="/login" class="btn btn-secondary mt-6">Go to login</a>
				</div>
			{:else}
				<div class="card p-8">
					<h1 class="text-2xl font-semibold">Join {data.orgName}</h1>
					<p class="mt-1.5 text-sm text-soft-ink">
						You're invited as <span class="font-semibold text-spark">{roleLabel[data.role]}</span>. Create your account to get started.
					</p>

					{#if form?.error}
						<div class="mt-5 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>
					{/if}

					<form method="POST" class="mt-6 space-y-4" use:enhance={() => {
						loading = true;
						return async ({ update }) => { await update(); loading = false; };
					}}>
						<div>
							<label class="label" for="name">Your name</label>
							<input class="input" id="name" name="name" placeholder="Sam Lee" required />
						</div>
						<div>
							<label class="label" for="email">Email</label>
							<input class="input" id="email" name="email" type="email" value={data.lockedEmail ?? ''} readonly={!!data.lockedEmail} placeholder="you@school.edu" required />
						</div>
						<div>
							<label class="label" for="password">Password</label>
							<input class="input" id="password" name="password" type="password" placeholder="At least 8 characters" required />
						</div>
						<button class="btn btn-primary w-full" disabled={loading}>{loading ? 'Joining…' : 'Join lab'}</button>
					</form>

					<p class="mt-5 text-center text-sm text-soft-ink">
						Already have an account? <a href="/login" class="font-semibold text-spark hover:underline">Log in</a>
					</p>
				</div>
			{/if}
		</div>
	</main>
</div>
