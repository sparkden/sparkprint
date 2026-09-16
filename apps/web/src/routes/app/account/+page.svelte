<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Account · LataPrint</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<PageHeader title="Your account" subtitle="{data.profile.orgName} · {data.profile.role}" />

	<div class="space-y-6">
		<!-- Profile -->
		<form method="POST" action="?/updateProfile" use:enhance class="card space-y-4 p-6">
			<h2 class="text-lg font-semibold">Profile</h2>
			{#if form?.profileSuccess}<p class="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">Saved.</p>{/if}
			{#if form?.profileError}<p class="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{form.profileError}</p>{/if}
			<div>
				<label class="label" for="name">Name</label>
				<input class="input" id="name" name="name" value={data.profile.name} required />
			</div>
			<div>
				<label class="label" for="email">Email</label>
				<input class="input" id="email" value={data.profile.email} disabled />
				<p class="mt-1 text-xs text-muted-ink">Contact an admin to change your email.</p>
			</div>
			<div class="flex justify-end"><button class="btn btn-primary">Save profile</button></div>
		</form>

		<!-- Password -->
		<form method="POST" action="?/changePassword" use:enhance={() => async ({ update }) => update()} class="card space-y-4 p-6">
			<h2 class="text-lg font-semibold">Password</h2>
			{#if form?.passwordSuccess}<p class="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">Password changed.</p>{/if}
			{#if form?.passwordError}<p class="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{form.passwordError}</p>{/if}
			<div>
				<label class="label" for="current">Current password</label>
				<input class="input" id="current" name="current" type="password" required />
			</div>
			<div>
				<label class="label" for="next">New password</label>
				<input class="input" id="next" name="next" type="password" placeholder="At least 8 characters" required />
			</div>
			<div class="flex justify-end"><button class="btn btn-primary">Change password</button></div>
		</form>
	</div>
</div>
