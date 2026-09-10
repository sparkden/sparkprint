<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data } = $props();

	const features = [
		{
			icon: 'palette',
			title: 'Design in the cloud',
			body: 'Students import a model, arrange it, and pick a color right in the browser — nothing to install.'
		},
		{
			icon: 'printer',
			title: 'One pool, many printers',
			body: 'Map every AMS slot to a color. Jobs route to the next available printer that has the right filament.'
		},
		{
			icon: 'gauge',
			title: 'Quotas & tracking',
			body: 'Cap each student by grams or jobs per month. Every gram and minute is tracked and costed.'
		},
		{
			icon: 'check',
			title: 'Approvals & queue',
			body: 'Turn on a shared queue and require teacher sign-off before a print ever starts.'
		},
		{
			icon: 'spool',
			title: 'Color inventory',
			body: 'Manage filament stock and colors across the whole lab, with low-stock warnings.'
		},
		{
			icon: 'users',
			title: 'No shared logins',
			body: 'Invite students with a link. One connected Bambu account powers the whole school.'
		}
	];
</script>

<div class="min-h-full bg-paper">
	<!-- Nav -->
	<header class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
		<Logo />
		<nav class="flex items-center gap-2">
			{#if data.user}
				<a href="/app" class="btn btn-primary btn-sm">Open app</a>
			{:else}
				<a href="/login" class="btn btn-ghost btn-sm">Log in</a>
				<a href="/signup" class="btn btn-primary btn-sm">Get started</a>
			{/if}
		</nav>
	</header>

	<!-- Hero -->
	<section class="mx-auto max-w-6xl px-6 pt-10 pb-20 md:pt-20">
		<div class="max-w-3xl">
			<span class="badge badge-spark mb-5"><Icon name="bolt" size={13} /> For schools & makerspaces</span>
			<h1 class="text-5xl leading-[1.05] font-semibold tracking-tight md:text-6xl">
				Run your whole Bambu Lab
				<span class="text-spark">print lab</span> from the cloud.
			</h1>
			<p class="mt-6 max-w-xl text-lg text-soft-ink">
				SparkPrint lets students <span class="accent-serif text-ink">slice, design, and print</span>
				from any browser — while you keep control of printers, colors, costs, and quotas. No shared
				Bambu account, no chaos.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<a href="/signup" class="btn btn-primary">Set up your school <Icon name="chevronRight" size={16} /></a>
				<a href="#how" class="btn btn-secondary">See how it works</a>
			</div>
		</div>
	</section>

	<!-- Features -->
	<section id="how" class="border-t border-warm-200 bg-soft-paper/60 py-20">
		<div class="mx-auto max-w-6xl px-6">
			<h2 class="text-3xl font-semibold">Everything the lab needs</h2>
			<p class="mt-2 text-soft-ink">Built for classrooms with more students than printers.</p>
			<div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each features as f}
					<div class="card p-6">
						<div
							class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-spark-soft text-spark-deep"
						>
							<Icon name={f.icon} size={22} />
						</div>
						<h3 class="text-lg font-semibold">{f.title}</h3>
						<p class="mt-1.5 text-sm leading-relaxed text-soft-ink">{f.body}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Flow -->
	<section class="py-20">
		<div class="mx-auto max-w-6xl px-6">
			<h2 class="text-3xl font-semibold">How a print happens</h2>
			<div class="mt-10 grid gap-6 md:grid-cols-4">
				{#each [{ n: '1', t: 'Import', d: 'Student uploads an STL or 3MF.' }, { n: '2', t: 'Design', d: 'Arrange, scale, and pick a color.' }, { n: '3', t: 'Approve', d: 'Optional teacher sign-off & quota check.' }, { n: '4', t: 'Print', d: 'Auto-routed to the next open printer.' }] as s}
					<div class="relative">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full bg-spark font-display text-lg font-semibold text-white"
						>
							{s.n}
						</div>
						<h3 class="mt-4 text-lg font-semibold">{s.t}</h3>
						<p class="mt-1 text-sm text-soft-ink">{s.d}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="mx-auto max-w-6xl px-6 pb-24">
		<div class="card overflow-hidden bg-ink p-10 text-center md:p-14">
			<h2 class="text-3xl font-semibold text-white md:text-4xl">Ready to spark something?</h2>
			<p class="mx-auto mt-3 max-w-md text-warm-300">
				Connect your Bambu account, add your printers, and invite your first class in minutes.
			</p>
			<a href="/signup" class="btn btn-primary mt-7">Create your lab</a>
		</div>
	</section>

	<footer class="border-t border-warm-200 py-8">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-6 text-sm text-muted-ink">
			<Logo size={22} />
			<span>© {new Date().getFullYear()} SparkPrint · Sparkden</span>
		</div>
	</footer>
</div>
