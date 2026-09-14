// Type surface for aspects.mjs (types only; .mjs is the source of truth).

import type { FeatureRecord } from './features.mjs';

export interface AspectRecord {
	name: string;
	path: string;
	data: Record<string, any>;
	keyLines: Record<string, number>;
	promptPath: string | null;
	promptSource: 'project' | 'default' | null;
	ticketTemplatePath: string | null;
	ticketTemplateSource: 'project' | 'default' | null;
}

export function discoverActiveAspects(aspectsDir: string, defaultsDir: string): Promise<AspectRecord[]>;

export function readPrompt(aspect: AspectRecord): Promise<string>;

export function readTicketTemplate(aspect: AspectRecord): Promise<string | null>;

export function annotationSchema(aspect: Pick<AspectRecord, 'data'>): Record<string, Record<string, unknown>> | null;

export function resolveAnnotation(aspect: Pick<AspectRecord, 'name' | 'data'>, feature: Pick<FeatureRecord, 'data'>): Record<string, unknown>;

export function filterByCadence(aspects: AspectRecord[], trigger: string): AspectRecord[];
