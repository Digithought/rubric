#!/usr/bin/env node
/**
 * Rubric runner — orchestrates aspect audits over the feature inventory.
 *
 * For a given trigger (cadence) it:
 *   1. Discovers active aspects under `aspects/<name>/`.
 *   2. Filters them by cadence (and optional --aspect override).
 *   3. For each aspect, walks `features/`, applies the aspect's `level` and
 *      `applies-to`, then splits into batches per `batch:`.
 *   4. Records the plan as a run manifest in `.runs/<runId>/manifest.md`, then
 *      dispatches one audit agent per batch, driving each task through the
 *      manifest state machine (pending → running → done/failed/blocked).
 *   5. Each agent owns its own artifacts: gap tickets land in the project's
 *      ticket queue; the per-batch run log lands in the run dir. The runner is
 *      the sole writer of the manifest — it lifts verdicts and blockers from
 *      each agent's run log after the batch completes.
 *
 * Blockers (shared conditions an agent reports — DB down, build broken) are
 * injected into later batches' prompts and, when global+blocking, short-circuit
 * the rest of the run so subsequent agents don't waste cycles rediscovering the
 * same wall. `--resume <runId|last>` replays a run, skipping done tasks.
 */

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { parseArgs } from './lib/cli.mjs';
import { discoverActiveAspects, filterByCadence, readPrompt, readTicketTemplate } from './lib/aspects.mjs';
import { walkFeatures, filterFeatures, findFeature } from './lib/features.mjs';
import { batchFeatures } from './lib/batch.mjs';
import { buildAuditPrompt } from './lib/prompt.mjs';
import { runAgent } from './lib/agent.mjs';
import { readRun } from './lib/runs.mjs';
import {
	createManifest, runDir, writeManifest, readManifest, resolveRunId,
	setTaskStatus, mergeBlockers, openBlockers, haltingBlocker, blockersForTask, taskBlockedBy,
} from './lib/manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUBRIC_ROOT = resolve(__dirname, '..');

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const repoRoot = resolve(RUBRIC_ROOT, '..');

	const aspectsDir = join(repoRoot, 'aspects');
	const featuresDir = join(repoRoot, 'features');
	const defaultsDir = join(RUBRIC_ROOT, 'defaults', 'aspects');
	const runsDir = join(repoRoot, '.runs');
	await mkdir(runsDir, { recursive: true });

	const allAspects = await discoverActiveAspects(aspectsDir, defaultsDir);
	const allFeatures = await walkFeatures(featuresDir);

	if (opts.resume) {
		await resume(opts, { runsDir, repoRoot, allAspects, allFeatures });
		return;
	}
	await freshRun(opts, { aspectsDir, runsDir, repoRoot, allAspects, allFeatures, defaultsDir });
}

// ── Fresh run: discover, plan, manifest, dispatch ────────────────────────────

async function freshRun(opts, ctx) {
	const { runsDir, repoRoot, allAspects, allFeatures } = ctx;

	if (allAspects.length === 0) {
		console.log(`No aspects activated. Create a folder under aspects/<name>/ with an aspect.md to activate one.`);
		console.log(`See: rubric/agent-rules/add-aspect.md`);
		return;
	}

	let aspects = allAspects;
	if (opts.aspect) {
		aspects = aspects.filter(a => a.name === opts.aspect);
		if (aspects.length === 0) {
			console.error(`Aspect "${opts.aspect}" is not active. Active aspects:`);
			allAspects.forEach(a => console.error(`  ${a.name}`));
			process.exit(1);
		}
	} else {
		aspects = filterByCadence(aspects, opts.cadence);
		if (aspects.length === 0) {
			console.log(`No active aspects match cadence "${opts.cadence}".`);
			return;
		}
	}
	if (Number.isFinite(opts.maxAspects)) aspects = aspects.slice(0, opts.maxAspects);

	if (allFeatures.length === 0) {
		console.error(`No features found under features/. Did you run rubric init?`);
		process.exit(1);
	}

	// ── Plan ──
	const plan = [];
	for (const aspect of aspects) {
		let features = filterFeatures(allFeatures, aspect);
		if (opts.features) {
			const set = new Set(opts.features);
			features = features.filter(f => set.has(f.code));
		}
		if (features.length === 0) {
			plan.push({ aspect, batches: [], skipped: 'no features match level/applies-to/--features' });
			continue;
		}
		const batches = batchFeatures(features, aspect.data.batch || 8);
		plan.push({ aspect, batches });
	}

	// Cap total batches across plan.
	let remaining = opts.maxBatches;
	for (const item of plan) {
		if (!Number.isFinite(remaining)) break;
		if (remaining <= 0) { item.batches = []; continue; }
		if (item.batches.length > remaining) item.batches = item.batches.slice(0, remaining);
		remaining -= item.batches.length;
	}

	// ── Print plan ──
	const totalBatches = plan.reduce((n, p) => n + p.batches.length, 0);
	const totalFeatures = plan.reduce((n, p) => n + p.batches.flat().length, 0);
	console.log(`rubric run`);
	console.log(`  cadence:      ${opts.aspect ? `(--aspect ${opts.aspect})` : opts.cadence}`);
	console.log(`  aspects:      ${aspects.length}`);
	console.log(`  batches:      ${totalBatches}`);
	console.log(`  features:     ${totalFeatures}`);
	console.log(`  agent:        ${opts.agent}`);
	console.log(`  dry-run:      ${opts.dryRun}`);
	console.log('');
	for (const { aspect, batches, skipped } of plan) {
		const badge = aspect.promptSource === 'project' ? 'project' : (aspect.promptSource === 'default' ? 'default' : 'NO PROMPT');
		console.log(`  ${aspect.name}  (prompt: ${badge}, level: ${aspect.data.level || 'any'}, batch: ${aspect.data.batch || 8})`);
		if (skipped) { console.log(`    skipped — ${skipped}`); continue; }
		batches.forEach((b, i) => {
			console.log(`    batch ${i + 1}/${batches.length}: ${b.map(f => f.code).join(', ')}`);
		});
	}
	if (opts.dryRun) return;

	// ── Build the dispatch task list + manifest ──
	const runId = `${tsCompact()}-${process.pid}`;
	const trigger = opts.aspect ? `aspect:${opts.aspect}` : opts.cadence;
	const startedAt = new Date().toISOString();

	const descriptors = [];
	for (const { aspect, batches } of plan) {
		batches.forEach((batch, i) => {
			const id = `${aspect.name}/batch${i + 1}`;
			descriptors.push({
				id,
				aspect,
				features: batch,
				log: `${aspect.name}-batch${i + 1}.md`,
			});
		});
	}
	if (descriptors.length === 0) { console.log('\nNothing to dispatch.'); return; }

	const manifest = createManifest({
		runId, trigger, startedAt,
		tasks: descriptors.map(d => ({ id: d.id, aspect: d.aspect.name, features: d.features.map(f => f.code), log: d.log })),
	});
	await writeManifest(runsDir, manifest);
	console.log(`\nrun: ${runId}  (manifest: ${rel(join(runDir(runsDir, runId), 'manifest.md'), repoRoot)})`);

	await dispatchLoop({ opts, runsDir, repoRoot, manifest, descriptors, staleSet: new Set() });
}

// ── Resume: replay a prior run from its manifest ─────────────────────────────

async function resume(opts, ctx) {
	const { runsDir, repoRoot, allAspects, allFeatures } = ctx;
	const runId = await resolveRunId(runsDir, opts.resume);
	if (!runId) { console.error(`No resumable run found for "${opts.resume}".`); process.exit(1); }
	const manifest = await readManifest(runsDir, runId);
	if (!manifest) { console.error(`Run "${runId}" has no manifest.`); process.exit(1); }

	// Blockers carried over from the prior pass are "stale" — unverified. They
	// stay as warnings (injected) but don't halt dispatch until re-confirmed.
	const staleSet = new Set(openBlockers(manifest).map(b => b.id));

	// Rebuild dispatch descriptors from the manifest, resolving live aspect +
	// feature records (the manifest stores only codes).
	const aspectByName = new Map(allAspects.map(a => [a.name, a]));
	const descriptors = [];
	for (const task of manifest.tasks) {
		const aspect = aspectByName.get(task.aspect);
		if (!aspect) {
			console.warn(`  ${task.id}: aspect "${task.aspect}" no longer active — skipping.`);
			setTaskStatus(manifest, task.id, 'skipped', { note: 'aspect inactive' });
			continue;
		}
		const features = task.features.map(c => findFeature(allFeatures, c)).filter(Boolean);
		descriptors.push({ id: task.id, aspect, features, log: task.log });
	}

	manifest.status = 'in-progress';
	manifest.finished = null;
	await writeManifest(runsDir, manifest);

	const pendingCount = descriptors.filter(d => shouldDispatch(manifest, d, staleSet)).length;
	console.log(`Resuming run ${runId} — ${pendingCount} task(s) to (re)dispatch, ${manifest.tasks.length} total.`);
	if (opts.dryRun) {
		for (const d of descriptors) {
			const t = manifest.tasks.find(x => x.id === d.id);
			console.log(`  ${shouldDispatch(manifest, d, staleSet) ? '→' : 'skip'} ${d.id} (${t.status})`);
		}
		return;
	}
	await dispatchLoop({ opts, runsDir, repoRoot, manifest, descriptors, staleSet });
}

// ── Shared dispatch loop + state machine ─────────────────────────────────────

/** A task is dispatchable if not already done/skipped, and not blocked by a
 *  still-open (non-stale) blocker. Blocked tasks become eligible again once
 *  their blocker is resolved (i.e. it's no longer open). */
function shouldDispatch(manifest, descriptor, staleSet) {
	const task = manifest.tasks.find(t => t.id === descriptor.id);
	if (!task) return false;
	if (task.status === 'done' || task.status === 'skipped') return false;
	if (task.status === 'blocked') {
		const stillBlocked = openBlockers(manifest).some(b => b.id === task['blocked-by'] && !staleSet.has(b.id));
		if (stillBlocked) return false;
	}
	return true;
}

async function dispatchLoop({ opts, runsDir, repoRoot, manifest, descriptors, staleSet }) {
	const dir = runDir(runsDir, manifest.run);
	const promptCache = new Map();   // aspect.name → { prompt, tpl }
	let failuresWithoutBlocker = 0;

	for (const d of descriptors) {
		if (!shouldDispatch(manifest, d, staleSet)) continue;

		// Short-circuit: a confirmed global+blocking blocker halts the whole run.
		const halt = haltingBlocker(manifest, staleSet);
		if (halt) {
			for (const rest of descriptors) {
				if (shouldDispatch(manifest, rest, staleSet)) {
					setTaskStatus(manifest, rest.id, 'blocked', { 'blocked-by': halt.id });
				}
			}
			await writeManifest(runsDir, manifest);
			console.log(`\n⛔ run halted by blocker ${halt.id} (${halt.summary}). Remaining tasks marked blocked.`);
			break;
		}

		// Aspect/feature-scoped blocker → skip this one task without dispatching.
		const scoped = taskBlockedBy(manifest, manifest.tasks.find(t => t.id === d.id), staleSet);
		if (scoped) {
			setTaskStatus(manifest, d.id, 'blocked', { 'blocked-by': scoped.id });
			await writeManifest(runsDir, manifest);
			console.log(`\n⛔ ${d.id} skipped — blocked by ${scoped.id}.`);
			continue;
		}

		// Resolve aspect prompt/template once per aspect.
		if (!promptCache.has(d.aspect.name)) {
			try {
				promptCache.set(d.aspect.name, {
					prompt: await readPrompt(d.aspect),
					tpl: await readTicketTemplate(d.aspect),
				});
			} catch (e) {
				console.error(`  ${d.aspect.name}: ${e.message} — skipping aspect.`);
				setTaskStatus(manifest, d.id, 'failed', { note: e.message });
				await writeManifest(runsDir, manifest);
				continue;
			}
		}
		const { prompt: aspectPromptBody, tpl: ticketTemplateBody } = promptCache.get(d.aspect.name);

		const task = manifest.tasks.find(t => t.id === d.id);
		const startedAt = new Date().toISOString();
		setTaskStatus(manifest, d.id, 'running', { attempts: (task.attempts || 0) + 1 });
		await writeManifest(runsDir, manifest);

		const runLogPath = join(dir, d.log);
		const logFile = runLogPath.replace(/\.md$/, '.agent.log');
		const knownBlockers = blockersForTask(manifest, task);
		const prompt = buildAuditPrompt({
			aspect: d.aspect,
			aspectPromptBody,
			ticketTemplateBody,
			features: d.features,
			repoRoot,
			runLogPath,
			runId: manifest.run,
			runStartedAt: startedAt,
			knownBlockers,
		});

		console.log(`\n→ ${d.id}: ${d.features.map(f => f.code).join(', ')}`
			+ (knownBlockers.length ? `  (warned of ${knownBlockers.length} blocker(s))` : ''));
		const t0 = Date.now();
		const result = await runAgent({ agent: opts.agent, prompt, cwd: repoRoot, logFile });
		const secs = Math.round((Date.now() - t0) / 1000);

		// Lift verdicts + blockers from the agent's run log.
		const finishedAt = new Date().toISOString();
		let reported = { verdictCounts: null, blockers: [] };
		if (existsSync(runLogPath)) {
			try { reported = await readRun(runLogPath); } catch { /* malformed log */ }
		}
		const added = mergeBlockers(manifest, reported.blockers, {
			raisedBy: d.id, raisedAt: finishedAt, staleSet,
		});

		const ok = result.exitCode === 0 && existsSync(runLogPath);
		if (ok) {
			setTaskStatus(manifest, d.id, 'done', {
				finished: finishedAt,
				verdicts: reported.verdictCounts || undefined,
			});
		} else {
			setTaskStatus(manifest, d.id, 'failed', {
				finished: finishedAt,
				note: result.timedOut ? 'idle timeout' : `exit ${result.exitCode}` + (existsSync(runLogPath) ? '' : ', no run log'),
			});
			// Backstop: if batches keep failing and no agent named a cause, make
			// the pattern visible (degraded, so it warns but doesn't halt).
			if (added.length === 0 && ++failuresWithoutBlocker >= 2
				&& !manifest.blockers.some(b => b.id === 'runner/repeated-failures')) {
				mergeBlockers(manifest, [{
					id: 'runner/repeated-failures', scope: 'global', severity: 'degraded',
					summary: 'Multiple batches failed without reporting a blocker — investigate the agent/environment.',
				}], { raisedBy: 'runner', raisedAt: finishedAt });
			}
		}
		await writeManifest(runsDir, manifest);
		console.log(`  ${ok ? '✓ done' : '✗ ' + (result.timedOut ? 'idle timeout' : `exit ${result.exitCode}`)} in ${secs}s`
			+ (added.length ? `  · raised blocker(s): ${added.join(', ')}` : '')
			+ `  — log: ${rel(logFile, repoRoot)}`);
	}

	// ── Finalize ──
	const counts = manifest.tasks.reduce((c, t) => (c[t.status] = (c[t.status] || 0) + 1, c), {});
	const incomplete = (counts.pending || 0) + (counts.running || 0) + (counts.failed || 0) + (counts.blocked || 0);
	manifest.status = incomplete === 0 ? 'completed' : (counts.blocked && haltingBlocker(manifest, staleSet) ? 'aborted' : 'in-progress');
	manifest.finished = new Date().toISOString();
	await writeManifest(runsDir, manifest);

	console.log(`\n${manifest.status === 'completed' ? 'Done.' : 'Stopped.'} `
		+ Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', '));
	if (incomplete > 0) {
		console.log(`Resume with:  node rubric/scripts/run.mjs --resume ${manifest.run}`);
	}
}

function rel(absPath, repoRoot) {
	const r = absPath.startsWith(repoRoot) ? absPath.slice(repoRoot.length + 1) : absPath;
	return r.split('\\').join('/');
}

function tsCompact() {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

main().catch(err => {
	console.error('rubric runner failed:', err);
	process.exit(1);
});
