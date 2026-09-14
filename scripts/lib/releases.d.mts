// Type surface for releases.mjs (types only; .mjs is the source of truth).

export const RELEASES_FILE: string;

export interface ReleaseList {
	present: boolean;
	current: string | null;
	/** In list order; the first is current. */
	codes: string[];
	errors: string[];
	/** The file exists but tess's reader could not be loaded, so the codes are unknown. */
	unreadable: boolean;
}

export function readReleaseList(
	repoRoot: string,
	options?: { loadReader?: (repoRoot: string) => Promise<unknown> },
): Promise<ReleaseList>;

export function releaseRank(list: Pick<ReleaseList, 'codes'>, code: string | null | undefined): number;

export function dueRank(list: Pick<ReleaseList, 'codes'>, code: string | null | undefined): number;
