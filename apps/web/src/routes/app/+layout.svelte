<script lang="ts">
	import Shell from '$lib/components/Shell.svelte';
	let { data, children } = $props();

	const nav = [
		{ label: 'Home', href: '/app', icon: 'dashboard' },
		{ label: 'New print', href: '/app/design', icon: 'palette' },
		{ label: 'My prints', href: '/app/jobs', icon: 'layers' },
		{ label: 'Printers', href: '/app/printers', icon: 'printer' }
	];
</script>

<Shell {nav} user={data.user} area="app">
	{@render children()}
</Shell>
