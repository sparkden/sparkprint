<script lang="ts">
	import { page } from '$app/state';
	import Logo from './Logo.svelte';
	import Icon from './Icon.svelte';
	import type { Snippet } from 'svelte';

	type NavItem = { label: string; href: string; icon: string; badge?: number };
	let {
		nav,
		user,
		area = 'app',
		children
	}: {
		nav: NavItem[];
		user: { name: string; role: string; orgName: string };
		area?: 'app' | 'admin';
		children: Snippet;
	} = $props();

	let mobileOpen = $state(false);

	function active(href: string) {
		const p = page.url.pathname;
		return p === href || (href !== '/app' && href !== '/admin' && p.startsWith(href + '/'));
	}
	const isStaff = $derived(['owner', 'admin', 'teacher'].includes(user.role));
	const initials = $derived(
		user.name
			.split(' ')
			.map((n) => n[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div class="flex min-h-full bg-soft-paper">
	<!-- Sidebar -->
	<aside
		class="fixed inset-y-0 left-0 z-40 w-64 -translate-x-full border-r border-warm-200 bg-surface transition-transform md:translate-x-0 {mobileOpen
			? 'translate-x-0'
			: ''}"
	>
		<div class="flex h-16 items-center border-b border-warm-200 px-5">
			<a href={isStaff ? '/admin' : '/app'}><Logo /></a>
		</div>
		<nav class="flex flex-col gap-0.5 p-3">
			{#each nav as item}
				<a
					href={item.href}
					onclick={() => (mobileOpen = false)}
					class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors {active(
						item.href
					)
						? 'bg-spark-soft text-spark-deep'
						: 'text-soft-ink hover:bg-warm-100'}"
				>
					<Icon name={item.icon} size={18} />
					<span class="flex-1">{item.label}</span>
					{#if item.badge}
						<span class="badge badge-spark">{item.badge}</span>
					{/if}
				</a>
			{/each}
		</nav>

		{#if isStaff}
			<div class="mx-3 mt-2 border-t border-warm-200 pt-3">
				<a
					href={area === 'admin' ? '/app' : '/admin'}
					class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-ink hover:bg-warm-100"
				>
					<Icon name={area === 'admin' ? 'palette' : 'settings'} size={18} />
					{area === 'admin' ? 'Student view' : 'Admin console'}
				</a>
			</div>
		{/if}
	</aside>

	{#if mobileOpen}
		<button
			aria-label="Close menu"
			class="fixed inset-0 z-30 bg-ink/20 md:hidden"
			onclick={() => (mobileOpen = false)}
		></button>
	{/if}

	<!-- Main -->
	<div class="flex min-w-0 flex-1 flex-col md:pl-64">
		<header
			class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-warm-200 bg-paper/85 px-5 backdrop-blur"
		>
			<button class="btn btn-ghost btn-sm md:hidden" onclick={() => (mobileOpen = true)} aria-label="Menu">
				<Icon name="queue" size={20} />
			</button>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold text-ink">{user.orgName}</p>
			</div>
			<div class="flex items-center gap-3">
			<a href="/app/account" class="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-warm-100" title="Account settings">
				<div class="hidden text-right sm:block">
					<p class="text-sm font-semibold leading-tight text-ink">{user.name}</p>
					<p class="text-xs capitalize leading-tight text-muted-ink">{user.role}</p>
				</div>
				<div
					class="flex h-9 w-9 items-center justify-center rounded-full bg-spark text-sm font-semibold text-white"
				>
					{initials}
				</div>
			</a>
				<form method="POST" action="/logout">
					<button class="btn btn-ghost btn-sm" title="Log out" aria-label="Log out">
						<Icon name="logout" size={18} />
					</button>
				</form>
			</div>
		</header>

		<main class="flex-1 p-5 md:p-8">
			{@render children()}
		</main>
	</div>
</div>
