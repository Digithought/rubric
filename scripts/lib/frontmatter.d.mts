// Type surface for frontmatter.mjs (types only; .mjs is the source of truth).

export interface ParsedFrontmatter {
	data: Record<string, any>;
	body: string;
}

export function readFileFrontmatter(path: string): Promise<ParsedFrontmatter>;

export function parseFrontmatter(raw: string): ParsedFrontmatter;

export function parseYaml(text: string): Record<string, any>;

export function stringifyFrontmatter(data: unknown, body?: string): string;

export function stringifyYaml(obj: unknown, indent?: number): string;
