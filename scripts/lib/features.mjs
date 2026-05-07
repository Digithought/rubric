/**
 * Feature inventory walker.
 *
 * Walks `features/` and produces a flat list of feature records, each with:
 *   - code:   full hyphenated code (e.g. "SCN-HIER" or "TER-LYR-OPS")
 *   - name:   display name
 *   - path:   absolute path to the .md file
 *   - level:  "root" | "branch" | "leaf"
 *   - data:   parsed front-matter (status, summary, capabilities, related, …)
 *
 * Filename convention is the source of truth for the code: `<CODE> - <Name>.md`
 * for files, `<CODE> - <Name>/` for directories. Branches use the leaf code in
 * their filename; the full hyphenated code is derived from the directory chain.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { readFileFrontmatter } from './frontmatter.mjs';

const FILE_RE = /^([A-Za-z0-9]+)\s+-\s+(.+)\.md$/;
const DIR_RE  = /^([A-Za-z0-9]+)\s+-\s+(.+)$/;

/**
 * Walk the features directory and return a flat list of feature records.
 *
 * @param {string} featuresDir absolute path to features/
 * @returns {Promise<Array<{code:string,name:string,path:string,level:string,data:object}>>}
 */
export async function walkFeatures(featuresDir) {
	const out = [];
	await walkDir(featuresDir, [], out);
	return out;
}

async function walkDir(dir, codeChain, out) {
	let entries;
	try { entries = await readdir(dir, { withFileTypes: true }); }
	catch { return; }
	// Index branch directories by their code so we can mark a sibling .md file
	// (the parent feature file for that code) as a branch rather than a leaf.
	const dirCodes = new Set();
	for (const e of entries) {
		if (e.isDirectory()) {
			const m = e.name.match(DIR_RE);
			if (m) dirCodes.add(m[1]);
		}
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isFile()) {
			const m = e.name.match(FILE_RE);
			if (!m) continue;  // README.md or unrelated
			const segCode = m[1];
			const segName = m[2];
			const fullCode = [...codeChain, segCode].join('-');
			const isRoot = codeChain.length === 0;
			const isBranchParent = dirCodes.has(segCode);
			const level = isRoot ? 'root' : (isBranchParent ? 'branch' : 'leaf');
			let data = {};
			try { ({ data } = await readFileFrontmatter(full)); } catch { /* ignore parse errors */ }
			out.push({ code: fullCode, name: segName, path: full, level, data });
		} else if (e.isDirectory()) {
			const m = e.name.match(DIR_RE);
			if (!m) continue;
			await walkDir(full, [...codeChain, m[1]], out);
		}
	}
}

/**
 * Filter a feature list per an aspect's `level` and `applies-to` config.
 */
export function filterFeatures(features, aspect) {
	const level = aspect.data.level || 'any';
	const applies = aspect.data['applies-to'] || {};
	const include = applies.include || null;
	const exclude = applies.exclude || null;
	return features.filter(f => {
		if (level !== 'any' && f.level !== level) {
			// `branch` audits cover both `root` and intermediate nodes that have children;
			// our walker labels actual roots as `root`, so accept `branch` strictly.
			return false;
		}
		if (include && !codeMatchesAny(f.code, include)) return false;
		if (exclude && codeMatchesAny(f.code, exclude)) return false;
		return true;
	});
}

/** True if `code` matches any of the given prefixes (e.g. "SCN" matches "SCN-HIER-PCK"). */
function codeMatchesAny(code, prefixes) {
	for (const p of prefixes) {
		if (code === p || code.startsWith(p + '-')) return true;
	}
	return false;
}

/** Resolve a feature record by full code. */
export function findFeature(features, code) {
	return features.find(f => f.code === code) ?? null;
}
