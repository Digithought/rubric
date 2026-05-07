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

export interface CoverageData {
	features: Array<{ code: string; name: string; path: string; hasFile: boolean }>;
	aspects: AspectSummary[];
	matrix: Record<string, Record<string, string>>; // featureCode -> aspectName -> verdict
}
