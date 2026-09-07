/**
 * Run-log helpers — discovery + parsing for the runner and the UI.
 *
 * The agent writes its own run log per the prompt; the runner doesn't write
 * the log directly. This module reads existing logs to extract verdicts.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

// Tolerate optional `code`/**code** markdown wrappers around BOTH the feature code
// and the verdict word. Agents emphasise whichever half they think carries the
// news — `CODE` — **covered** and **CODE — covered** are both common, and both are
// valid markdown for the format the prompt asks for. Matching emphasis on the code
// but not the verdict silently dropped every line of the first shape: 18 of one
// 38-feature run's verdicts never reached the ledger, including a `gap` on a
// regression, and nothing reported a parse failure.
const VERDICT_RE = /^\s*-\s+[*`]*([A-Za-z0-9-]+)[*`]*\s*—\s*[*`]*(covered|gap|partial|n\/a|blocked)\b[*`.,]*\s*(\(([^)]*)\))?\s*(.*)$/i;
// Evidence bullet: `- CODE: p1, p2` or `- CODE: (none)`.
const EVIDENCE_RE = /^\s*-\s+[*`]*([A-Za-z0-9-]+)[*`]*\s*:\s*(.*)$/;

/** List run-log files, newest first. */
export async function listRuns(runsDir) {
	let entries;
	try { entries = await readdir(runsDir); } catch { return []; }
	return entries
		.filter(f => f.endsWith('.md') && f !== 'README.md')
		.sort((a, b) => b.localeCompare(a))
		.map(f => join(runsDir, f));
}

/** Parse a single run log into a structured record. */
export async function readRun(path) {
	const raw = await readFile(path, 'utf-8');
	const { data, body } = parseFrontmatter(raw);
	const verdicts = parseVerdicts(body);
	return {
		path,
		file: basename(path),
		aspect: data.aspect ?? null,
		runner: data.runner ?? null,
		started: data.started ?? null,
		finished: data.finished ?? null,
		batch: data.batch ?? [],
		blockers: data.blockers ?? [],
		verdicts,
		verdictCounts: countVerdicts(verdicts),
		evidence: parseEvidence(body),
		body,
	};
}

/** Tally a verdict list into manifest-shaped counts. */
export function countVerdicts(verdicts) {
	const counts = { covered: 0, gap: 0, partial: 0, na: 0, blocked: 0 };
	for (const v of verdicts) {
		const key = v.verdict === 'n/a' ? 'na' : v.verdict;
		if (key in counts) counts[key]++;
	}
	return counts;
}

function parseVerdicts(body) {
	// Find the "## Verdicts" section then read until the next heading.
	const lines = body.split(/\r?\n/);
	const out = [];
	let inSection = false;
	for (const line of lines) {
		if (/^##\s+verdicts\b/i.test(line)) { inSection = true; continue; }
		if (inSection && /^##\s+/.test(line)) break;
		if (!inSection) continue;
		const m = line.match(VERDICT_RE);
		if (!m) continue;
		out.push({
			code: m[1],
			verdict: m[2].toLowerCase().replace('n/a', 'n/a'),
			note: (m[4] || m[5] || '').trim(),
		});
	}
	return out;
}

/**
 * Reduce one comma-separated evidence entry to a bare repo-relative path.
 *
 * Agents write evidence as prose-flavoured markdown — paths in backticks, the last
 * one often trailed by a clause ("…; driven at http://localhost:3002/account/data")
 * and a full stop. Those decorations reach `commitsTouching` as glob source, where
 * they compile to a regex that matches no real filename, so the record silently
 * never goes drift-stale. Strip them here rather than demanding perfect formatting
 * from every audit agent.
 *
 * Returns '' for an entry that isn't a path, so the caller can drop it.
 */
function normalizeEvidencePath(entry) {
	let s = String(entry)
		.replace(/[`*]/g, '')      // markdown code / emphasis wrappers
		.split(';')[0]             // trailing "; driven at …" clause
		.trim()
		.replace(/[.,]+$/, '')     // sentence-final punctuation
		.trim();
	// A bare URL or a parenthetical aside is commentary, not a path.
	if (!s || /^https?:\/\//i.test(s) || s.startsWith('(')) return '';
	// Markdown link → its target: [text](path)
	const link = s.match(/^\[[^\]]*\]\(([^)]+)\)$/);
	if (link) s = link[1].trim();
	return s;
}

/**
 * Parse the `## Evidence` section into a `{ CODE: string[] }` map — the paths the
 * audit inspected, feeding drift-based staleness. `(none)` (or an empty list) →
 * `[]`, meaning the record can never go drift-stale.
 *
 * A bullet's path list may wrap across lines — agents routinely do this, because a
 * realistic evidence list is several long repo paths and does not fit on one line.
 * Continuation lines (indented, not themselves a new `- CODE:` bullet) are folded
 * into the bullet above. Reading only the first line silently truncated most
 * records down to the feature .md, which left them unable to ever go drift-stale —
 * exactly the pairs whose source code was churning.
 */
function parseEvidence(body) {
	const lines = body.split(/\r?\n/);
	const out = {};
	let inSection = false;
	let current = null;   // code of the bullet being accumulated
	let buf = '';         // its raw path-list text, continuation lines appended

	/** Split an accumulated path list and store it under `code`. */
	function flush() {
		if (current == null) return;
		const rest = buf.trim();
		out[current] = (rest === '' || /^\(none\)$/i.test(rest))
			? []
			: rest.split(',').map(normalizeEvidencePath).filter(Boolean);
		current = null;
		buf = '';
	}

	for (const line of lines) {
		if (/^##\s+evidence\b/i.test(line)) { inSection = true; continue; }
		if (inSection && /^##\s+/.test(line)) break;
		if (!inSection) continue;

		const m = line.match(EVIDENCE_RE);
		if (m) {
			flush();
			current = m[1];
			buf = m[2];
			continue;
		}
		// Not a new bullet. An indented, non-blank line continues the one above;
		// a blank line or an unindented line ends it.
		if (current != null && /^\s+\S/.test(line)) {
			buf += ' ' + line.trim();
			continue;
		}
		flush();
	}
	flush();
	return out;
}
