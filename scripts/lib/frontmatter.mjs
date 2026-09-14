/**
 * Minimal YAML front-matter parser + serializer.
 *
 * Handles the subset rubric front-matter actually uses:
 *   - top-level scalar fields (string / number / boolean)
 *   - block scalars with `|` (multi-line strings preserved verbatim)
 *   - inline arrays `[a, b, c]` and block-list arrays (`- x` lines)
 *   - inline flow-maps `{ covered: 2, gap: 0 }`
 *   - block-mapping nested objects (e.g. applies-to.include)
 *   - block-list of mappings (arrays of objects, e.g. the run manifest's
 *     `tasks:` and `blockers:`)
 *   - bare ISO timestamps and codes left as strings
 *
 * `stringifyYaml` / `stringifyFrontmatter` are the symmetric inverse: they
 * round-trip the same subset so the runner can rewrite a manifest it parsed.
 *
 * It is **not** a general YAML parser. If a feature or aspect file uses
 * something exotic, extend this parser deliberately rather than reaching for
 * a heavy dependency — the schema is intentionally narrow.
 */

import { readFile } from 'node:fs/promises';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Read a markdown file and return { data, body }. data is `{}` if no front-matter. */
export async function readFileFrontmatter(path) {
	const raw = await readFile(path, 'utf-8');
	return parseFrontmatter(raw);
}

/** Parse a markdown string into { data, body }. */
export function parseFrontmatter(raw) {
	const m = raw.match(FRONT_MATTER_RE);
	if (!m) return { data: {}, body: raw };
	const data = parseYaml(m[1]);
	return { data, body: m[2] ?? '' };
}

/**
 * Read a markdown file's front-matter with source positions: `data` as
 * `parseFrontmatter` gives it, `keyLines` mapping each top-level key to its
 * 1-based line, and `itemLines` mapping each block-list key to its items'
 * 1-based lines (in `data` order).
 */
export async function readFrontmatterWithLines(path) {
	const raw = await readFile(path, 'utf-8');
	const keyLines = {};
	const itemLines = {};
	for (const span of scanFrontmatter(raw)?.keys ?? []) {
		keyLines[span.key] = span.line + 1;
		itemLines[span.key] = span.items?.map(item => item.line + 1);
	}
	return { data: parseFrontmatter(raw).data, keyLines, itemLines };
}

/** A parsed YAML mapping: a plain object, not a list or null. */
export function isMapping(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Locate a markdown string's front-matter, line by line, without parsing values.
 *
 * Returns null when `parseFrontmatter` would find no front-matter. Otherwise:
 *   - `lines`: the whole file split on line endings; `eol`: the ending the
 *     opening fence uses, so a rewrite can keep it;
 *   - `start` / `end`: 0-based first and last content line between the fences;
 *   - `keys`: one span per top-level key, in file order. `end` is the last line
 *     the key owns (indented, blank and comment lines; trailing blank lines
 *     excluded). `items` is set for a block list: one span per dash at the
 *     list's own indent, ending on the item's last value line. An item's
 *     `keys` holds one `{ key, line, end }` per key when the item is a mapping
 *     (`- text: …`), else null.
 *
 * Spans come from the same segmentation `parseYaml` uses, so a key or item here
 * is exactly what the parser read as one.
 */
export function scanFrontmatter(raw) {
	const m = raw.match(FRONT_MATTER_RE);
	if (!m) return null;
	const lines = raw.split(/\r?\n/);
	const start = 1;
	const end = start + m[1].split(/\r?\n/).length - 1;
	const keys = scanEntries(lines, start, end).map(entry => {
		const children = entry.kind === 'nested' ? entry.body.map(j => lines[j]) : [];
		const items = children.length && isBlockList(children)
			? splitListItems(children).map(group => scanListItem(lines, group.map(k => entry.body[k])))
			: null;
		let last = entry.last;
		while (last > entry.line && isBlank(lines[last])) last--;
		return { key: entry.key, line: entry.line, end: last, items };
	});
	return { eol: raw.startsWith('---\r\n') ? '\r\n' : '\n', lines, start, end, keys };
}

/** Parse the YAML subset rubric uses. Returns a plain object. */
export function parseYaml(text) {
	const lines = text.split(/\r?\n/);
	const result = {};
	for (const entry of scanEntries(lines, 0, lines.length - 1)) {
		result[entry.key] = entryValue(lines, entry);
	}
	return result;
}

const KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const BLOCK_SCALAR_RE = /^[|>][-+]?$/;

const indentOf = (line) => line.match(/^\s*/)[0].length;
const isBlank = (line) => line.trim() === '';
const isComment = (line) => line.trim().startsWith('#');

/**
 * Split `lines[from..to]` into top-level entries — the one home of the rules
 * deciding which lines belong to which key:
 *   - between entries, blank, comment, indented and non-`key:` lines are skipped;
 *   - `key: |` or `key: >` owns following blank lines and lines indented at
 *     least as deep as its first non-blank line; a column-0 line always ends it;
 *   - `key:` with nothing after owns every following blank, comment or
 *     indented line, up to the next column-0 line that is not a comment;
 *   - anything else is a one-line scalar.
 *
 * `last` is the last owned line. `body` lists the lines holding the value:
 * every owned line of a block scalar, or the indented non-comment lines of a
 * nested list or mapping.
 */
function scanEntries(lines, from, to) {
	const entries = [];
	let i = from;
	while (i <= to) {
		const line = lines[i];
		const m = !isBlank(line) && !isComment(line) && indentOf(line) === 0 && line.match(KEY_RE);
		if (!m) { i++; continue; }
		const entry = { key: m[1], rest: m[2], kind: 'scalar', line: i, last: i, body: [], blockIndent: null };
		i++;
		if (BLOCK_SCALAR_RE.test(entry.rest)) {
			entry.kind = 'block';
			for (; i <= to; i++) {
				const l = lines[i];
				if (!isBlank(l)) {
					const ind = indentOf(l);
					entry.blockIndent ??= ind;
					if (ind < entry.blockIndent || ind === 0) break;
				}
				entry.body.push(i);
				entry.last = i;
			}
		} else if (entry.rest === '') {
			entry.kind = 'nested';
			for (; i <= to; i++) {
				const l = lines[i];
				if (!isBlank(l) && !isComment(l)) {
					if (indentOf(l) === 0) break;
					entry.body.push(i);
				}
				entry.last = i;
			}
		}
		entries.push(entry);
	}
	return entries;
}

function entryValue(lines, entry) {
	if (entry.kind === 'scalar') return parseScalar(entry.rest);
	if (entry.kind === 'nested') return parseChild(entry.body.map(j => lines[j]));
	// Block scalar. `|` keeps line breaks verbatim; `>` folds them (single
	// breaks become spaces, blank lines become paragraph breaks). Agents write
	// both styles, and taking a bare `>-` header as the literal value silently
	// destroyed the field.
	const collected = entry.body.map(j => (isBlank(lines[j]) ? '' : lines[j].slice(entry.blockIndent)));
	return (entry.rest[0] === '>' ? foldBlock(collected) : collected.join('\n')).replace(/\s+$/, '');
}

/**
 * Fold a `>` block scalar: runs of non-empty lines join with a single space,
 * a blank line becomes a paragraph break. Close enough to YAML's folded style
 * for the prose fields rubric uses (summary, detect, resolution-hint).
 */
function foldBlock(lines) {
	const out = [];
	let para = [];
	const flush = () => { if (para.length) { out.push(para.join(' ')); para = []; } };
	for (const l of lines) {
		if (l.trim() === '') { flush(); out.push(''); continue; }
		para.push(l.trim());
	}
	flush();
	return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function parseChild(lines) {
	if (lines.length === 0) return null;
	if (isBlockList(lines)) return parseBlockList(lines);
	// Block mapping: re-indent and recurse.
	const minIndent = Math.min(...lines.map(indentOf));
	const dedented = lines.map(l => l.slice(minIndent)).join('\n');
	return parseYaml(dedented);
}

/** Indented child lines are a block list, not a block mapping, when the first one is a dash item. */
function isBlockList(childLines) {
	const trimmed = childLines[0].trim();
	return trimmed.startsWith('- ') || trimmed === '-';
}

/**
 * Group block-list lines into items, as arrays of indexes into `lines`: every
 * dash at the first line's indent starts an item, and the lines after it
 * continue that item.
 */
function splitListItems(lines) {
	const dashIndent = indentOf(lines[0]);
	const groups = [];
	lines.forEach((l, k) => {
		if (indentOf(l) === dashIndent && /^-(\s|$)/.test(l.trim())) groups.push([k]);
		else if (groups.length) groups.at(-1).push(k);
	});
	return groups;
}

/**
 * A block-list item's span, from its value lines as indexes into `lines`: the
 * first and last value line, and for a mapping item one `{ key, line, end }` per
 * key, segmented from the same block `parseBlockList` parses.
 */
function scanListItem(lines, valueLines) {
	const block = itemBlock(valueLines.map(j => lines[j]));
	const keys = isMappingItem(block)
		? scanEntries(block, 0, block.length - 1).map(e => ({ key: e.key, line: valueLines[e.line], end: valueLines[e.last] }))
		: null;
	return { line: valueLines[0], end: valueLines.at(-1), keys };
}

/**
 * Parse a block list whose items may be scalars (`- SCN-HIER`) or mappings
 * (`- id: x` followed by deeper-indented `key: value` lines).
 */
function parseBlockList(lines) {
	return splitListItems(lines).map(group => {
		const block = itemBlock(group.map(k => lines[k]));
		if (block.every(isBlank)) return null;
		const text = block.join('\n');
		return isMappingItem(block) ? parseYaml(text) : parseScalar(text.trim());
	});
}

/**
 * An item's lines as one block at column 0: the "- " marker replaced with
 * spaces, so the first key aligns with the item's continuation lines, then the
 * indent common to its non-blank lines removed.
 */
function itemBlock(itemLines) {
	const first = itemLines[0].replace(/^(\s*)-(\s)/, '$1 $2').replace(/^(\s*)-$/, '$1 ');
	const blanked = [first, ...itemLines.slice(1)];
	const minIndent = Math.min(...blanked.filter(l => !isBlank(l)).map(indentOf));
	return blanked.map(l => l.slice(minIndent));
}

/** A mapping item starts with `key:` (or `key: value`); any other item is a scalar. */
function isMappingItem(block) {
	return /^[A-Za-z0-9_-]+:(\s|$)/.test(block.join('\n').trim().split('\n')[0]);
}

function parseScalar(raw) {
	const s = raw.trim();
	if (s === '') return '';
	if (s === 'null' || s === '~') return null;
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (/^-?\d+$/.test(s)) return parseInt(s, 10);
	if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
	if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
	}
	if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
		return s.slice(1, -1);
	}
	if (s.startsWith('[') && s.endsWith(']')) {
		const inner = s.slice(1, -1).trim();
		if (inner === '') return [];
		return splitTopLevel(inner).map(x => parseScalar(x));
	}
	if (s.startsWith('{') && s.endsWith('}')) {
		const inner = s.slice(1, -1).trim();
		if (inner === '') return {};
		const obj = {};
		for (const pair of splitTopLevel(inner)) {
			const idx = pair.indexOf(':');
			if (idx === -1) continue;
			obj[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1));
		}
		return obj;
	}
	return s;
}

/** Split on top-level commas, respecting [] and {} nesting. */
function splitTopLevel(inner) {
	const parts = [];
	let depth = 0, start = 0;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') depth--;
		else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
	}
	parts.push(inner.slice(start));
	return parts.map(p => p.trim()).filter(p => p !== '');
}

// ── Serializer (inverse of the parser, for the same subset) ──────────────────

/** Serialize `data` as front-matter and prepend it to `body`. */
export function stringifyFrontmatter(data, body = '') {
	return `---\n${stringifyYaml(data)}---\n${body}`;
}

/** Serialize a plain object to the YAML subset the parser accepts. */
export function stringifyYaml(obj, indent = 0) {
	const pad = '  '.repeat(indent);
	let out = '';
	for (const [key, val] of Object.entries(obj)) {
		if (val === undefined) continue;
		out += emitMapEntry(pad, key, val, indent);
	}
	return out;
}

function emitMapEntry(pad, key, val, indent) {
	if (Array.isArray(val)) {
		if (val.length === 0) return `${pad}${key}: []\n`;
		if (val.every(isScalar)) return `${pad}${key}: [${val.map(formatScalar).join(', ')}]\n`;
		let out = `${pad}${key}:\n`;
		for (const item of val) out += emitListItem(pad + '  ', item, indent + 1);
		return out;
	}
	if (isFlowObject(val)) return `${pad}${key}: ${formatFlowObject(val)}\n`;
	if (val !== null && typeof val === 'object') return `${pad}${key}:\n${stringifyYaml(val, indent + 1)}`;
	if (isBlockScalar(val)) return emitBlockScalar(pad, key, val);
	return `${pad}${key}: ${formatScalar(val)}\n`;
}

function emitListItem(pad, item, indent) {
	if (isScalar(item)) return `${pad}- ${formatScalar(item)}\n`;
	const entries = Object.entries(item).filter(([, v]) => v !== undefined);
	if (entries.length === 0) return `${pad}- {}\n`;
	let out = '';
	entries.forEach(([k, v], idx) => {
		const body = emitMapEntry(pad + '  ', k, v, indent + 1);
		// The first entry carries the "- " dash; later entries align under it.
		out += idx === 0 ? body.replace(pad + '  ', pad + '- ') : body;
	});
	return out;
}

function isScalar(v) {
	return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** A shallow object (all-scalar values) → rendered inline as `{ k: v, ... }`. */
function isFlowObject(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
		&& Object.values(v).every(isScalar) && !Object.values(v).some(isBlockScalar);
}

function formatFlowObject(obj) {
	const inner = Object.entries(obj)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}: ${formatScalar(v)}`)
		.join(', ');
	return `{ ${inner} }`;
}

/** Multi-line strings serialize as block scalars (`key: |`). */
function isBlockScalar(v) {
	return typeof v === 'string' && v.includes('\n');
}

function emitBlockScalar(pad, key, val) {
	const childPad = pad + '  ';
	const lines = val.split('\n').map(l => (l === '' ? '' : childPad + l));
	return `${pad}${key}: |\n${lines.join('\n')}\n`;
}

export function formatScalar(v) {
	if (v === null) return 'null';
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'number') return String(v);
	const s = String(v);
	// Quote strings that would otherwise parse as a different type or break
	// flow/scalar boundaries (leading markers, brackets, colons, commas, #).
	if (s === '' || /^(null|true|false|~)$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)
		|| /[:#,\[\]{}]/.test(s) || /^[\s>|*&!%@`'"-]/.test(s) || /\s$/.test(s)) {
		return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}
	return s;
}
