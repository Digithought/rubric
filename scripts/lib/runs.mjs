/**
 * Run-log helpers — discovery + parsing for the runner and the UI.
 *
 * The agent writes its own run log per the prompt; the runner doesn't write
 * the log directly. This module reads existing logs to extract verdicts.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

// Tolerate optional `code`/**code** markdown wrappers around the feature code.
const VERDICT_RE = /^\s*-\s+[*`]*([A-Za-z0-9-]+)[*`]*\s+—\s+(covered|gap|partial|n\/a|blocked)\b\s*(\(([^)]*)\))?\s*(.*)$/;

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
