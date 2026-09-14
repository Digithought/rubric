/**
 * Aspect discovery and override resolution.
 *
 * An aspect is **active** for a project when `aspects/<name>/aspect.md` exists
 * and is not retired. Per-aspect files (prompt, ticket-template) are resolved
 * with project overrides winning; otherwise we fall back to
 * `rubric/defaults/aspects/<extends>/`, where `extends` defaults to the aspect's
 * own folder name.
 *
 * A child aspect (`parent: <name>`) composes with its parent — `readPrompt`,
 * `readTicketTemplate`, and `aspectApplies` in features.mjs. A parent with
 * active children has no verdicts of its own (`hasVerdicts`).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { isMapping, readFrontmatterWithLines } from './frontmatter.mjs';

/**
 * Active aspects by name. `promptPath` and `ticketTemplatePath` are the
 * aspect's own files; what an audit of a child uses also draws on its parent.
 *
 * @returns {Promise<Array<{
 *   name:string,
 *   path:string,
 *   data:object,
 *   keyLines:Record<string,number>,
 *   promptPath:string,
 *   promptSource:'project'|'default'|null,
 *   ticketTemplatePath:string|null,
 *   ticketTemplateSource:'project'|'default'|null,
 *   parent:object|null,
 *   children:string[],
 * }>>}
 */
export async function discoverActiveAspects(aspectsDir, defaultsDir) {
	const out = [];
	let entries;
	try { entries = await readdir(aspectsDir, { withFileTypes: true }); }
	catch { return out; }
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const dir = join(aspectsDir, e.name);
		const aspectFile = join(dir, 'aspect.md');
		if (!existsSync(aspectFile)) continue;
		const { data, keyLines } = await readFrontmatterWithLines(aspectFile);
		if (data.status === 'retired') continue;
		const ext = data.extends || e.name;
		const defaultDir = join(defaultsDir, ext);
		const projPrompt = join(dir, 'prompt.md');
		const defPrompt = join(defaultDir, 'prompt.md');
		const projTpl = join(dir, 'ticket-template.md');
		const defTpl = join(defaultDir, 'ticket-template.md');
		const promptPath = existsSync(projPrompt) ? projPrompt : (existsSync(defPrompt) ? defPrompt : null);
		const promptSource = existsSync(projPrompt) ? 'project' : (existsSync(defPrompt) ? 'default' : null);
		const ticketTemplatePath = existsSync(projTpl) ? projTpl : (existsSync(defTpl) ? defTpl : null);
		const ticketTemplateSource = existsSync(projTpl) ? 'project' : (existsSync(defTpl) ? 'default' : null);
		out.push({
			name: e.name,
			path: aspectFile,
			data,
			keyLines,
			promptPath,
			promptSource,
			ticketTemplatePath,
			ticketTemplateSource,
			parent: null,
			children: [],
		});
	}
	out.sort((a, b) => compareNames(a.name, b.name));
	linkParents(out);
	return out;
}

const compareNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Resolve each `parent:` to the parent's record and list each parent's
 * children, by name. Aspects nest one level: a `parent:` naming the aspect
 * itself, an inactive aspect, or an aspect with a `parent:` of its own stays
 * unresolved (`parent` null) — validateSpec reports each — so no chain or
 * cycle is ever followed.
 */
function linkParents(aspects) {
	const byName = new Map(aspects.map(a => [a.name, a]));
	for (const aspect of aspects) {
		const parent = byName.get(aspect.data.parent);
		if (!parent || parent === aspect || parent.data.parent != null) continue;
		aspect.parent = parent;
		parent.children.push(aspect.name);
	}
}

/**
 * The prompt an audit of this aspect uses: for a child, its parent's prompt, a
 * blank line, then its own (the delta); otherwise its own.
 */
export async function readPrompt(aspect) {
	if (!aspect.parent) return readOwnPrompt(aspect);
	if (!aspect.parent.promptPath) {
		throw new Error(`Aspect "${aspect.name}": its parent "${aspect.parent.name}" has no prompt (project override absent and no default exists).`);
	}
	const base = await readFile(aspect.parent.promptPath, 'utf-8');
	return `${base.trimEnd()}\n\n${await readOwnPrompt(aspect)}`;
}

async function readOwnPrompt(aspect) {
	if (!aspect.promptPath) {
		throw new Error(`Aspect "${aspect.name}" has no prompt (project override absent and no default exists).`);
	}
	return readFile(aspect.promptPath, 'utf-8');
}

/** The ticket template an audit of this aspect uses — its own, else its parent's — or null. */
export async function readTicketTemplate(aspect) {
	const path = aspect.ticketTemplatePath ?? aspect.parent?.ticketTemplatePath ?? null;
	return path ? readFile(path, 'utf-8') : null;
}

/** Whether audits of this aspect record verdicts: a parent with active children has none of its own. */
export function hasVerdicts(aspect) {
	return (aspect.children?.length ?? 0) === 0;
}

/**
 * The aspects `--aspect <name>` selects: a parent's children when it has any,
 * else the named aspect itself; [] when no active aspect has that name.
 */
export function aspectsNamed(aspects, name) {
	const named = aspects.find(a => a.name === name);
	if (!named) return [];
	return hasVerdicts(named) ? [named] : aspects.filter(a => a.parent === named);
}

/**
 * The aspects a coverage view shows, in its order: every aspect with verdicts,
 * top-level aspects by name, and each parent's children by name in the
 * parent's place.
 */
export function coverageColumns(aspects) {
	const place = (a) => [a.parent?.name ?? a.name, a.parent ? a.name : ''];
	return aspects.filter(hasVerdicts).sort((a, b) => {
		const [pa, pb] = [place(a), place(b)];
		return compareNames(pa[0], pb[0]) || compareNames(pa[1], pb[1]);
	});
}

/** How coverage views name an aspect: `parent/child` for a child, else its name. */
export function aspectLabel(aspect) {
	return aspect.parent ? `${aspect.parent.name}/${aspect.name}` : aspect.name;
}

/**
 * The aspect's `annotation:` schema — `{ [key]: { type, values?, default? } }`
 * in declaration order — or null when it declares none. Entries that are not
 * mappings are left out; validateSpec reports them.
 */
export function annotationSchema(aspect) {
	const declared = aspect.data?.annotation;
	if (!isMapping(declared)) return null;
	return Object.fromEntries(Object.entries(declared).filter(([, spec]) => isMapping(spec)));
}

/**
 * The settings an aspect's audit uses for one feature: every declared key
 * whose default is not null, overlaid by the feature's `aspects.<name>` block.
 * Keys follow the schema's order, so the result serialises stably. `{}` when
 * the aspect declares no annotation.
 */
export function resolveAnnotation(aspect, feature) {
	const schema = annotationSchema(aspect);
	if (!schema) return {};
	const blocks = feature.data?.aspects;
	const block = isMapping(blocks) && Object.hasOwn(blocks, aspect.name) && isMapping(blocks[aspect.name]) ? blocks[aspect.name] : {};
	const out = {};
	for (const [key, spec] of Object.entries(schema)) {
		const value = Object.hasOwn(block, key) ? block[key] : undefined;
		const resolved = value ?? spec.default;
		if (resolved != null) out[key] = resolved;
	}
	return out;
}

/** Filter aspects to those whose `cadence:` includes the trigger. */
export function filterByCadence(aspects, trigger) {
	if (trigger === 'any') return aspects;
	return aspects.filter(a => {
		const cad = a.data.cadence || [];
		const list = Array.isArray(cad) ? cad : [cad];
		return list.includes(trigger);
	});
}
