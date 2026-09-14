#!/usr/bin/env node
/**
 * Rubric coverage — inspect and hand-tune the coverage ledgers.
 *
 * The runner writes the ledgers (`aspects/<name>/coverage.md`); this tool reads
 * them back, derives freshness against the current files + git history, and
 * offers the two manual overrides the schema defines:
 *
 *   coverage.mjs                       freshness matrix (features × aspects)
 *   coverage.mjs --aspect <name>       restrict to one aspect (a parent: its children)
 *   coverage.mjs --stale               only stale/missing rows
 *   coverage.mjs --json                machine-readable dump
 *   coverage.mjs burn-down [--json]    the current release's outstanding spec work
 *   coverage.mjs pin <CODE> <aspect>   reaffirm a record (suppress drift/age)
 *   coverage.mjs accept <CODE> <aspect>  rehash to current spec/criteria, keep verdict
 *
 * Freshness is derived, never stored — see schema.md and freshness.mjs. A parent
 * aspect with children has no verdicts, so it gets no column; its children
 * stand in its place, labelled `parent/child`.
 */

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aspectLabel, aspectsNamed, coverageColumns, hasVerdicts } from './lib/aspects.mjs';
import { filterFeatures, findFeature } from './lib/features.mjs';
import { exitIfSpecInvalid, loadSpec } from './lib/validate.mjs';
import { readLedger, writeLedger } from './lib/ledger.mjs';
import { cachedFeatureReader, cellFor, featureFingerprintFor, resolveAspectHash } from './lib/coverage-cell.mjs';
import { resolveStaleness, isStale } from './lib/freshness.mjs';
import { burnDown, formatBurnDown } from './lib/burn-down.mjs';
import { featureRank } from './lib/scope.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUBRIC_ROOT = resolve(__dirname, '..');

const HELP = `rubric coverage — inspect + hand-tune the coverage ledgers.

Usage:
  coverage.mjs [--aspect <name>] [--stale] [--json]   freshness matrix
  coverage.mjs burn-down [--json]                     the current release's outstanding work
  coverage.mjs pin <FEATURE_CODE> <aspect>            reaffirm a record
  coverage.mjs accept <FEATURE_CODE> <aspect>         rehash to current spec/criteria

Options:
  --aspect <name>   Restrict the matrix to one active aspect; a parent aspect
                    with children shows its children.
  --stale           Show only rows with a stale or missing cell.
  --json            Emit JSON instead of the text matrix (or burn-down report).
  -h, --help        This message.

burn-down lists, for the current release (the first in tickets/releases.md;
everything, without one): childless features not implemented, then each aspect's
missing, stale, gap, partial or blocked cells for features due now. Top-level
backlog tickets are the rest of the burn-down; tess lists those.
`;

// Single-char freshness symbols for the matrix.
const SYMBOL = {
	missing: '?', 'criteria-stale': 'C', 'spec-stale': 'S',
	'drift-stale': 'D', 'age-stale': 'A', fresh: '.',
};
const NA = ' ';   // aspect does not apply to this feature

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('-h') || argv.includes('--help')) { console.log(HELP); return; }

	const repoRoot = resolve(RUBRIC_ROOT, '..');
	const aspectsDir = join(repoRoot, 'aspects');

	const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;
	if (sub && !['pin', 'accept', 'burn-down'].includes(sub)) { console.error(`Unknown subcommand: ${sub}`); console.error(HELP); process.exit(2); }

	const spec = await loadSpec(repoRoot);
	exitIfSpecInvalid(repoRoot, spec);
	const { aspects: allAspects, features: allFeatures, releases } = spec;

	if (sub === 'burn-down') {
		await printBurnDown(argv.slice(1), { aspectsDir, repoRoot, allAspects, allFeatures, releases });
		return;
	}
	if (sub) {
		await override(sub, argv.slice(1), { aspectsDir, repoRoot, allAspects, allFeatures, releases });
		return;
	}

	// ── Matrix ──
	const opts = { aspect: null, stale: false, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--aspect') opts.aspect = argv[++i];
		else if (a === '--stale') opts.stale = true;
		else if (a === '--json') opts.json = true;
		else { console.error(`Unknown option: ${a}`); console.error(HELP); process.exit(2); }
	}

	const scope = opts.aspect ? allAspects.filter(a => a.name === opts.aspect) : allAspects;
	if (opts.aspect && scope.length === 0) {
		console.error(`Aspect "${opts.aspect}" is not active. Active aspects:`);
		allAspects.forEach(a => console.error(`  ${a.name}`));
		process.exit(1);
	}
	if (scope.length === 0) { console.log('No active aspects.'); return; }
	await warnIgnoredParentLedgers(scope, aspectsDir);

	const aspects = coverageColumns(opts.aspect ? aspectsNamed(allAspects, opts.aspect) : allAspects);
	const matrix = await buildMatrix(aspects, allFeatures, { aspectsDir, repoRoot, releases });
	if (opts.json) { printJson(matrix, opts); return; }
	printMatrix(matrix, opts);
}

/** A parent with children has no verdicts, so records left in its own ledger are never read — say so. */
async function warnIgnoredParentLedgers(aspects, aspectsDir) {
	for (const parent of aspects.filter(a => !hasVerdicts(a))) {
		const { records } = await readLedger(aspectsDir, parent.name);
		if (Object.keys(records).length) {
			console.warn(`aspects/${parent.name}/coverage.md has records but ${parent.name} has children; its verdicts are ignored`);
		}
	}
}

// ── Freshness matrix ─────────────────────────────────────────────────────────

/**
 * For each aspect, in column order: load its ledger, resolve staleness +
 * aspect-hash, and compute a cell (`cellFor`, with the record's gap `ticket`)
 * for every applicable feature. Returns a structure the renderers walk.
 */
async function buildMatrix(aspects, allFeatures, { aspectsDir, repoRoot, releases }) {
	const readText = cachedFeatureReader();
	const columns = [];
	const codeSet = new Set();
	for (const aspect of aspects) {
		const { records } = await readLedger(aspectsDir, aspect.name);
		const staleness = resolveStaleness(aspect.data);
		const aspectHash = await resolveAspectHash(aspect);
		const cells = new Map();   // code → cell
		for (const feature of filterFeatures(allFeatures, aspect)) {
			const record = records[feature.code] ?? null;
			cells.set(feature.code, { ...cellFor({ feature, aspect, record, aspectHash, staleness, releases, repoRoot, readText }), ticket: record?.ticket ?? null });
			codeSet.add(feature.code);
		}
		columns.push({ aspect: aspect.name, label: aspectLabel(aspect), parent: aspect.parent?.name ?? null, cells });
	}
	// Row order: inventory order (walkFeatures order), limited to applicable codes.
	const rows = allFeatures.filter(f => codeSet.has(f.code)).map(f => ({ code: f.code, name: f.name }));
	return { columns, rows };
}

function printMatrix({ columns, rows }, opts) {
	const shown = opts.stale
		? rows.filter(r => columns.some(c => c.cells.has(r.code) && isStale(c.cells.get(r.code).state)))
		: rows;

	// Aspects are indexed; the header carries the index, the legend the names.
	console.log('Aspects: ' + columns.map((c, i) => `[${i + 1}] ${c.label}`).join('  '));
	console.log('Legend:  . fresh  ? missing  S spec-stale  C criteria-stale  D drift-stale  A age-stale   (blank = n/a)');
	console.log('');

	const codeW = Math.max(8, ...shown.map(r => r.code.length));
	const header = 'Feature'.padEnd(codeW) + '  ' + columns.map((_, i) => String(i + 1).padStart(2)).join(' ');
	console.log(header);
	for (const r of shown) {
		const cellStr = columns.map(c => {
			const cell = c.cells.get(r.code);
			const s = cell ? (SYMBOL[cell.state] ?? '?') : NA;
			return s.padStart(2);
		}).join(' ');
		console.log(r.code.padEnd(codeW) + '  ' + cellStr);
	}

	// Summary tally over applicable cells.
	const tally = {};
	for (const c of columns) for (const cell of c.cells.values()) tally[cell.state] = (tally[cell.state] || 0) + 1;
	const total = Object.values(tally).reduce((n, x) => n + x, 0);
	const stale = Object.entries(tally).filter(([s]) => s !== 'fresh').reduce((n, [, x]) => n + x, 0);
	console.log('');
	console.log(`${total} pair(s): ` + Object.entries(tally).map(([s, n]) => `${n} ${s}`).join(', ')
		+ (total ? `  →  ${stale} stale/missing, ${tally.fresh || 0} fresh` : ''));
	if (opts.stale && shown.length === 0) console.log('Nothing stale — all applicable pairs are fresh.');
}

function printJson({ columns, rows }, opts) {
	const out = {
		aspects: columns.map(c => ({ name: c.aspect, parent: c.parent })),
		features: [],
		tally: {},
	};
	for (const r of rows) {
		const cells = {};
		let anyStale = false;
		for (const c of columns) {
			if (!c.cells.has(r.code)) continue;
			const cell = c.cells.get(r.code);
			cells[c.aspect] = { state: cell.state, drift: cell.drift, unverifiable: cell.unverifiable, verdict: cell.verdict };
			out.tally[cell.state] = (out.tally[cell.state] || 0) + 1;
			if (isStale(cell.state)) anyStale = true;
		}
		if (opts.stale && !anyStale) continue;
		out.features.push({ code: r.code, name: r.name, cells });
	}
	console.log(JSON.stringify(out, null, 2));
}

// ── Burn-down ────────────────────────────────────────────────────────────────

/**
 * The current release's outstanding spec work (`lib/burn-down.mjs`), as text or
 * `--json`. Cells are computed only for features due now, the only ones the
 * report weighs, so deferred features cost no git calls.
 */
async function printBurnDown(args, { aspectsDir, repoRoot, allAspects, allFeatures, releases }) {
	const unknown = args.find(a => a !== '--json');
	if (unknown) { console.error(`Unknown option: ${unknown}`); console.error(HELP); process.exit(2); }
	const due = allFeatures.filter(f => featureRank(f, releases) === 0);
	const { columns } = await buildMatrix(coverageColumns(allAspects), due, { aspectsDir, repoRoot, releases });
	const cells = new Map(columns.map(c => [c.aspect, c.cells]));
	const report = burnDown({ features: allFeatures, aspects: allAspects, releases, cellOf: (feature, aspect) => cells.get(aspect.name).get(feature.code) });
	console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatBurnDown(report));
}

// ── Manual overrides: pin / accept ───────────────────────────────────────────

async function override(kind, args, { aspectsDir, allAspects, allFeatures, releases }) {
	const [code, aspectName] = args;
	if (!code || !aspectName) {
		console.error(`Usage: coverage.mjs ${kind} <FEATURE_CODE> <aspect>`);
		process.exit(2);
	}
	const ledger = await readLedger(aspectsDir, aspectName);
	const record = ledger.records[code];
	if (!record) {
		console.error(`No ledger record for ${code} in aspect "${aspectName}". Nothing to ${kind}.`);
		process.exit(1);
	}

	if (kind === 'pin') {
		record.pinned = true;
		await writeLedger(aspectsDir, aspectName, ledger);
		console.log(`Pinned ${code} @ ${aspectName} (verdict ${record.verdict}). Drift/age staleness suppressed until a hash changes.`);
		return;
	}

	// accept — rehash to current feature + aspect, clearing spec/criteria-staleness.
	const aspect = allAspects.find(a => a.name === aspectName);
	if (!aspect) { console.error(`Aspect "${aspectName}" is not active — cannot recompute its hash.`); process.exit(1); }
	const feat = findFeature(allFeatures, code);
	if (!feat) { console.error(`Feature "${code}" is not in the inventory — cannot recompute its hash.`); process.exit(1); }
	const featureHash = featureFingerprintFor(feat, aspect, releases);
	if (featureHash == null) { console.error(`Cannot read ${feat.path} — cannot recompute its hash.`); process.exit(1); }

	record['feature-hash'] = featureHash;
	record['aspect-hash'] = await resolveAspectHash(aspect);
	await writeLedger(aspectsDir, aspectName, ledger);
	console.log(`Accepted ${code} @ ${aspectName} (verdict ${record.verdict}). Rehashed to current spec + criteria; drift unchanged.`);
}

main().catch(err => {
	console.error('rubric coverage failed:', err);
	process.exit(1);
});
