// Type surface for features.mjs (types only; .mjs is the source of truth).

import type { AspectRecord } from './aspects.mjs';

export interface Capability {
	text: string | null;
	target: string | null;
	line: number | null;
}

export interface FeatureRecord {
	code: string;
	name: string;
	path: string;
	level: 'root' | 'branch' | 'leaf';
	data: Record<string, any>;
	keyLines: Record<string, number>;
	/** Effective: own, else the nearest ancestor's, else null. */
	surfaces: string[] | null;
	/** Effective: own, else the nearest ancestor's, else null. */
	target: string | null;
	capabilities: Capability[];
}

export function walkFeatures(featuresDir: string): Promise<FeatureRecord[]>;

export function nearestDeclaring(
	code: string,
	byCode: Map<string, FeatureRecord>,
	own: (record: FeatureRecord) => unknown,
): FeatureRecord | null;

export function ownSurfaces(record: { data?: Record<string, any> }): string[] | null;

export function ownTarget(feature: { data?: Record<string, any> }): string | null;

export function normaliseCapability(item: unknown, line: number | null): Capability;

export function readSurfaceVocabulary(featuresDir: string): Promise<{ path: string; line: number; value: unknown } | null>;

export function aspectApplies(aspect: AspectRecord, feature: FeatureRecord): boolean;

export function filterFeatures(features: FeatureRecord[], aspect: AspectRecord): FeatureRecord[];

export function findFeature(features: FeatureRecord[], code: string): FeatureRecord | null;
