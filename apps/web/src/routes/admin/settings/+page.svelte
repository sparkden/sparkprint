<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	let { data, form } = $props();
	let saving = $state(false);
</script>

<svelte:head><title>Settings · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<PageHeader title="Lab settings" subtitle="Policies that apply to your whole lab." />

	{#if form?.success}
		<div class="mb-5 rounded-lg border border-success/30 bg-success/5 px-3.5 py-2.5 text-sm text-success">
			Settings saved.
		</div>
	{:else if form?.error}
		<div class="mb-5 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
			{form.error}
		</div>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
		class="space-y-6"
	>
		<div class="card space-y-4 p-6">
			<h2 class="text-lg font-semibold">General</h2>
			<div>
				<label class="label" for="name">Lab name</label>
				<input class="input" id="name" name="name" value={data.org.name} required />
			</div>
		</div>

		<div class="card space-y-5 p-6">
			<h2 class="text-lg font-semibold">Workflow</h2>
			<Toggle
				name="queueEnabled"
				checked={data.org.queueEnabled}
				label="Print queue"
				description="Hold jobs in a shared queue and release them to printers as they free up."
			/>
			<Toggle
				name="approvalMode"
				checked={data.org.approvalMode}
				label="Require approval"
				description="Students' prints wait for a teacher or admin to approve before printing."
			/>
		</div>

		<div class="card space-y-4 p-6">
			<h2 class="text-lg font-semibold">Default quotas</h2>
			<p class="-mt-2 text-sm text-muted-ink">
				Applied to new members. Leave blank for unlimited. Override per-person on the Members page.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="g">Filament per month (g)</label>
					<input class="input" id="g" name="defaultMonthlyGramLimit" type="number" min="0" value={data.org.defaultMonthlyGramLimit ?? ''} placeholder="Unlimited" />
				</div>
				<div>
					<label class="label" for="j">Prints per month</label>
					<input class="input" id="j" name="defaultMonthlyJobLimit" type="number" min="0" value={data.org.defaultMonthlyJobLimit ?? ''} placeholder="Unlimited" />
				</div>
			</div>
		</div>

		<div class="card space-y-4 p-6">
			<h2 class="text-lg font-semibold">Cost accounting</h2>
			<div class="max-w-[12rem]">
				<label class="label" for="cost">Material cost ($/kg)</label>
				<input class="input" id="cost" name="defaultCostPerKg" type="number" step="0.01" min="0" value={data.org.defaultCostPerKg} />
			</div>
			<p class="text-sm text-muted-ink">Used to estimate the cost of each print.</p>
		</div>

		<div class="flex justify-end">
			<button class="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
		</div>
	</form>
</div>
