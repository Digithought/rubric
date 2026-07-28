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
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';

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

/** sha256 (first 12 hex) of a feature file, with CRLF/CR normalized to \n. */
export function hashFeatureFile(absPath) {
	return sha12(normalize(readFileSync(absPath, 'utf-8')));
}

/**
 * sha256 (first 12 hex) of the resolved aspect config — `aspect.md` concatenated
 * with the effective prompt and ticket-template bodies, each normalized. Any
 * change to the audit's instructions invalidates prior verdicts.
 */
export function hashAspectConfig({ aspectMdRaw, promptBody, ticketTemplateBody }) {
	const combined = [aspectMdRaw, promptBody, ticketTemplateBody]
		.map(x => normalize(x || ''))
		.join('\n');
	return sha12(combined);
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
