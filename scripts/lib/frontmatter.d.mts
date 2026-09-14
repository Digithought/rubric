// Type surface for frontmatter.mjs (types only; .mjs is the source of truth).

export interface ParsedFrontmatter {
	data: Record<string, any>;
	body: string;
}

export function readFileFrontmatter(path: string): Promise<ParsedFrontmatter>;

export function parseFrontmatter(raw: string): ParsedFrontmatter;

/** 0-based line span within the file's `lines`. */
export interface FrontmatterSpan {
	line: number;
	end: number;
}

export interface FrontmatterKeySpan extends FrontmatterSpan {
	key: string;
	items: FrontmatterSpan[] | null;
}

export interface FrontmatterScan {
	eol: '\n' | '\r\n';
	lines: string[];
	start: number;
	end: number;
	keys: FrontmatterKeySpan[];
}

export function scanFrontmatter(raw: string): FrontmatterScan | null;

export function readFrontmatterWithLines(path: string): Promise<{
	data: Record<string, any>;
	keyLines: Record<string, number>;
	itemLines: Record<string, number[] | undefined>;
}>;

export function isMapping(value: unknown): value is Record<string, unknown>;

export function parseYaml(text: string): Record<string, any>;

export function stringifyFrontmatter(data: unknown, body?: string): string;

export function stringifyYaml(obj: unknown, indent?: number): string;
