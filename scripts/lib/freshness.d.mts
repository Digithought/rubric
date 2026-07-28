// Type surface for freshness.mjs (types only; .mjs is the source of truth).

export interface Staleness {
	'drift-threshold': number;
	'max-age': number | null;
	'on-spec-change': 'stale' | 'ignore' | string;
	'on-criteria-change': 'stale' | 'ignore' | string;
}

export interface DriftResult {
	count: number;
	unverifiable: boolean;
}

export interface FreshnessResult {
	state: string;
	drift: number;
	unverifiable: boolean;
	priority: number;
}

export function computeFreshness(
	record: Record<string, unknown> | null,
	ctx?: {
		featureHash?: string | null;
		aspectHash?: string | null;
		staleness?: Partial<Staleness>;
		drift?: DriftResult;
	},
): FreshnessResult;

export function resolveStaleness(aspectData: unknown): Staleness;

export function isStale(state: string): boolean;

export function parseMaxAge(spec: string | number | null): number | null;
