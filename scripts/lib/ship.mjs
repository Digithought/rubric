/**
 * Shipping a release — rubric's half: `tess/scripts/release.mjs ship` strips
 * its own board (tickets); this strips `target:` tags naming the shipped code
 * from the feature inventory. See `coverage.mjs` `ship` and
 * `agent-rules/principles.md` § Current release assumption.
 *
 * `planShip` only reads the already-walked inventory (`loadSpec`'s
 * `features`), so planning never touches disk. `applyShip` reads and rewrites
 * each edited file's raw text through `rewriteFrontmatter`, which keeps every
 * byte outside the stripped key or capability item — body, comments, other
 * codes' tags, line endings — exactly as written.
 */

import { readFile, writeFile } from 'node:fs/promises';

import { rewriteFrontmatter } from './feature-text.mjs';
import { RELEASES_FILE } from './releases.mjs';

/**
 * Whether `code` can be shipped from the feature inventory right now: null
 * when yes, else the refusal message. `releases` is `readReleaseList`'s
 * result for the project.
 */
export function shipGuard(releases, code) {
	if (!releases.present) return `${RELEASES_FILE} does not exist — nothing was shipped through tess`;
	if (releases.unreadable) return releases.errors.join('\n');
	if (releases.codes.includes(code)) return `${code} is still in ${RELEASES_FILE} — run node tess/scripts/release.mjs ship first`;
	return null;
}

/**
 * Plan stripping `code`'s `target:` tags from every feature file that carries
 * one — a top-level tag equal to `code`, a capability tag equal to `code`, or
 * both.
 *
 * @param {{ features: Array, code: string }} args  `features` is `loadSpec`'s walked inventory.
 * @returns {{ edits: Array<{ path: string, featureTarget: boolean, capabilities: number }> }}
 */
export function planShip({ features, code }) {
	const edits = [];
	for (const feature of features) {
		const featureTarget = feature.data.target === code;
		const capabilities = feature.capabilities.filter(cap => cap.target === code).length;
		if (featureTarget || capabilities > 0) edits.push({ path: feature.path, featureTarget, capabilities });
	}
	return { edits };
}

/** Carry out a plan from `planShip`: rewrite each edited file's `target: <code>` tags away in place. */
export async function applyShip(plan, code) {
	for (const edit of plan.edits) {
		const raw = await readFile(edit.path, 'utf-8');
		const out = rewriteFrontmatter(raw, {
			dropKeys: edit.featureTarget ? new Set(['target']) : new Set(),
			capability: cap => (cap.target === code ? 'plain' : 'keep'),
		});
		if (out !== raw) await writeFile(edit.path, out, 'utf-8');
	}
}
