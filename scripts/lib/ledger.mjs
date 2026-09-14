/**
 * Coverage ledger — the durable, git-committed counterpart of the run manifest.
 *
 * One file per aspect, `aspects/<name>/coverage.md`, recording the latest audit
 * verdict for each `(feature, aspect)` pair plus the fingerprints needed to tell
 * whether that verdict is still trustworthy (feature-hash, aspect-hash, the
 * evidence paths, and the commit it was audited at). The runner is its sole
 * writer — it lifts verdicts + evidence from each batch's run log exactly the
 * way it lifts them into the manifest.
 *
 * On-disk form mirrors the manifest: YAML front-matter (machine truth) followed
 * by a regenerated markdown table (human/UI snapshot). The table's freshness /
 * drift columns are a *best-effort* snapshot at write time; the authoritative
 * freshness is always derived at read time (see `freshness.mjs`).
 */

import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveAnnotation } from './aspects.mjs';
import { rewriteFrontmatter } from './feature-text.mjs';
import { ownSurfaces } from './features.mjs';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';
import { dueRank } from './releases.mjs';

export const LEDGER_FILE = 'coverage.md';

/** Absolute path to an aspect's coverage ledger. */
export function ledgerPath(aspectsDir, aspectName) {
	return join(aspectsDir, aspectName, LEDGER_FILE);
}

/**
 * Read an aspect's ledger. Returns `{ aspect, generated, records }` with an
 * empty `records` object if the file is absent (bootstrap — every pair missing).
 */
export async function readLedger(aspectsDir, aspectName) {
	const file = ledgerPath(aspectsDir, aspectName);
	if (!existsSync(file)) return { aspect: aspectName, generated: null, records: {} };
	const { data } = parseFrontmatter(await readFile(file, 'utf-8'));
	return {
		aspect: data.aspect ?? aspectName,
		generated: data.generated ?? null,
		records: (data.records && typeof data.records === 'object') ? data.records : {},
	};
}

/**
 * Write (or rewrite) an aspect's ledger, regenerating the table body. `generated`
 * is stamped to now. `snapshot` optionally maps `code → { freshness, drift }` for
 * the rendered table; anything absent renders as `—`.
 */
export async function writeLedger(aspectsDir, aspectName, ledger, snapshot = {}) {
	const dir = join(aspectsDir, aspectName);
	await mkdir(dir, { recursive: true });
	const data = {
		aspect: aspectName,
		generated: new Date().toISOString(),
		records: ledger.records || {},
	};
	const md = stringifyFrontmatter(data, renderBody(aspectName, data.records, snapshot));
	await writeFile(ledgerPath(aspectsDir, aspectName), md, 'utf-8');
}

/** Insert or replace a record by feature code (mutates + returns the ledger). */
export function upsertRecord(ledger, code, record) {
	ledger.records ||= {};
	ledger.records[code] = record;
	return ledger;
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Top-level keys a feature's fingerprint leaves out: every aspect's settings
 * block (the audited aspect's resolved settings are appended instead), surfaces
 * (only their overlap with the aspect's counts) and the release tag (only which
 * capabilities are in scope counts).
 */
// NOTE: a dropped key's span leaves the blank lines around it, so a settings block added together with a new blank line still changes the other aspects' fingerprints; if audits that write their own aspects.<name> block turn out to add one, also drop the blank lines directly before a dropped key.
const UNFINGERPRINTED_KEYS = new Set(['aspects', 'surfaces', 'target']);

/**
 * The ledger's `feature-hash`: sha256 (first 12 hex) of a feature file as it
 * bears on one aspect's audit — schema.md § Hashes. `feature` is the walked
 * record for the file (`data`, effective `surfaces` and `target`); `releases`
 * is `readReleaseList`'s result.
 */
export function featureFingerprint({ raw, feature, aspect, releases }) {
	const scoped = rewriteFrontmatter(raw, {
		dropKeys: UNFINGERPRINTED_KEYS,
		capability: cap => (capabilityDueWithFeature(feature, cap, releases) ? 'plain' : 'drop'),
	});
	let text = normalize(scoped);
	const annotation = resolveAnnotation(aspect, feature);
	if (Object.keys(annotation).length) text += `\nrubric-annotation: ${JSON.stringify(annotation)}`;
	const audited = ownSurfaces(aspect);
	const shared = audited ? [...new Set(audited.filter(s => feature.surfaces?.includes(s)))].sort() : [];
	if (shared.length) text += `\nrubric-surfaces: ${JSON.stringify(shared)}`;
	return sha12(text);
}

/**
 * Whether a capability is due with its feature: its own tag ranks no later than
 * the feature's effective tag, an unlisted code ranking as current (`dueRank`).
 * A plain capability has no tag of its own, so it always is.
 */
export function capabilityDueWithFeature(feature, cap, releases) {
	return dueRank(releases, cap.target) <= dueRank(releases, feature.target);
}

/**
 * sha256 (first 12 hex) of the resolved aspect config — `aspect.md` concatenated
 * with the effective prompt and ticket-template bodies, each normalized; a
 * child's parent's `aspect.md` comes first. Any change to the audit's
 * instructions invalidates prior verdicts.
 */
export function hashAspectConfig({ parentAspectMdRaw = null, aspectMdRaw, promptBody, ticketTemplateBody }) {
	const parts = [aspectMdRaw, promptBody, ticketTemplateBody];
	if (parentAspectMdRaw != null) parts.unshift(parentAspectMdRaw);
	return sha12(parts.map(x => normalize(x || '')).join('\n'));
}

function sha12(str) {
	return createHash('sha256').update(str, 'utf-8').digest('hex').slice(0, 12);
}

function normalize(str) {
	return String(str).replace(/\r\n?/g, '\n');
}

// ── Rendered body (human / UI snapshot; not parsed back) ─────────────────────

function renderBody(aspectName, records, snapshot) {
	const codes = Object.keys(records);
	const lines = [];
	lines.push('', `# Coverage — ${aspectName}`, '');
	lines.push(`**Records:** ${codes.length}`, '');
	lines.push('| Feature | Verdict | Freshness | Drift | Audited | Ticket |');
	lines.push('| --- | --- | --- | --- | --- | --- |');
	for (const code of codes) {
		const r = records[code] || {};
		const snap = snapshot[code] || {};
		const freshness = snap.freshness ?? '—';
		const drift = snap.drift ?? '—';
		const audited = r.audited ? String(r.audited) : '—';
		const ticket = r.ticket ? String(r.ticket) : '—';
		lines.push(`| ${code} | ${r.verdict ?? '—'} | ${freshness} | ${drift} | ${audited} | ${ticket} |`);
	}
	lines.push('');
	return lines.join('\n');
}
