// Type surface for coverage-cell.mjs (types only; .mjs is the source of truth).

import type { AspectRecord } from './aspects.mjs';
import type { FeatureRecord } from './features.mjs';
import type { FreshnessResult, Staleness } from './freshness.mjs';
import type { LedgerRecord } from './ledger.mjs';
import type { ReleaseList } from './releases.mjs';

/** Reads a feature file's text, or null when it cannot be read. */
export type FeatureTextReader = (path: string) => string | null;

export interface LedgerCell extends FreshnessResult {
	verdict: string | null;
}

export function resolveAspectHash(aspect: AspectRecord): Promise<string>;

export function readFeatureText(path: string): string | null;

export function cachedFeatureReader(): FeatureTextReader;

export function featureFingerprintFor(
	feature: FeatureRecord,
	aspect: AspectRecord,
	releases: ReleaseList,
	readText?: FeatureTextReader,
): string | null;

export function cellFor(input: {
	feature: FeatureRecord;
	aspect: AspectRecord;
	record: LedgerRecord | null;
	aspectHash: string | null;
	staleness: Staleness;
	releases: ReleaseList;
	repoRoot: string;
	readText?: FeatureTextReader;
}): LedgerCell;
