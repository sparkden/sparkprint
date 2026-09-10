<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDate } from '$lib/status';
	let { data, form } = $props();

	let open = $state(false);
	let copied = $state<string | null>(null);

	const origin = $derived(page.url.origin);
	function link(token: string) {
		return `${origin}/join/${token}`;
	}
	async function copy(token: string) {
		await navigator.clipboard.writeText(link(token));
		copied = token;
		setTimeout(() => (copied = null), 1500);
	}
	function expired(d: string | Date | null) {
		return d ? new Date(d).getTime() < Date.now() : false;
	}
	function exhausted(i: (typeof data.invites)[number]) {
		return i.maxUses != null && i.uses >= i.maxUses;
	}
</script>

<svelte:head><title>Invites · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-4xl">
	<PageHeader title="Invites" subtitle="Share a link so people can join your lab.">
		{#snippet actions()}
			<button class="btn btn-primary btn-sm" onclick={() => (open = true)}><Icon name="plus" size={16} /> New invite</button>
		{/snippet}
	</PageHeader>

	{#if data.invites.length === 0}
		<div class="card flex flex-col items-center justify-center p-12 text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 text-muted-ink">
				<Icon name="link" size={24} />
			</div>
			<p class="text-sm text-soft-ink">No invite links yet.</p>
			<button class="btn btn-primary btn-sm mt-4" onclick={() => (open = true)}>Create your first invite</button>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.invites as i}
				{@const dead = expired(i.expiresAt) || exhausted(i)}
				<div class="card flex flex-wrap items-center gap-4 p-4 {dead ? 'opacity-60' : ''}">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="badge badge-info capitalize">{i.role}</span>
							{#if i.email}<span class="text-xs text-muted-ink">for {i.email}</span>{/if}
							{#if dead}<span class="badge badge-danger">{exhausted(i) ? 'Used up' : 'Expired'}</span>{/if}
						</div>
						<div class="mt-2 flex items-center gap-2">
							<code class="truncate rounded-md bg-warm-100 px-2 py-1 text-xs text-soft-ink">{link(i.token)}</code>
						</div>
						<p class="mt-1.5 text-xs text-muted-ink">
							Uses: {i.uses}{i.maxUses != null ? `/${i.maxUses}` : ' (unlimited)'}
							· Quota: {i.monthlyGramLimit ?? '∞'} g / {i.monthlyJobLimit ?? '∞'} prints
							{#if i.expiresAt}· Expires {fmtDate(i.expiresAt)}{/if}
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button class="btn btn-secondary btn-sm" onclick={() => copy(i.token)} disabled={dead}>
							{copied === i.token ? 'Copied!' : 'Copy link'}
						</button>
						<form method="POST" action="?/revoke" use:enhance>
							<input type="hidden" name="id" value={i.id} />
							<button class="btn btn-ghost btn-sm text-danger" title="Revoke"><Icon name="trash" size={15} /></button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<Modal bind:open title="Create invite link">
	<form method="POST" action="?/create" use:enhance={() => {
		return async ({ update, result }) => {
			await update();
			if (result.type === 'success') open = false;
		};
	}} class="space-y-4">
		<div>
			<label class="label" for="role">Role</label>
			<select class="select" id="role" name="role">
				<option value="student">Student</option>
				<option value="teacher">Teacher</option>
				<option value="admin">Admin</option>
			</select>
		</div>
		<div>
			<label class="label" for="email">Lock to email <span class="font-normal text-muted-ink">(optional)</span></label>
			<input class="input" id="email" name="email" type="email" placeholder="Anyone with the link can join" />
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label class="label" for="g">Filament quota (g/mo)</label>
				<input class="input" id="g" name="monthlyGramLimit" type="number" min="0" placeholder="Lab default" />
			</div>
			<div>
				<label class="label" for="j">Print quota (/mo)</label>
				<input class="input" id="j" name="monthlyJobLimit" type="number" min="0" placeholder="Lab default" />
			</div>
			<div>
				<label class="label" for="max">Max uses</label>
				<input class="input" id="max" name="maxUses" type="number" min="1" placeholder="Unlimited" />
			</div>
			<div>
				<label class="label" for="exp">Expires in (days)</label>
				<input class="input" id="exp" name="expiresInDays" type="number" min="1" placeholder="Never" />
			</div>
		</div>
		{#if form?.error}<p class="text-sm text-danger">{form.error}</p>{/if}
		<div class="flex justify-end gap-2 pt-2">
			<button type="button" class="btn btn-secondary" onclick={() => (open = false)}>Cancel</button>
			<button class="btn btn-primary">Create invite</button>
		</div>
	</form>
</Modal>
