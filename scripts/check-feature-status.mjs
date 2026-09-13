#!/usr/bin/env node
/**
 * Fail when a feature file stores a `status:` it has no business storing, or
 * omits one nothing can derive.
 *
 * The rule (rubric/schema.md § "`status` is stored only where nothing can
 * derive it"): a feature file carries `status` **iff it has no descendants**.
 * A node with children derives its status from its descendant leaves, so a
 * stored copy is a second home for the same fact — and it drifts
 * optimistically, because the leaf that falsifies it is edited far away and
 * nobody walks up. SiteCAD measured 22 of 51 branches (43%) overclaiming
 * before the rule landed, none understating.
 *
 * Two failure directions, both real:
 *   - a node WITH children carrying `status:`  → duplicated, will drift
 *   - a node WITHOUT children missing `status:` → nothing to derive from
 *
 * The second case is the one that bites on restructure: a childless root that
 * gains its first branch must shed its `status` in the same change, and a
 * branch whose last child is deleted must grow one back.
 *
 * Usage: node rubric/scripts/check-feature-status.mjs [featuresDir]
 * Exits 0 when clean, 1 on any violation.
 */

import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkFeatures } from './lib/features.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

async function main() {
	const featuresDir = resolve(process.argv[2] ?? resolve(REPO_ROOT, 'features'));
	const features = await walkFeatures(featuresDir);

	if (features.length === 0) {
		console.error(`check:feature-status — no features found under ${featuresDir}`);
		process.exit(1);
	}

	// A node has descendants iff some other node's code is prefixed by it.
	const codes = new Set(features.map(f => f.code));
	const hasChildren = (code) => {
		for (const other of codes) if (other.startsWith(`${code}-`)) return true;
		return false;
	};

	// `walkFeatures` derives status for non-leaves, so re-read the file to see
	// what is actually STORED. Deriving and storing must not be confused here:
	// this check is about the bytes on disk.
	const { readFile } = await import('node:fs/promises');
	const stored = new Map();
	for (const f of features) {
		const text = await readFile(f.path, 'utf-8');
		const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
		const m = fm && /^status:[ \t]*(\S+)[ \t]*\r?$/m.exec(fm[1]);
		stored.set(f.code, m ? m[1] : undefined);
	}

	const duplicated = [];
	const missing = [];
	for (const f of features) {
		const has = stored.get(f.code) !== undefined;
		if (hasChildren(f.code)) {
			if (has) duplicated.push(f);
		} else if (!has) {
			missing.push(f);
		}
	}

	const rel = (f) => relative(REPO_ROOT, f.path).replace(/\\/g, '/');

	if (duplicated.length === 0 && missing.length === 0) {
		console.log(`Every feature stores \`status\` exactly where it must (${features.length} features checked).`);
		return;
	}

	if (duplicated.length > 0) {
		console.error(`\n${duplicated.length} feature(s) with children store a \`status:\` that must be derived instead:\n`);
		for (const f of duplicated) {
			console.error(`  ${f.code}  (status: ${stored.get(f.code)})  ${rel(f)}`);
		}
		console.error(`\n  Fix: delete the \`status:\` line. The value is derived from the descendant`);
		console.error(`  leaves, which are its single home. See rubric/schema.md.`);
	}

	if (missing.length > 0) {
		console.error(`\n${missing.length} feature(s) without children are missing \`status:\`, and nothing can derive it:\n`);
		for (const f of missing) {
			console.error(`  ${f.code}  ${rel(f)}`);
		}
		console.error(`\n  Fix: add \`status: implemented | partial | planned | retired\`. A node with no`);
		console.error(`  descendants is a leaf whatever its depth, so it is the home for the fact.`);
	}

	process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
