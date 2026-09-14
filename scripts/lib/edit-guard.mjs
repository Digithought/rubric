/**
 * The post-batch guard's comparison (agent-rules/runner.md § Post-batch guard).
 * The one edit an audit may make to its batch's feature files is its own
 * aspect's settings block, `aspects.<name>`; the rest of each file must read the
 * same after the audit as before.
 */

import { readFeatureText } from './coverage-cell.mjs';
import { isMapping, parseFrontmatter } from './frontmatter.mjs';

/**
 * A feature file's content outside `aspects.<aspectName>`, as a string that
 * compares equal across an edit exactly when nothing else changed: the parsed
 * front-matter with that block left out (and `aspects:` too once nothing else
 * is in it), then the body with line endings normalised. Null for a missing
 * file.
 */
// NOTE: compares parsed front-matter, so reformatting outside the block (quoting, comments, blank lines) goes unreported though it changes the other aspects' fingerprints; if audits turn out to reformat, compare the text with the block's lines removed instead.
export function contentOutsideBlock(raw, aspectName) {
	if (raw == null) return null;
	const { data, body } = parseFrontmatter(raw);
	const rest = { ...data };
	if (isMapping(rest.aspects)) {
		const others = Object.entries(rest.aspects).filter(([name]) => name !== aspectName);
		if (others.length) rest.aspects = Object.fromEntries(others);
		else delete rest.aspects;
	}
	return JSON.stringify([rest, body.replace(/\r\n?/g, '\n')]);
}

/** `contentOutsideBlock` of each feature's file as it reads now, by code — taken before dispatch. */
export function snapshotBatch(features, aspectName, readText = readFeatureText) {
	return new Map(features.map(f => [f.code, contentOutsideBlock(readText(f.path), aspectName)]));
}

/** Codes of the batch's features whose content outside `aspects.<aspectName>` no longer matches `snapshot`. */
export function editedOutsideBlock(snapshot, features, aspectName, readText = readFeatureText) {
	return features
		.filter(f => contentOutsideBlock(readText(f.path), aspectName) !== snapshot.get(f.code))
		.map(f => f.code);
}
