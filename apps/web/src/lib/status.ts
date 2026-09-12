// Shared job-status presentation used across student & admin views.
export const JOB_STATUS_META: Record<
	string,
	{ label: string; badge: string; tone: string }
> = {
	draft: { label: 'Draft', badge: 'badge-neutral', tone: '#8a7e72' },
	pending_approval: { label: 'Awaiting approval', badge: 'badge-warning', tone: '#a35f00' },
	rejected: { label: 'Rejected', badge: 'badge-danger', tone: '#b23a25' },
	queued: { label: 'Queued', badge: 'badge-info', tone: '#2b5896' },
	slicing: { label: 'Slicing', badge: 'badge-info', tone: '#2b5896' },
	slice_failed: { label: 'Slice failed', badge: 'badge-danger', tone: '#b23a25' },
	ready: { label: 'Ready', badge: 'badge-info', tone: '#2b5896' },
	sending: { label: 'Sending', badge: 'badge-info', tone: '#2b5896' },
	printing: { label: 'Printing', badge: 'badge-spark', tone: '#e0470a' },
	paused: { label: 'Paused', badge: 'badge-warning', tone: '#a35f00' },
	awaiting_pickup: { label: 'Awaiting pickup', badge: 'badge-warning', tone: '#a35f00' },
	completed: { label: 'Completed', badge: 'badge-success', tone: '#327a27' },
	failed: { label: 'Failed', badge: 'badge-danger', tone: '#b23a25' },
	canceled: { label: 'Canceled', badge: 'badge-neutral', tone: '#8a7e72' }
};

export const PRINTER_STATUS_META: Record<string, { label: string; badge: string }> = {
	offline: { label: 'Offline', badge: 'badge-neutral' },
	idle: { label: 'Idle', badge: 'badge-success' },
	printing: { label: 'Printing', badge: 'badge-spark' },
	paused: { label: 'Paused', badge: 'badge-warning' },
	error: { label: 'Error', badge: 'badge-danger' },
	finished: { label: 'Awaiting pickup', badge: 'badge-warning' }
};

export function fmtGrams(g: number | string | null | undefined): string {
	if (g == null) return '—';
	const n = typeof g === 'string' ? parseFloat(g) : g;
	return `${Math.round(n)} g`;
}

export function fmtDuration(sec: number | null | undefined): string {
	if (sec == null) return '—';
	const h = Math.floor(sec / 3600);
	const m = Math.round((sec % 3600) / 60);
	return h ? `${h}h ${m}m` : `${m}m`;
}

export function fmtDate(d: string | Date | null | undefined): string {
	if (!d) return '—';
	const date = typeof d === 'string' ? new Date(d) : d;
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeAgo(d: string | Date | null | undefined): string {
	if (!d) return '';
	const date = typeof d === 'string' ? new Date(d) : d;
	const s = Math.floor((Date.now() - date.getTime()) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}
