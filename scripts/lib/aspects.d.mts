// Type surface for aspects.mjs (types only; .mjs is the source of truth).

import type { FeatureRecord } from './features.mjs';

export interface AspectRecord {
	name: string;
	path: string;
	data: Record<string, any>;
	keyLines: Record<string, number>;
	/** The aspect's own prompt; a child's audit prepends its parent's (`readPrompt`). */
	promptPath: string | null;
	promptSource: 'project' | 'default' | null;
	/** The aspect's own template; a child without one uses its parent's (`readTicketTemplate`). */
	ticketTemplatePath: string | null;
	ticketTemplateSource: 'project' | 'default' | null;
	/** The resolved parent's record; null for a top-level aspect or an unresolvable `parent:`. */
	parent: AspectRecord | null;
	/** Names of active children, sorted. */
	children: string[];
}

export function discoverActiveAspects(aspectsDir: string, defaultsDir: string): Promise<AspectRecord[]>;

export function readPrompt(aspect: AspectRecord): Promise<string>;

export function readTicketTemplate(aspect: AspectRecord): Promise<string | null>;

export function hasVerdicts(aspect: Pick<AspectRecord, 'children'>): boolean;

export function aspectsNamed(aspects: AspectRecord[], name: string): AspectRecord[];

export function coverageColumns(aspects: AspectRecord[]): AspectRecord[];

export function aspectLabel(aspect: Pick<AspectRecord, 'name' | 'parent'>): string;

export function annotationSchema(aspect: Pick<AspectRecord, 'data'>): Record<string, Record<string, unknown>> | null;

export function resolveAnnotation(aspect: Pick<AspectRecord, 'name' | 'data'>, feature: Pick<FeatureRecord, 'data'>): Record<string, unknown>;

export function filterByCadence(aspects: AspectRecord[], trigger: string): AspectRecord[];
