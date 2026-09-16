<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { timeAgo } from '$lib/status';
	let { data, form } = $props();

	let editing = $state<null | (typeof data.members)[number]>(null);
	let open = $state(false);

	const roleBadge: Record<string, string> = {
		owner: 'badge-spark',
		admin: 'badge-info',
		teacher: 'badge-warning',
		student: 'badge-neutral'
	};

	function manage(m: (typeof data.members)[number]) {
		editing = m;
		open = true;
	}
	const canEditOwners = $derived(data.myRole === 'owner');
</script>

<svelte:head><title>Members · SparkPrint Admin</title></svelte:head>

<div class="mx-auto max-w-5xl">
	<PageHeader title="Members" subtitle="{data.members.length} people in your lab.">
		{#snippet actions()}
			<a href="/admin/invites" class="btn btn-primary btn-sm"><Icon name="link" size={16} /> Invite people</a>
		{/snippet}
	</PageHeader>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">{form.error}</div>
	{/if}

	<div class="card overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="border-b border-warm-200 bg-soft-paper text-left text-xs uppercase tracking-wide text-muted-ink">
					<tr>
						<th class="px-5 py-3 font-semibold">Name</th>
						<th class="px-5 py-3 font-semibold">Role</th>
						<th class="px-5 py-3 font-semibold">Prints · filament · cost</th>
						<th class="px-5 py-3 font-semibold">Quota (g / prints)</th>
						<th class="px-5 py-3 font-semibold">Last active</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-warm-200">
					{#each data.members as m}
						<tr class="hover:bg-soft-paper/50">
							<td class="px-5 py-3">
								<div class="font-medium text-ink">{m.name} {#if m.id === data.meId}<span class="text-xs text-muted-ink">(you)</span>{/if}</div>
								<div class="text-xs text-muted-ink">{m.email}</div>
							</td>
							<td class="px-5 py-3">
								<span class="badge {roleBadge[m.role]} capitalize">{m.role}</span>
								{#if m.status === 'suspended'}<span class="badge badge-danger ml-1">Suspended</span>{/if}
							</td>
							<td class="px-5 py-3 text-soft-ink tabular-nums">
								<span class="font-medium text-ink">{m.prints}</span> prints · {m.grams} g · <span class="font-medium text-ink">${m.cost.toFixed(2)}</span>
							</td>
							<td class="px-5 py-3 text-soft-ink">
								{m.monthlyGramLimit ?? '∞'} g / {m.monthlyJobLimit ?? '∞'}
							</td>
							<td class="px-5 py-3 text-muted-ink">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'never'}</td>
							<td class="px-5 py-3 text-right">
								<button class="btn btn-secondary btn-sm" onclick={() => manage(m)}>Manage</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

{#if editing}
	<Modal bind:open title="Manage {editing.name}">
		{@const m = editing}
		<div class="space-y-6">
			<!-- Lifetime stats -->
			<div class="grid grid-cols-3 gap-3 rounded-xl border border-warm-200 bg-soft-paper p-3 text-center">
				<div><div class="text-xs text-muted-ink">Prints</div><div class="text-lg font-bold text-ink">{m.prints}</div></div>
				<div><div class="text-xs text-muted-ink">Filament</div><div class="text-lg font-bold text-ink">{m.grams} g</div></div>
				<div><div class="text-xs text-muted-ink">Cost</div><div class="text-lg font-bold text-ink">${m.cost.toFixed(2)}</div></div>
			</div>
			<a href="/admin/members/{m.id}" class="text-sm font-semibold text-spark hover:underline">View all their prints →</a>

			<!-- Role -->
			<form method="POST" action="?/updateRole" use:enhance class="flex items-end gap-3">
				<input type="hidden" name="userId" value={m.id} />
				<div class="flex-1">
					<label class="label" for="role">Role</label>
					<select class="select" id="role" name="role" value={m.role} disabled={m.role === 'owner' && !canEditOwners}>
						<option value="student">Student</option>
						<option value="teacher">Teacher</option>
						<option value="admin" disabled={!canEditOwners}>Admin</option>
						<option value="owner" disabled={!canEditOwners}>Owner</option>
					</select>
				</div>
				<button class="btn btn-secondary">Save role</button>
			</form>

			<!-- Quota -->
			<form method="POST" action="?/updateQuota" use:enhance class="space-y-3">
				<input type="hidden" name="userId" value={m.id} />
				<p class="label">Quota override (blank = lab default)</p>
				<div class="flex items-end gap-3">
					<div class="flex-1">
						<label class="label text-xs" for="g">Filament / month (g)</label>
						<input class="input" id="g" name="monthlyGramLimit" type="number" min="0" value={m.monthlyGramLimit ?? ''} placeholder="Default" />
					</div>
					<div class="flex-1">
						<label class="label text-xs" for="j">Prints / month</label>
						<input class="input" id="j" name="monthlyJobLimit" type="number" min="0" value={m.monthlyJobLimit ?? ''} placeholder="Default" />
					</div>
					<button class="btn btn-secondary">Save</button>
				</div>
			</form>

			<!-- Danger zone -->
			{#if m.id !== data.meId && m.role !== 'owner'}
				<div class="flex items-center gap-2 border-t border-warm-200 pt-4">
					<form method="POST" action="?/setStatus" use:enhance>
						<input type="hidden" name="userId" value={m.id} />
						<input type="hidden" name="status" value={m.status === 'suspended' ? 'active' : 'suspended'} />
						<button class="btn btn-secondary btn-sm">
							{m.status === 'suspended' ? 'Reactivate' : 'Suspend'}
						</button>
					</form>
					<form method="POST" action="?/remove" use:enhance={() => {
						return async ({ update, result }) => {
							await update();
							if (result.type === 'success') open = false;
						};
					}}>
						<input type="hidden" name="userId" value={m.id} />
						<button class="btn btn-danger btn-sm"><Icon name="trash" size={15} /> Remove</button>
					</form>
				</div>
			{/if}
		</div>
	</Modal>
{/if}
