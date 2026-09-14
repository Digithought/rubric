// Type surface for scope.mjs (types only; .mjs is the source of truth).

import type { Capability, FeatureRecord } from './features.mjs';
import type { ReleaseList } from './releases.mjs';

export interface Target {
	kind: 'current' | 'release' | 'all';
	/** The current release for `current` (null with no release list), the release for `release`, null for `all`. */
	code: string | null;
	/** Null for `all`. */
	rank: number | null;
}

export interface RecordedTarget {
	/** `current`, `all`, or a release code. */
	target: string;
	release: string | null;
	releaseList: 'present' | 'absent';
}

type Ranked = Pick<ReleaseList, 'codes'>;

export function featureRank(feature: Pick<FeatureRecord, 'target'>, list: Ranked): number;

export function capabilityRank(feature: Pick<FeatureRecord, 'target'>, cap: Pick<Capability, 'target'>, list: Ranked): number;

export function resolveTarget(value: string | null | undefined, list: Pick<ReleaseList, 'codes' | 'current'>): Target | { error: string };

export function targetName(target: Target): string;

export function featureInScope(feature: Pick<FeatureRecord, 'target' | 'capabilities'>, target: Target, list: Ranked): boolean;

export function capabilityScope(
	feature: Pick<FeatureRecord, 'target' | 'capabilities'>,
	target: Target,
	list: Ranked,
): { audit: Capability[]; deferred: Array<{ cap: Capability; code: string | null }>; only: boolean };

export function capabilityDueWithFeature(feature: Pick<FeatureRecord, 'target'>, cap: Pick<Capability, 'target'>, list: Ranked): boolean;

export function recordedTarget(target: Target, list: Pick<ReleaseList, 'current' | 'present'>): RecordedTarget;

export function describeTarget(recorded: RecordedTarget): string;
