// Type surface for git.mjs (types only; .mjs is the source of truth).

export function gitHead(cwd: string): string | null;

export function commitInHistory(cwd: string, sha: string | null | undefined): boolean;

export function lastShippedRelease(cwd: string): string | null;

export function commitsTouching(
	cwd: string,
	sinceCommit: string | null | undefined,
	globs: string[] | null | undefined,
): { count: number; unverifiable: boolean };

export function globToRegex(glob: string): RegExp;

export function pathMatchesAny(path: string, globs: string[] | null | undefined): boolean;
