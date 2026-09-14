/**
 * The release list, read through tess.
 *
 * Rubric does not parse `tickets/releases.md`: tess owns its grammar
 * (`tess/scripts/lib/releases.mjs`). Rubric loads that reader only when the
 * file exists, so a project without tess never needs it. The model is in
 * `agent-rules/principles.md` § Current release assumption.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The release list's path relative to the project root, as messages name it. */
export const RELEASES_FILE = 'tickets/releases.md';
// NOTE: tess's location is fixed at `tess/` under the project root; make it configurable if rubric is ever used with tess installed elsewhere.
const TESS_READER = 'tess/scripts/lib/releases.mjs';

/**
 * @returns {Promise<{ present: boolean, current: string|null, codes: string[], errors: string[], unreadable: boolean }>}
 *   `codes` in list order, the first being current. `unreadable` is true when
 *   the file exists but tess's reader could not be loaded: the codes are then
 *   unknown, and callers must not judge `target:` tags against an empty list.
 */
export async function readReleaseList(repoRoot, { loadReader = importTessReader } = {}) {
	const off = { present: false, current: null, codes: [], errors: [], unreadable: false };
	if (!existsSync(join(repoRoot, RELEASES_FILE))) return off;
	let reader;
	try {
		reader = await loadReader(repoRoot);
	} catch (err) {
		const why = err?.code === 'ERR_MODULE_NOT_FOUND' ? 'was not found' : `could not be loaded (${err?.message ?? err})`;
		return { ...off, present: true, unreadable: true, errors: [`${RELEASES_FILE} exists but tess's reader (${TESS_READER}) ${why}`] };
	}
	const list = await reader.readReleases(join(repoRoot, 'tickets'));
	if (!list.present) return off;
	const codes = list.entries.map(e => e.code);
	return {
		present: true,
		current: codes[0] ?? null,
		codes,
		errors: list.errors.map(e => (e.startsWith(`${RELEASES_FILE}:`) ? e : `${RELEASES_FILE}: ${e}`)),
		unreadable: false,
	};
}

/** The optional cross-submodule load: tess may not be installed at all. */
function importTessReader(repoRoot) {
	return import(pathToFileURL(join(repoRoot, TESS_READER)).href);
}

/** A code's rank: no code or the current code → 0, a later code → its position, an unlisted code → -1. */
export function releaseRank(list, code) {
	return code == null ? 0 : list.codes.indexOf(code);
}
