/**
 * Run manifest — the per-run checklist and blocker blackboard.
 *
 * A "run" is one orchestration pass (one logical plan), identified by a
 * `runId` and homed in `.runs/<runId>/`. The manifest is the single piece of
 * durable state the **runner owns and is the sole writer of**; audit agents
 * never touch it. They communicate upward through their own run logs (verdicts
 * + a `blockers:` front-matter list), which the runner lifts into the manifest
 * after each batch.
 *
 * The manifest solves three things:
 *   1. Cross-cutting blockers stop wasting cycles — open blockers are injected
 *      into later prompts and (for global/blocking ones) short-circuit dispatch.
 *   2. Resumption — `done` tasks are skipped on a re-run; the rest re-dispatch.
 *   3. Progress visibility — the manifest IS the checklist (frontmatter = truth,
 *      rendered body = human/UI glance).
 *
 * On-disk form is `.runs/<runId>/manifest.md`: YAML front-matter (the state the
 * runner parses) followed by a rendered markdown snapshot (for humans/UI). The
 * runner regenerates the whole file on every transition rather than patching in
 * place.
 */

import { join } from 'node:path';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';

export const MANIFEST_FILE = 'manifest.md';

/**
 * Build a fresh manifest from a dispatch plan.
 * @param {{runId:string, trigger:string, startedAt:string, tasks:Array}} init
 *   tasks: [{ id, aspect, features:[codes], log }]
 */
export function createManifest({ runId, trigger, startedAt, tasks }) {
	return {
		run: runId,
		trigger,
		started: startedAt,
		finished: null,
		status: 'in-progress',
		tasks: tasks.map(t => ({
			id: t.id,
			aspect: t.aspect,
			features: t.features,
			status: 'pending',
			attempts: 0,
			log: t.log,
		})),
		blockers: [],
	};
}

/** Absolute path to a run's directory. */
export function runDir(runsDir, runId) {
	return join(runsDir, runId);
}

/** Write (or rewrite) the manifest file for a run, including the rendered body. */
export async function writeManifest(runsDir, manifest) {
	const dir = runDir(runsDir, manifest.run);
	await mkdir(dir, { recursive: true });
	const md = stringifyFrontmatter(manifest, renderBody(manifest));
	await writeFile(join(dir, MANIFEST_FILE), md, 'utf-8');
}

/** Read a manifest by runId. Returns null if absent. */
export async function readManifest(runsDir, runId) {
	const file = join(runDir(runsDir, runId), MANIFEST_FILE);
	if (!existsSync(file)) return null;
	const { data } = parseFrontmatter(await readFile(file, 'utf-8'));
	data.tasks ??= [];
	data.blockers ??= [];
	return data;
}

/**
 * Resolve a runId: an explicit id, or `last` for the newest run dir that has a
 * manifest. Run dirs are named with a sortable ISO stamp, so lexical max wins.
 */
export async function resolveRunId(runsDir, ref) {
	if (ref && ref !== 'last') return ref;
	let entries;
	try { entries = await readdir(runsDir, { withFileTypes: true }); } catch { return null; }
	const dirs = entries
		.filter(e => e.isDirectory() && existsSync(join(runsDir, e.name, MANIFEST_FILE)))
		.map(e => e.name)
		.sort((a, b) => b.localeCompare(a));
	return dirs[0] ?? null;
}

// ── State transitions (mutate in place; caller persists with writeManifest) ──

export function getTask(manifest, taskId) {
	return manifest.tasks.find(t => t.id === taskId) ?? null;
}

export function setTaskStatus(manifest, taskId, status, patch = {}) {
	const task = getTask(manifest, taskId);
	if (!task) return null;
	task.status = status;
	Object.assign(task, patch);
	return task;
}

/**
 * Merge blockers reported by an agent into the manifest. Dedupe by `id`. A
 * repeat report of an already-open blocker is normally ignored (the original
 * stands) — except when the id is in `staleSet` (carried over from a prior run
 * being resumed): re-reporting it confirms it's still live, so we un-stale it
 * (it can halt again) and refresh its timestamp. Returns ids added or
 * reconfirmed.
 */
export function mergeBlockers(manifest, incoming, { raisedBy, raisedAt, staleSet } = {}) {
	const changed = [];
	for (const b of incoming || []) {
		if (!b || !b.id) continue;
		const existing = manifest.blockers.find(x => x.id === b.id);
		if (existing) {
			if (staleSet?.has(b.id)) {
				staleSet.delete(b.id);
				existing.resolved = null;
				existing.raised = b.raised || raisedAt;
				changed.push(b.id);
			}
			continue;
		}
		manifest.blockers.push({
			id: b.id,
			'raised-by': b['raised-by'] || raisedBy || null,
			scope: b.scope || 'global',
			severity: b.severity || 'blocking',
			summary: b.summary || '',
			detect: b.detect ?? undefined,
			'resolution-hint': b['resolution-hint'] ?? undefined,
			raised: b.raised || raisedAt,
			resolved: b.resolved ?? null,
		});
		changed.push(b.id);
	}
	return changed;
}

/** Open (unresolved) blockers. */
export function openBlockers(manifest) {
	return manifest.blockers.filter(b => b.resolved == null);
}

/**
 * The first open blocker that halts the whole run (global + blocking), or null.
 * `staleSet` blockers (unverified carry-overs from a resumed run) don't halt
 * until an agent re-confirms them this pass.
 */
export function haltingBlocker(manifest, staleSet) {
	return openBlockers(manifest).find(b =>
		!staleSet?.has(b.id) && b.scope === 'global' && b.severity === 'blocking') ?? null;
}

/**
 * Open blockers relevant to a given task: global ones, ones scoped to its
 * aspect, or ones scoped to a feature in its batch. These get injected into the
 * task's prompt so the agent bails instead of re-investigating.
 */
export function blockersForTask(manifest, task) {
	const codes = new Set(task.features);
	return openBlockers(manifest).filter(b =>
		b.scope === 'global'
		|| b.scope === `aspect:${task.aspect}`
		|| (b.scope?.startsWith('feature:') && codes.has(b.scope.slice('feature:'.length))));
}

/** Should this task be skipped by an open (non-stale) blocker, without dispatching? */
export function taskBlockedBy(manifest, task, staleSet) {
	return openBlockers(manifest).find(b =>
		!staleSet?.has(b.id) && b.severity === 'blocking'
		&& (b.scope === 'global' || b.scope === `aspect:${task.aspect}`)) ?? null;
}

// ── Rendered body (human / UI snapshot; not parsed back) ─────────────────────

const STATUS_BOX = {
	done: 'x', running: '~', failed: '!', blocked: '⛔', skipped: '-', pending: ' ',
};

function renderBody(m) {
	const counts = tally(m.tasks);
	const open = openBlockers(m);
	const lines = [];
	lines.push('', `# Run ${m.run} — ${m.trigger}`, '');
	lines.push(`**Status:** ${m.status} · ${counts.done}/${m.tasks.length} done`
		+ (counts.blocked ? ` · ${counts.blocked} blocked` : '')
		+ (counts.failed ? ` · ${counts.failed} failed` : '')
		+ (open.length ? ` · ${open.length} open blocker${open.length > 1 ? 's' : ''}` : ''), '');
	lines.push('## Tasks');
	for (const t of m.tasks) {
		const box = STATUS_BOX[t.status] ?? ' ';
		const codes = t.features.join(', ');
		let tail = '';
		if (t.status === 'done' && t.verdicts) tail = ` → ${summarizeVerdicts(t.verdicts)}`;
		else if (t.status === 'blocked' && t['blocked-by']) tail = ` → blocked by \`${t['blocked-by']}\``;
		else if (t.status === 'failed') tail = ' → failed';
		lines.push(`- [${box}] \`${t.id}\` — ${codes}${tail}`);
	}
	if (m.blockers.length) {
		lines.push('', '## Blockers');
		for (const b of m.blockers) {
			const state = b.resolved == null ? 'open' : `resolved ${b.resolved}`;
			const mark = b.resolved == null ? (b.severity === 'blocking' ? '⛔' : '⚠️') : '✅';
			lines.push(`- ${mark} **${b.id}** (${b.scope}, ${b.severity}) — ${b.summary} _[${state}, raised by ${b['raised-by']}]_`);
		}
	}
	lines.push('');
	return lines.join('\n');
}

function tally(tasks) {
	const c = { done: 0, blocked: 0, failed: 0 };
	for (const t of tasks) if (t.status in c) c[t.status]++;
	return c;
}

function summarizeVerdicts(v) {
	return Object.entries(v).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'no verdicts';
}
