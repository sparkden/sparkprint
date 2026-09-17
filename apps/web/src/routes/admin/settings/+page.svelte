<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	let { data, form } = $props();
	let saving = $state(false);
</script>

<svelte:head><title>Settings · LataPrint Admin</title></svelte:head>

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
				<label class="label" for="name">School / lab name</label>
				<input class="input" id="name" name="name" value={data.org.name} required />
				<p class="mt-1.5 text-xs text-muted-ink">Shown on the lab monitor, login screen, and throughout the app.</p>
			</div>
			<div>
				<label class="label" for="appUrl">Public app URL <span class="font-normal text-muted-ink">(for the kiosk QR code)</span></label>
				<input class="input" id="appUrl" name="appUrl" type="url" value={(data.org.settings?.appUrl as string | undefined) ?? ''} placeholder="https://print.ethans.app" />
				<p class="mt-1.5 text-xs text-muted-ink">Students scan this on the lab monitor to open the app on their phones.</p>
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
				description="Students' prints wait for a staff member or admin to approve before printing."
			/>
			<Toggle
				name="bypassApprovalStaff"
				checked={!!data.org.settings?.bypassApprovalStaff}
				label="Staff & admins skip approval"
				description="When approval is required, prints from staff, admins and owners still go straight to the queue."
			/>
		</div>

		<div class="card space-y-4 p-6">
			<h2 class="text-lg font-semibold">Student default quotas</h2>
			<p class="-mt-2 text-sm text-muted-ink">
				Applied to new students. Leave blank for unlimited. Override per-person on the Members page.
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
			<h2 class="text-lg font-semibold">Staff &amp; admin default quotas</h2>
			<p class="-mt-2 text-sm text-muted-ink">
				Applied to staff, admins and owners (instead of the student default). Leave blank for unlimited. Per-person overrides on the Members page still win.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="sg">Filament per month (g)</label>
					<input class="input" id="sg" name="staffGramLimit" type="number" min="0" value={(data.org.settings?.staffGramLimit as number | undefined) ?? ''} placeholder="Unlimited" />
				</div>
				<div>
					<label class="label" for="sj">Prints per month</label>
					<input class="input" id="sj" name="staffJobLimit" type="number" min="0" value={(data.org.settings?.staffJobLimit as number | undefined) ?? ''} placeholder="Unlimited" />
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
