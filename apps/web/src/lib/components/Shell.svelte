<script lang="ts">
	import { page } from '$app/state';
	import Logo from './Logo.svelte';
	import Icon from './Icon.svelte';
	import type { Snippet } from 'svelte';

	type NavItem = { label: string; href: string; icon: string; badge?: number; section?: string };
	let {
		nav,
		user,
		children
	}: {
		nav: NavItem[];
		user: { name: string; role: string; orgName: string };
		children: Snippet;
	} = $props();

	let mobileOpen = $state(false);

	function active(href: string) {
		const p = page.url.pathname;
		return p === href || (href !== '/app' && href !== '/admin' && p.startsWith(href + '/'));
	}
	// Group the flat nav into a top group + titled, collapsible sections (e.g. "Manage").
	const groups = $derived.by(() => {
		const g: { title: string | null; items: NavItem[] }[] = [{ title: null, items: [] }];
		for (const item of nav) {
			if (item.section) g.push({ title: item.section, items: [] });
			g[g.length - 1].items.push(item);
		}
		return g.filter((x) => x.items.length);
	});
	let collapsed = $state<Record<string, boolean>>({});
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
		class="fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col border-r border-warm-200 bg-surface shadow-sm transition-transform md:translate-x-0 md:shadow-none {mobileOpen
			? 'translate-x-0'
			: ''}"
	>
		<div class="flex h-16 shrink-0 items-center border-b border-warm-200 px-5">
			<a href={isStaff ? '/admin' : '/app'}><Logo /></a>
		</div>
		<nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
			{#each groups as group}
				{#if group.title}
					<button
						type="button"
						onclick={() => (collapsed[group.title!] = !collapsed[group.title!])}
						class="mb-1 mt-3 flex items-center justify-between rounded-lg px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wider text-faint-ink hover:bg-warm-100 hover:text-muted-ink"
					>
						<span>{group.title}</span>
						<span class="transition-transform {collapsed[group.title!] ? '' : 'rotate-90'}"><Icon name="chevronRight" size={13} /></span>
					</button>
				{/if}
				{#if !group.title || !collapsed[group.title!]}
					{#each group.items as item}
						<a
							href={item.href}
							onclick={() => (mobileOpen = false)}
							class="group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all {active(item.href)
								? 'bg-spark-soft text-spark-deep shadow-xs ring-1 ring-spark/15'
								: 'text-soft-ink hover:bg-warm-100 hover:text-ink'}"
						>
							{#if active(item.href)}
								<span class="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-spark"></span>
							{/if}
							<Icon name={item.icon} size={18} />
							<span class="flex-1">{item.label}</span>
							{#if item.badge}<span class="badge badge-spark">{item.badge}</span>{/if}
						</a>
					{/each}
				{/if}
			{/each}
		</nav>
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
					class="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-tangerine to-spark-deep text-sm font-semibold text-white shadow-spark ring-1 ring-white/40"
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
