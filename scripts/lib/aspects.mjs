/**
 * Aspect discovery and override resolution.
 *
 * An aspect is **active** for a project when `aspects/<name>/aspect.md` exists.
 * Per-aspect files (prompt, ticket-template) are resolved with project overrides
 * winning; otherwise we fall back to `rubric/defaults/aspects/<extends>/`, where
 * `extends` defaults to the aspect's own folder name.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { isMapping, readFrontmatterWithLines } from './frontmatter.mjs';

/**
 * @returns {Promise<Array<{
 *   name:string,
 *   path:string,
 *   data:object,
 *   keyLines:Record<string,number>,
 *   promptPath:string,
 *   promptSource:'project'|'default'|null,
 *   ticketTemplatePath:string|null,
 *   ticketTemplateSource:'project'|'default'|null,
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
		});
	}
	return out;
}

/** Read the aspect's resolved prompt body (no front-matter trimming — prompts have none). */
export async function readPrompt(aspect) {
	if (!aspect.promptPath) {
		throw new Error(`Aspect "${aspect.name}" has no prompt (project override absent and no default exists).`);
	}
	return readFile(aspect.promptPath, 'utf-8');
}

/** Read the aspect's resolved ticket template body, or null. */
export async function readTicketTemplate(aspect) {
	if (!aspect.ticketTemplatePath) return null;
	return readFile(aspect.ticketTemplatePath, 'utf-8');
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
