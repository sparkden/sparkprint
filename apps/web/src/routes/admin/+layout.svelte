<script lang="ts">
	import Shell from '$lib/components/Shell.svelte';
	let { data, children } = $props();

	const isAdmin = $derived(['owner', 'admin'].includes(data.user.role));

	const nav = $derived([
		{ label: 'Overview', href: '/admin', icon: 'dashboard' },
		{ label: 'Approvals', href: '/admin/approvals', icon: 'check', badge: data.pendingApprovals || undefined },
		{ label: 'Queue', href: '/admin/queue', icon: 'queue' },
		...(isAdmin
			? [
					{ label: 'Printers', href: '/admin/printers', icon: 'printer' },
					{ label: 'Filament', href: '/admin/inventory', icon: 'spool' },
					{ label: 'Members', href: '/admin/members', icon: 'users' },
					{ label: 'Invites', href: '/admin/invites', icon: 'link' },
					{ label: 'Settings', href: '/admin/settings', icon: 'settings' }
				]
			: [])
	]);
</script>

<Shell {nav} user={data.user} area="admin">
	{@render children()}
</Shell>
