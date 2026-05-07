// Tiny helpers for run-log rendering on the client.

export function verdictColor(verdict: string): string {
	switch (verdict) {
		case 'covered':
			return 'var(--success)';
		case 'partial':
			return 'var(--warning)';
		case 'gap':
			return 'var(--danger)';
		case 'na':
		case 'n/a':
		case 'n':
			return 'var(--text-light)';
		default:
			return 'var(--text-muted)';
	}
}

export function verdictBackground(verdict: string): string {
	switch (verdict) {
		case 'covered':
			return 'var(--success-subtle)';
		case 'partial':
			return 'var(--warning-subtle)';
		case 'gap':
			return 'var(--danger-subtle)';
		default:
			return 'var(--surface)';
	}
}

export function formatDuration(start?: string, finish?: string): string | null {
	if (!start || !finish) return null;
	const s = Date.parse(start);
	const f = Date.parse(finish);
	if (Number.isNaN(s) || Number.isNaN(f) || f < s) return null;
	const ms = f - s;
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
	return `${(ms / 3_600_000).toFixed(1)}h`;
}
