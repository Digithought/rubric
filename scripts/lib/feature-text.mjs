/**
 * Rewriting a markdown file's front-matter as text. An edit removes or replaces
 * whole lines that `scanFrontmatter` locates, so it takes exactly what the
 * parser reads as one key or one list item, and every other byte — the body,
 * comments, quoting, key order, each line's own ending — stays as written.
 */

import { normaliseCapability } from './features.mjs';
import { formatScalar, isMapping, parseYaml, scanFrontmatter, stringifyYaml } from './frontmatter.mjs';

/**
 * @param {string} raw  the whole file
 * @param {{
 *   dropKeys?: Set<string>,
 *   capability?: (cap: { text: string|null, target: string|null, line: number }) => 'keep'|'drop'|'plain',
 * }} [edits]
 *   `dropKeys` removes those top-level keys, whole spans. `capability` is asked
 *   about each item of the top-level `capabilities:` list, shaped as
 *   `walkFeatures` gives it (`line` 1-based): `drop` removes the item, `plain`
 *   rewrites a `text:`/`target:` item as the plain `- <text>`. `plain` leaves an
 *   item that is already plain, or of a shape validateSpec rejects, as written.
 * @returns {string} the rewritten file — `raw` itself when nothing changed
 */
export function rewriteFrontmatter(raw, { dropKeys = new Set(), capability = () => 'keep' } = {}) {
	const scan = scanFrontmatter(raw);
	if (!scan) return raw;
	const edits = new Map();   // 0-based line → its replacement, or null to remove the line
	for (const span of scan.keys) {
		if (dropKeys.has(span.key)) removeLines(edits, span.line, span.end);
		else if (span.key === 'capabilities') editCapabilities(scan, span, capability, edits);
	}
	if (edits.size === 0) return raw;
	// Splitting after each \n keeps every line's own ending; chunk i is scan.lines[i].
	return raw.split(/(?<=\n)/).map((chunk, i) => {
		if (!edits.has(i)) return chunk;
		const replacement = edits.get(i);
		return replacement === null ? '' : replacement + (chunk.match(/\r?\n$/)?.[0] ?? '');
	}).join('');
}

function removeLines(edits, from, to) {
	for (let j = from; j <= to; j++) edits.set(j, null);
}

const lineRange = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

/** A capability `plain` can rewrite: `text:` and `target:` only, with one line of text. */
function isObjectForm(item) {
	return isMapping(item) && typeof item.text === 'string' && !item.text.includes('\n')
		&& Object.keys(item).every(k => k === 'text' || k === 'target');
}

function editCapabilities(scan, span, decide, edits) {
	const list = parseYaml(scan.lines.slice(span.line, span.end + 1).join('\n'))[span.key];
	if (!Array.isArray(list)) return;
	if (!span.items) {
		editFlowList(scan, span, list, decide, edits);
		return;
	}
	span.items.forEach((item, i) => {
		const action = decide(normaliseCapability(list[i], item.line + 1));
		if (action === 'drop') removeLines(edits, item.line, item.end);
		else if (action === 'plain') collapseItem(scan, span.key, item, list[i], edits);
	});
}

/**
 * Rewrite a block-list `text:`/`target:` item — keys in either order, or under
 * a bare `-` — as `- <text>` at the dash's indent, keeping any comment lines
 * inside it. The text keeps the form written after `text:` unless the parser
 * would read that differently as a list item (`Word: …` reads as a mapping, a
 * `|` or `>` header as a block scalar); then it is written as `formatScalar`
 * quotes it. Nothing changes unless the parser reads the result back as exactly
 * the text.
 */
function collapseItem(scan, key, item, value, edits) {
	if (!item.keys || !isObjectForm(value)) return;
	const replaced = item.keys.flatMap(k => lineRange(k.line, k.end));
	if (/^\s*-\s*$/.test(scan.lines[item.line])) replaced.push(item.line);
	const rest = lineRange(item.line, item.end).filter(j => !replaced.includes(j)).map(j => scan.lines[j]);
	const dash = `${scan.lines[item.line].match(/^\s*/)[0]}- `;
	const written = scan.lines[item.keys.find(k => k.key === 'text').line].replace(/^\s*(?:-\s+)?text:/, '').trim();
	const line = [written, formatScalar(value.text)]
		.map(form => dash + form)
		.find(candidate => readsAs(key, [candidate, ...rest], value.text));
	if (line === undefined) return;
	for (const j of replaced) edits.set(j, null);
	edits.set(item.line, line);
}

/** Whether `lines`, as the one item of a block list under `key`, parse as exactly `text`. */
function readsAs(key, lines, text) {
	const list = parseYaml([`${key}:`, ...lines].join('\n'))[key];
	return Array.isArray(list) && list.length === 1 && list[0] === text;
}

/**
 * An inline `[…]` list has no item lines to edit, so when any item changes the
 * key is written again from the edited list, in the form `stringifyYaml` gives.
 */
function editFlowList(scan, span, list, decide, edits) {
	let changed = false;
	const edited = list.flatMap(item => {
		const action = decide(normaliseCapability(item, span.line + 1));
		if (action === 'drop') { changed = true; return []; }
		if (action === 'plain' && isObjectForm(item)) { changed = true; return [item.text]; }
		return [item];
	});
	if (!changed) return;
	removeLines(edits, span.line, span.end);
	edits.set(span.line, stringifyYaml({ [span.key]: edited }).replace(/\n$/, '').split('\n').join(scan.eol));
}
