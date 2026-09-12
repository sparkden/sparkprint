<script lang="ts">
	import Shell from '$lib/components/Shell.svelte';
	import { buildNav } from '$lib/nav';
	let { data, children } = $props();
	const nav = $derived(buildNav(data.user.role, { pendingApprovals: data.pendingApprovals }));
</script>

<Shell {nav} user={data.user}>
	{@render children()}
</Shell>
