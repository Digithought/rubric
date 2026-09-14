// Type surface for ledger.mjs (the .mjs is the source of truth; this only feeds
// TypeScript importers such as the rubric UI's Vite API plugin).

import type { AspectRecord } from './aspects.mjs';
import type { FeatureRecord } from './features.mjs';
import type { ReleaseList } from './releases.mjs';

export const LEDGER_FILE: string;

export interface LedgerRecord {
	verdict?: string;
	audited?: string;
	'audited-commit'?: string;
	'feature-hash'?: string;
	'aspect-hash'?: string;
	evidence?: string[];
	run?: string;
	ticket?: string | null;
	pinned?: boolean;
	[key: string]: unknown;
}

export interface Ledger {
	aspect: string;
	generated: string | null;
	records: Record<string, LedgerRecord>;
}

export function ledgerPath(aspectsDir: string, aspectName: string): string;

export function readLedger(aspectsDir: string, aspectName: string): Promise<Ledger>;

export function writeLedger(
	aspectsDir: string,
	aspectName: string,
	ledger: Ledger,
	snapshot?: Record<string, { freshness?: string; drift?: number | string }>,
): Promise<void>;

export function upsertRecord(ledger: Ledger, code: string, record: LedgerRecord): Ledger;

export function featureFingerprint(input: {
	raw: string;
	feature: Pick<FeatureRecord, 'data' | 'surfaces' | 'target'>;
	aspect: Pick<AspectRecord, 'name' | 'data'>;
	releases: Pick<ReleaseList, 'codes'>;
}): string;

export function hashAspectConfig(input: {
	aspectMdRaw?: string;
	promptBody?: string;
	ticketTemplateBody?: string | null;
}): string;
