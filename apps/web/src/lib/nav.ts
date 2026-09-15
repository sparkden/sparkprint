// One unified sidebar for everyone. Students see the "make + prints" tabs; staff get the same
// tabs plus a "Manage" section — no separate student/admin apps.
export type NavItem = { label: string; href: string; icon: string; badge?: number; section?: string };

export function buildNav(role: string, opts: { pendingApprovals?: number } = {}): NavItem[] {
	const staff = ['owner', 'admin', 'teacher'].includes(role);
	const admin = ['owner', 'admin'].includes(role);

	const items: NavItem[] = [
		{ label: 'Home', href: '/app', icon: 'dashboard' },
		{ label: 'New print', href: '/app/design', icon: 'palette' },
		{ label: 'My prints', href: '/app/jobs', icon: 'layers' },
		{ label: 'Printers', href: '/app/printers', icon: 'printer' },
		{ label: 'Lab monitor', href: '/monitor', icon: 'eye' }
	];

	if (staff) {
		items.push(
			{ label: 'Overview', href: '/admin', icon: 'gauge', section: 'Manage' },
			{ label: 'Approvals', href: '/admin/approvals', icon: 'check', badge: opts.pendingApprovals || undefined },
			{ label: 'Queue', href: '/admin/queue', icon: 'queue' }
		);
		if (admin) {
			items.push(
				{ label: 'Manage printers', href: '/admin/printers', icon: 'printer' },
				{ label: 'Filament', href: '/admin/inventory', icon: 'spool' },
				{ label: 'Members', href: '/admin/members', icon: 'users' },
				{ label: 'Invites', href: '/admin/invites', icon: 'link' },
				{ label: 'Diagnostics', href: '/admin/diagnostics', icon: 'gauge' },
				{ label: 'Kiosk', href: '/admin/kiosk', icon: 'eye' },
				{ label: 'Terminal', href: '/admin/terminal', icon: 'terminal' },
				{ label: 'Update', href: '/admin/update', icon: 'refresh' },
				{ label: 'Settings', href: '/admin/settings', icon: 'settings' }
			);
		}
	}
	return items;
}
