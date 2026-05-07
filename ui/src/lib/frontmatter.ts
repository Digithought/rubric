// Client-side helpers for working with feature/aspect frontmatter that arrives
// pre-parsed from the API. Pure utilities; no I/O.

export function asArray(val: unknown): string[] {
	if (Array.isArray(val)) return val.filter((s): s is string => typeof s === 'string');
	if (typeof val === 'string' && val) return [val];
	return [];
}

export function asString(val: unknown): string | undefined {
	return typeof val === 'string' ? val : undefined;
}

export function statusVariant(status: string | undefined): 'success' | 'warning' | 'info' | 'muted' {
	switch (status) {
		case 'implemented':
		case 'active':
			return 'success';
		case 'partial':
		case 'draft':
			return 'warning';
		case 'planned':
			return 'info';
		case 'retired':
		default:
			return 'muted';
	}
}
