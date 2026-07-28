// Mirrors the shapes returned by the rubric Vite API plugin.

export interface FeatureNode {
	code: string;
	leafCode: string;
	name: string;
	path: string;
	hasFile: boolean;
	children: FeatureNode[];
}

export interface FeatureFrontmatter {
	status?: string;
	summary?: string;
	description?: string;
	capabilities?: string[];
	related?: string[];
	[key: string]: unknown;
}

export interface FeatureDetail {
	path: string;
	code: string;
	name: string;
	meta: FeatureFrontmatter;
	body: string;
	raw: string;
}

export interface AspectSummary {
	name: string;
	status?: string;
	level?: string;
	batch?: number;
	cadence?: string[];
	extends?: string;
	hasProjectPrompt: boolean;
	hasDefaultPrompt: boolean;
	ticketSystem?: string;
	ticketStage?: string;
	lastRun?: string | null;
}

export interface AspectMeta {
	[key: string]: unknown;
}

export interface AspectDetail {
	name: string;
	extends: string;
	meta: AspectMeta;
	body: string;
	raw: string;
	prompt: { source: 'project' | 'default' | 'missing'; content: string };
	ticketTemplate: { source: 'project' | 'default' | 'missing'; content: string };
}

export interface RunTally {
	covered: number;
	gap: number;
	partial: number;
	na: number;
	other: number;
}

export interface RunSummary {
	filename: string;
	aspect: string;
	started?: string;
	finished?: string;
	batch: string[];
	runner?: string;
	tally: RunTally;
}

export interface RunVerdict {
	code: string;
	verdict: string;
	line: string;
}

export interface RunDetail extends RunSummary {
	verdicts: RunVerdict[];
	body: string;
	raw: string;
}

// A single (feature, aspect) cell. Present only when a coverage record exists;
// a missing pair is omitted from the matrix and renders as "missing".
export interface CoverageCell {
	verdict: string;              // covered | gap | partial | n/a | blocked
	freshness: string;           // fresh | criteria-stale | spec-stale | drift-stale | age-stale | missing
	drift?: number;              // commits touching the record's evidence since audit
	unverifiable?: boolean;      // drift couldn't be computed (rebase/squash/shallow)
	audited?: string;            // ISO datetime of the audit
	ticket?: string | null;      // relative path to the gap ticket, when set
	pinned?: boolean;            // human reaffirmation
}

export interface CoverageData {
	features: Array<{ code: string; name: string; path: string; hasFile: boolean }>;
	aspects: AspectSummary[];
	matrix: Record<string, Record<string, CoverageCell>>; // featureCode -> aspectName -> cell
}
