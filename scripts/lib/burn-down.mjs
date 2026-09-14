/**
 * The current release's outstanding spec work: the part of the burn-down
 * rubric can derive (agent-rules/principles.md § Current release assumption).
 * Childless features due now that are not implemented, and the coverage cells
 * of features due now that still need an audit or hold an open verdict. The
 * top-level backlog tickets — the rest of the burn-down — are tess's to list.
 */

import { coverageColumns } from './aspects.mjs';
import { aspectApplies } from './features.mjs';
import { isStale } from './freshness.mjs';
import { capabilityRank, featureRank } from './scope.mjs';

const FINISHED = new Set(['implemented', 'retired']);
const OPEN_VERDICTS = new Set(['gap', 'partial', 'blocked']);
const NONE = '—';

/**
 * @param {{ features: object[], aspects: object[], releases: object,
 *   cellOf: (feature: object, aspect: object) => { state: string, verdict: string|null, ticket: string|null } }} input
 *   `features` is the whole walked inventory and `aspects` every active aspect.
 *   `cellOf` gives a pair's coverage cell (`cellFor`, with the record's gap
 *   ticket); it is asked only about a feature due now under an aspect with
 *   verdicts that applies to it.
 * @returns {{ release: string|null,
 *   notImplemented: Array<{ code: string, name: string, status: string|null, capabilities: string[] }>,
 *   aspects: Array<{ name: string, parent: string|null, open: Array<{ code: string, state: string, verdict: string|null, ticket: string|null }> }> }}
 */
export function burnDown({ features, aspects, releases, cellOf }) {
	const due = features.filter(f => featureRank(f, releases) === 0);
	return {
		release: releases.current,
		notImplemented: childless(due, features)
			.filter(f => !FINISHED.has(f.data?.status))
			.map(f => ({
				code: f.code,
				name: f.name,
				status: f.data?.status ?? null,
				capabilities: f.capabilities.filter(cap => capabilityRank(f, cap, releases) === 0).map(cap => cap.text),
			})),
		aspects: coverageColumns(aspects).map(aspect => ({
			name: aspect.name,
			parent: aspect.parent?.name ?? null,
			open: due.filter(f => aspectApplies(aspect, f)).flatMap(f => openCell(f, cellOf(f, aspect))),
		})),
	};
}

/** The candidates no feature in the inventory descends from — the files that store `status`. */
function childless(candidates, inventory) {
	const parents = new Set();
	for (const { code } of inventory) {
		const segments = code.split('-');
		for (let n = 1; n < segments.length; n++) parents.add(segments.slice(0, n).join('-'));
	}
	return candidates.filter(f => !parents.has(f.code));
}

/** A cell that is still work: missing or stale, or holding a verdict that is itself outstanding, however fresh. */
function openCell(feature, { state, verdict, ticket }) {
	if (!isStale(state) && !OPEN_VERDICTS.has(verdict)) return [];
	return [{ code: feature.code, state, verdict: verdict ?? null, ticket: ticket ?? null }];
}

/** The report as text: the features not implemented, each aspect's open cells, then a summary line. */
export function formatBurnDown({ release, notImplemented, aspects }) {
	const lines = [`Not implemented — ${notImplemented.length}`];
	for (const { code, name, status, capabilities } of notImplemented) {
		lines.push(`  ${code} [${status ?? 'no status'}] ${name}`);
		for (const text of capabilities) lines.push(`    - ${text}`);
	}
	for (const { name, parent, open } of aspects) {
		lines.push('', `${parent ? `${parent}/` : ''}${name} — ${open.length} open`);
		const rows = open.map(cell => [cell.code, cell.state, cell.verdict ?? NONE, cell.ticket ?? NONE]);
		for (const row of alignColumns(rows)) lines.push(`  ${row}`);
	}
	const openCount = aspects.reduce((n, aspect) => n + aspect.open.length, 0);
	const scope = release ? `release ${release}` : 'no release list — everything is current';
	lines.push('', `${scope}: ${notImplemented.length} not implemented, ${openCount} open coverage cell(s) across ${aspects.length} aspect(s)`);
	return lines.join('\n');
}

/** Rows joined by two spaces, every column but the last padded to its widest cell. */
function alignColumns(rows) {
	if (rows.length === 0) return [];
	const widths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i].length)));
	return rows.map(row => row.map((cell, i) => (i < row.length - 1 ? cell.padEnd(widths[i]) : cell)).join('  '));
}
