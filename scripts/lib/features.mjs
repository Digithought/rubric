/**
 * Feature inventory walker.
 *
 * Walks `features/` and produces a flat list of feature records, each with:
 *   - code:   full hyphenated code (e.g. "SCN-HIER" or "TER-LYR-OPS")
 *   - name:   display name
 *   - path:   absolute path to the .md file
 *   - level:  "root" | "branch" | "leaf"
 *   - data:   parsed front-matter (status, summary, capabilities, related, …)
 *   - keyLines: 1-based line of each top-level front-matter key
 *   - surfaces, target: effective values — own, else the nearest ancestor's, else null
 *   - capabilities: `[{ text, target, line }]`, both capability forms normalised
 *
 * Filename convention is the source of truth for the code: `<CODE> - <Name>.md`
 * for files, `<CODE> - <Name>/` for directories. Branches use the leaf code in
 * their filename; the full hyphenated code is derived from the directory chain.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isMapping, readFrontmatterWithLines } from './frontmatter.mjs';

const FILE_RE = /^([A-Za-z0-9]+)\s+-\s+(.+)\.md$/;
const DIR_RE  = /^([A-Za-z0-9]+)\s+-\s+(.+)$/;

/**
 * Walk the features directory and return a flat list of feature records.
 *
 * @param {string} featuresDir absolute path to features/
 * @returns {Promise<Array<{
 *   code:string, name:string, path:string, level:string, data:object,
 *   keyLines:Record<string,number>,
 *   surfaces:string[]|null, target:string|null,
 *   capabilities:Array<{text:string|null, target:string|null, line:number|null}>,
 * }>>}
 */
export async function walkFeatures(featuresDir) {
	const out = [];
	await walkDir(featuresDir, [], out);
	deriveNonLeafStatus(out);
	deriveInherited(out);
	return out;
}

/**
 * Fill in `data.status` for every root/branch node from its descendant leaves.
 *
 * `status` is a leaf-only stored field (see `schema.md` § "`status` is a
 * leaf-only field"): a branch's status is a pure function of its leaves, so
 * storing a copy is a second home that drifts — and drifts optimistically,
 * because the leaf that falsifies it is edited far from the branch file.
 *
 * Deriving it here means every consumer — `aspectApplies`' retired-drop
 * below, the UI badge, any reporting — keeps seeing a status on non-leaves
 * without one being written down. A non-leaf that still carries a stored
 * status is left alone rather than overwritten: this walker reports the
 * inventory, it does not police it, and silently replacing a value would hide
 * the very drift the rule is about.
 */
function deriveNonLeafStatus(features) {
	const leaves = features.filter(f => f.level === 'leaf');
	for (const node of features) {
		if (node.level === 'leaf') continue;
		if (node.data?.status !== undefined) continue;  // stored value wins; see above
		const prefix = `${node.code}-`;
		const kids = leaves.filter(l => l.code.startsWith(prefix)).map(l => l.data?.status);
		if (kids.length === 0) continue;
		const live = kids.filter(s => s !== 'retired');
		let derived;
		if (live.length === 0) derived = 'retired';
		else if (live.every(s => s === 'implemented')) derived = 'implemented';
		else if (live.every(s => s === 'planned')) derived = 'planned';
		else derived = 'partial';
		node.data = { ...(node.data ?? {}), status: derived };
	}
}

/**
 * Fill in each record's effective `surfaces` and `target` from the nearest
 * declaration up the tree, so a subtree that exists on one surface, or is
 * deferred as a whole, says so once at its top node (schema.md § Feature
 * front-matter).
 */
function deriveInherited(features) {
	const byCode = new Map(features.map(f => [f.code, f]));
	for (const f of features) {
		f.surfaces = nearestDeclared(f, byCode, ownSurfaces);
		f.target = nearestDeclared(f, byCode, ownTarget);
	}
}

/** The first non-null `own(node)` from the feature itself up through its ancestors' files. */
function nearestDeclared(feature, byCode, own) {
	const segments = feature.code.split('-');
	for (let n = segments.length; n > 0; n--) {
		const node = byCode.get(segments.slice(0, n).join('-'));
		const value = node ? own(node) : null;
		if (value != null) return value;
	}
	return null;
}

/** A feature's or aspect's own `surfaces:` as a list, or null when it declares none. */
export function ownSurfaces(record) {
	const value = record.data?.surfaces;
	if (value == null) return null;
	return Array.isArray(value) ? value : [value];
}

/** A feature's own `target:`, or null when it declares none. */
export function ownTarget(feature) {
	return feature.data?.target ?? null;
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
			let located = { data: {}, keyLines: {}, itemLines: {} };
			try { located = await readFrontmatterWithLines(full); } catch { /* unreadable: an empty record */ }
			out.push({
				code: fullCode,
				name: segName,
				path: full,
				level,
				data: located.data,
				keyLines: located.keyLines,
				surfaces: null,
				target: null,
				capabilities: normaliseCapabilities(located.data.capabilities, located.itemLines.capabilities, located.keyLines.capabilities),
			});
		} else if (e.isDirectory()) {
			const m = e.name.match(DIR_RE);
			if (!m) continue;
			await walkDir(full, [...codeChain, m[1]], out);
		}
	}
}

/**
 * Both capability forms as `{ text, target, line }`, one per list item. A
 * plain string is due with its feature (`target: null`); a `{ text, target }`
 * item carries its own tag — the effective tag is `cap.target ?? feature.target`.
 * An item of any other shape keeps its place with whatever it has (`text: null`
 * when none); validateSpec reports it.
 */
function normaliseCapabilities(value, itemLines, keyLine) {
	if (!Array.isArray(value)) return [];
	return value.map((item, i) => normaliseCapability(item, itemLines?.[i] ?? keyLine ?? null));
}

/** One parsed capability item as `{ text, target, line }`; see `normaliseCapabilities`. */
export function normaliseCapability(item, line) {
	if (isMapping(item)) {
		return { text: typeof item.text === 'string' ? item.text : null, target: item.target ?? null, line };
	}
	return { text: typeof item === 'string' ? item : null, target: null, line };
}

/**
 * The surface vocabulary from `features/README.md` front-matter, as
 * `{ path, line, value }` with `value` as parsed (validateSpec checks its
 * shape), or null when the file or its `surfaces:` key is absent.
 */
export async function readSurfaceVocabulary(featuresDir) {
	const path = join(featuresDir, 'README.md');
	let located;
	try { located = await readFrontmatterWithLines(path); } catch { return null; }
	if (!Object.hasOwn(located.data, 'surfaces')) return null;
	return { path, line: located.keyLines.surfaces, value: located.data.surfaces };
}

/**
 * Whether an aspect audits a feature: its `level`, `applies-to` and `surfaces`
 * must all admit it, and for a child its parent's must too — so whatever a
 * child leaves out, it inherits. An aspect with `surfaces:` applies only to
 * features whose effective surfaces intersect them; a feature with none is
 * excluded.
 *
 * Retired features are dropped unconditionally, the mirror of the
 * `status === 'retired'` skip in `aspects.mjs`. A retired feature's
 * implementation was deliberately removed, so every aspect audit finds it
 * missing and files a gap ticket for work nobody wants — that happened to
 * DTI-RMD, whose code was deleted on purpose in `d2d2a225b`.
 */
export function aspectApplies(aspect, feature) {
	if (feature.data?.status === 'retired') return false;
	if (aspect.parent && !admits(aspect.parent, feature)) return false;
	return admits(aspect, feature);
}

/** Whether an aspect's own `level`, `applies-to` and `surfaces` admit the feature. */
function admits(aspect, feature) {
	const level = aspect.data.level || 'any';
	// `branch` audits cover both `root` and intermediate nodes that have children;
	// our walker labels actual roots as `root`, so accept `branch` strictly.
	if (level !== 'any' && feature.level !== level) return false;
	const applies = aspect.data['applies-to'] || {};
	if (applies.include && !codeMatchesAny(feature.code, applies.include)) return false;
	if (applies.exclude && codeMatchesAny(feature.code, applies.exclude)) return false;
	const surfaces = ownSurfaces(aspect);
	if (surfaces && !surfaces.some(s => feature.surfaces?.includes(s))) return false;
	return true;
}

/** The features an aspect audits; see `aspectApplies`. */
export function filterFeatures(features, aspect) {
	return features.filter(f => aspectApplies(aspect, f));
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
