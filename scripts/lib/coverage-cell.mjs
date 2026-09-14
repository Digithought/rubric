/**
 * One (feature, aspect) coverage cell: the freshness `run.mjs --stale-only`,
 * `coverage.mjs` and the UI all derive from a ledger record, computed in one
 * place so the three cannot disagree. The precedence is `freshness.mjs`'s; this
 * module supplies the current hashes and the drift it compares a record against.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { readPrompt, readTicketTemplate } from './aspects.mjs';
import { computeFreshness } from './freshness.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { commitsTouching } from './git.mjs';
import { featureFingerprint, hashAspectConfig } from './ledger.mjs';

/**
 * The ledger's `aspect-hash` for an aspect as it would be audited now:
 * `aspect.md` — a child's parent's `aspect.md` before its own — with the prompt
 * and ticket template the audit would use, a child's composed from its parent's.
 * This is the only place the aspect hash is composed.
 */
export async function resolveAspectHash(aspect) {
	const readRaw = (path) => readFile(path, 'utf-8').catch(() => '');
	const parentAspectMdRaw = aspect.parent ? await readRaw(aspect.parent.path) : null;
	const aspectMdRaw = await readRaw(aspect.path);
	const promptBody = await readPrompt(aspect).catch(() => '');
	const ticketTemplateBody = await readTicketTemplate(aspect).catch(() => null);
	return hashAspectConfig({ parentAspectMdRaw, aspectMdRaw, promptBody, ticketTemplateBody });
}

/** A feature file's text, or null when it cannot be read. */
export function readFeatureText(path) {
	try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

/**
 * A `readFeatureText` that reads each file once: for one pass over a tree that
 * nothing edits meanwhile, such as building a matrix — never across an audit,
 * which may edit the files.
 */
export function cachedFeatureReader() {
	// NOTE: holds every feature file's text for the pass and re-parses it once per aspect; if the inventory grows large enough for this to show up, cache per file mtime.
	const texts = new Map();
	return (path) => {
		if (!texts.has(path)) texts.set(path, readFeatureText(path));
		return texts.get(path);
	};
}

/**
 * The feature's `feature-hash` for this aspect, from its file as it reads now;
 * null when the file cannot be read. The front-matter is parsed from that same
 * text rather than taken from the walked record, so a record written after an
 * audit edited the file (its own settings block) fingerprints what the audit
 * left, not what the run started from.
 */
export function featureFingerprintFor(feature, aspect, releases, readText = readFeatureText) {
	const raw = readText(feature.path);
	if (raw == null) return null;
	return featureFingerprint({ raw, feature: { ...feature, data: parseFrontmatter(raw).data }, aspect, releases });
}

/**
 * A pair's `{ state, drift, unverifiable, priority, verdict }`. `aspectHash` and
 * `staleness` are the aspect's, resolved once by the caller; `readText` defaults
 * to reading the feature file afresh.
 */
export function cellFor({ feature, aspect, record, aspectHash, staleness, releases, repoRoot, readText }) {
	if (record == null) return { ...computeFreshness(null), verdict: null };
	const featureHash = featureFingerprintFor(feature, aspect, releases, readText);
	const evidence = Array.isArray(record.evidence) ? record.evidence : [];
	const drift = commitsTouching(repoRoot, record['audited-commit'], evidence);
	return { ...computeFreshness(record, { featureHash, aspectHash, staleness, drift }), verdict: record.verdict ?? null };
}
