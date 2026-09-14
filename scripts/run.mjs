#!/usr/bin/env node
/**
 * Rubric runner — orchestrates aspect audits over the feature inventory.
 *
 * For a given trigger (cadence) it:
 *   1. Discovers active aspects under `aspects/<name>/`.
 *   2. Plans (`lib/plan.mjs`): filters aspects by cadence, or `--aspect` (a
 *      parent with children runs its children — it has no verdicts of its own);
 *      for each aspect walks `features/`, applies its `level`, `applies-to` and
 *      `surfaces` (a child's parent's too), keeps the features in the release
 *      `--target` (`lib/scope.mjs`), then splits into batches per `batch:`.
 *   3. Records the plan as a run manifest in `.runs/<runId>/manifest.md`, then
 *      dispatches one audit agent per batch, driving each task through the
 *      manifest state machine (pending → running → done/failed/blocked).
 *   4. Each agent owns its own artifacts: gap tickets land in the project's
 *      ticket queue; the per-batch run log lands in the run dir. The runner is
 *      the sole writer of the manifest — it lifts verdicts and blockers from
 *      each agent's run log after the batch completes, and notes any edit the
 *      audit made to its batch's feature files outside its own settings block.
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

import { parseArgs, runTarget } from './lib/cli.mjs';
import { hasVerdicts, readPrompt, readTicketTemplate } from './lib/aspects.mjs';
import { findFeature } from './lib/features.mjs';
import { exitIfSpecInvalid, loadSpec, validateSpec } from './lib/validate.mjs';
import { planAspects, selectAspects } from './lib/plan.mjs';
import { buildAuditPrompt } from './lib/prompt.mjs';
import { describeTarget, featureInScope, recordedTarget, targetName } from './lib/scope.mjs';
import { runAgent } from './lib/agent.mjs';
import { readRun } from './lib/runs.mjs';
import { gitHead, lastShippedRelease } from './lib/git.mjs';
import { readLedger, writeLedger, upsertRecord } from './lib/ledger.mjs';
import { cellFor, featureFingerprintFor, resolveAspectHash } from './lib/coverage-cell.mjs';
import { editedOutsideBlock, snapshotBatch } from './lib/edit-guard.mjs';
import { resolveStaleness, isStale } from './lib/freshness.mjs';
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
	const runsDir = join(repoRoot, '.runs');

	const spec = await loadSpec(repoRoot);
	exitIfSpecInvalid(repoRoot, spec, lastShippedRelease(repoRoot));
	const { aspects: allAspects, features: allFeatures, releases } = spec;
	await mkdir(runsDir, { recursive: true });

	if (opts.resume) {
		await resume(opts, { aspectsDir, runsDir, repoRoot, allAspects, allFeatures, releases });
		return;
	}
	await freshRun(opts, { aspectsDir, runsDir, repoRoot, allAspects, allFeatures, releases });
}

// ── Fresh run: discover, plan, manifest, dispatch ────────────────────────────

async function freshRun(opts, ctx) {
	const { aspectsDir, runsDir, repoRoot, allAspects, allFeatures, releases } = ctx;
	const target = exitOnUsageError(runTarget(opts, releases));

	if (allAspects.length === 0) {
		console.log(`No aspects activated. Create a folder under aspects/<name>/ with an aspect.md to activate one.`);
		console.log(`See: rubric/agent-rules/add-aspect.md`);
		return;
	}

	if (opts.aspect && !allAspects.some(a => a.name === opts.aspect)) {
		console.error(`Aspect "${opts.aspect}" is not active. Active aspects:`);
		allAspects.forEach(a => console.error(`  ${a.name}`));
		process.exit(1);
	}
	if (selectAspects(allAspects, opts).length === 0) {
		console.log(`No active aspects match cadence "${opts.cadence}".`);
		return;
	}

	if (allFeatures.length === 0) {
		console.error(`No features found under features/. Did you run rubric init?`);
		process.exit(1);
	}

	// ── Plan ──
	// --stale-only: keep only pairs whose ledger record is missing or stale,
	// most-churned first. Fresh pairs are pruned before batching.
	const narrowToStale = async (features, aspect) => {
		const stale = await staleFeatures(features, aspect, { aspectsDir, repoRoot, releases });
		const pruned = features.length - stale.length;
		if (pruned) console.log(`  ${aspect.name}: pruned ${pruned} fresh, ${stale.length} stale/missing to audit`);
		return stale;
	};
	const plan = await planAspects({ aspects: allAspects, features: allFeatures, opts, target, releases, narrowToStale });
	const recorded = recordedTarget(target, releases);

	// ── Print plan ──
	const totalBatches = plan.reduce((n, p) => n + p.batches.length, 0);
	const totalFeatures = plan.reduce((n, p) => n + p.batches.flat().length, 0);
	console.log(`rubric run`);
	console.log(`  cadence:      ${opts.aspect ? `(--aspect ${opts.aspect})` : opts.cadence}`);
	console.log(`  target:       ${describeTarget(recorded)}`);
	console.log(`  aspects:      ${plan.length}`);
	console.log(`  batches:      ${totalBatches}`);
	console.log(`  features:     ${totalFeatures}`);
	console.log(`  agent:        ${opts.agent}`);
	console.log(`  dry-run:      ${opts.dryRun}`);
	console.log('');
	for (const { aspect, batches, skipped, excluded } of plan) {
		const badge = aspect.promptSource === 'project' ? 'project' : (aspect.promptSource === 'default' ? 'default' : 'NO PROMPT');
		const parent = aspect.parent ? `, parent: ${aspect.parent.name}` : '';
		const level = aspect.data.level || aspect.parent?.data.level || 'any';
		console.log(`  ${aspect.name}  (prompt: ${badge}${parent}, level: ${level}, batch: ${aspect.data.batch || 8})`);
		if (excluded) console.log(`    excluded by target: ${excluded.join(', ')}`);
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
		runId, trigger, ...recorded, startedAt,
		tasks: descriptors.map(d => ({ id: d.id, aspect: d.aspect.name, features: d.features.map(f => f.code), log: d.log })),
	});
	await writeManifest(runsDir, manifest);
	console.log(`\nrun: ${runId}  (manifest: ${rel(join(runDir(runsDir, runId), 'manifest.md'), repoRoot)})`);

	await dispatchLoop({ opts, aspectsDir, runsDir, repoRoot, releases, target, manifest, descriptors, staleSet: new Set() });
}

// ── Resume: replay a prior run from its manifest ─────────────────────────────

async function resume(opts, ctx) {
	const { aspectsDir, runsDir, repoRoot, allAspects, allFeatures, releases } = ctx;
	const runId = await resolveRunId(runsDir, opts.resume);
	if (!runId) { console.error(`No resumable run found for "${opts.resume}".`); process.exit(1); }
	const manifest = await readManifest(runsDir, runId);
	if (!manifest) { console.error(`Run "${runId}" has no manifest.`); process.exit(1); }
	const target = exitOnUsageError(runTarget(opts, releases, manifest));
	manifest.target ??= 'all';

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
		if (!hasVerdicts(aspect)) {
			console.warn(`  ${task.id}: aspect "${task.aspect}" now has children (${aspect.children.join(', ')}) — skipping.`);
			setTaskStatus(manifest, task.id, 'skipped', { note: 'aspect now has children' });
			continue;
		}
		const features = task.features.map(c => findFeature(allFeatures, c)).filter(Boolean);
		const inTarget = features.filter(f => featureInScope(f, target, releases));
		if (inTarget.length < features.length && task.status !== 'done' && task.status !== 'skipped') {
			const dropped = features.filter(f => !inTarget.includes(f)).map(f => f.code);
			console.warn(`  ${task.id}: ${dropped.join(', ')} no longer in target ${targetName(target)} — not audited.`);
			if (inTarget.length === 0) {
				setTaskStatus(manifest, task.id, 'skipped', { note: `no features left in target ${targetName(target)}` });
				continue;
			}
		}
		descriptors.push({ id: task.id, aspect, features: inTarget, log: task.log });
	}

	manifest.status = 'in-progress';
	manifest.finished = null;
	await writeManifest(runsDir, manifest);

	const pendingCount = descriptors.filter(d => shouldDispatch(manifest, d, staleSet)).length;
	console.log(`Resuming run ${runId} — ${pendingCount} task(s) to (re)dispatch, ${manifest.tasks.length} total.`);
	console.log(`  target: ${describeTarget(recordedTarget(target, releases))}`);
	if (opts.dryRun) {
		for (const d of descriptors) {
			const t = manifest.tasks.find(x => x.id === d.id);
			console.log(`  ${shouldDispatch(manifest, d, staleSet) ? '→' : 'skip'} ${d.id} (${t.status})`);
		}
		return;
	}
	await dispatchLoop({ opts, aspectsDir, runsDir, repoRoot, releases, target, manifest, descriptors, staleSet });
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

async function dispatchLoop({ opts, aspectsDir, runsDir, repoRoot, releases, target, manifest, descriptors, staleSet }) {
	const dir = runDir(runsDir, manifest.run);
	const promptCache = new Map();   // aspect.name → { prompt, tpl, aspectHash }
	const ledgerCache = new Map();   // aspect.name → { ledger, snapshot }
	let failuresWithoutBlocker = 0;
	const recordsCoverage = target.kind !== 'release';
	if (!recordsCoverage) console.log('ledger not updated — audits for a later release do not record current coverage');

	for (const d of descriptors) {
		if (!shouldDispatch(manifest, d, staleSet)) continue;

		// Short-circuit: a confirmed global+blocking blocker halts the whole run.
		// --keep-going suppresses the halt (blocker is still recorded + injected
		// into later prompts) so a known, already-ticketed blocker can't stop the
		// sweep.
		const halt = opts.keepGoing ? null : haltingBlocker(manifest, staleSet);
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
		// --keep-going dispatches it anyway (the agent is warned via knownBlockers).
		const scoped = opts.keepGoing ? null : taskBlockedBy(manifest, manifest.tasks.find(t => t.id === d.id), staleSet);
		if (scoped) {
			setTaskStatus(manifest, d.id, 'blocked', { 'blocked-by': scoped.id });
			await writeManifest(runsDir, manifest);
			console.log(`\n⛔ ${d.id} skipped — blocked by ${scoped.id}.`);
			continue;
		}

		// Resolve aspect prompt/template once per aspect. The aspect hash is taken
		// with them, so the ledger records the instructions the audits were given
		// even if they are edited while a batch runs.
		if (!promptCache.has(d.aspect.name)) {
			try {
				promptCache.set(d.aspect.name, {
					prompt: await readPrompt(d.aspect),
					tpl: await readTicketTemplate(d.aspect),
					aspectHash: await resolveAspectHash(d.aspect),
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
			target,
			releases,
			knownBlockers,
		});

		console.log(`\n→ ${d.id}: ${d.features.map(f => f.code).join(', ')}`
			+ (knownBlockers.length ? `  (warned of ${knownBlockers.length} blocker(s))` : ''));
		const beforeAudit = snapshotBatch(d.features, d.aspect.name);
		const t0 = Date.now();
		const result = await runAgent({ agent: opts.agent, prompt, cwd: repoRoot, logFile });
		const secs = Math.round((Date.now() - t0) / 1000);
		const guardNote = await guardBatchEdits({ repoRoot, aspect: d.aspect, features: d.features, beforeAudit })
			.catch((e) => { console.error(`  post-batch guard failed: ${e.message}`); return undefined; });

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
				note: guardNote,
			});
		} else {
			const failure = result.timedOut ? 'idle timeout' : `exit ${result.exitCode}` + (existsSync(runLogPath) ? '' : ', no run log');
			setTaskStatus(manifest, d.id, 'failed', {
				finished: finishedAt,
				note: guardNote ? `${failure}; ${guardNote}` : failure,
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

		// Lift verdicts + evidence into the aspect's durable coverage ledger. A
		// blocked verdict leaves any prior record untouched (the audit didn't run).
		if (recordsCoverage && reported.verdicts?.length) {
			try {
				await updateLedger({
					aspectsDir, repoRoot, releases,
					aspect: d.aspect, aspectHash: promptCache.get(d.aspect.name).aspectHash, features: d.features, reported,
					runId: manifest.run, finishedAt,
					ledgerCache,
				});
			} catch (e) {
				console.error(`  ledger update failed for ${d.aspect.name}: ${e.message}`);
			}
		}

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

// ── Post-batch guard ─────────────────────────────────────────────────────────

/**
 * A development-time check after each batch: it warns and never fails the task.
 * The one edit an audit may make to its batch's feature files is its own
 * `aspects.<name>` block. Any other edit, and any spec error in those files
 * afterwards, is printed and returned as the task's manifest note (undefined
 * when there is none). The ledger still records the verdicts; the edit changes
 * the feature's fingerprint, so it shows as spec-stale on the other aspects.
 */
async function guardBatchEdits({ repoRoot, aspect, features, beforeAudit }) {
	const notes = [];
	// NOTE: batches are dispatched one at a time, so any edit this comparison finds is this batch's audit's; if dispatch is ever parallelised, a concurrent audit's write to its own aspects.<other> block would be reported here too — then leave every running aspect's block out of the comparison.
	const edited = editedOutsideBlock(beforeAudit, features, aspect.name);
	if (edited.length) {
		notes.push(`edited outside aspects.${aspect.name}: ${edited.join(', ')}`);
		console.warn(`  ⚠ ${notes.at(-1)}`);
	}
	const files = features.map(f => `${rel(f.path, repoRoot)}:`);
	const errors = validateSpec({ repoRoot, ...(await loadSpec(repoRoot)) })
		.filter(error => files.some(file => error.startsWith(file)));
	if (errors.length) {
		notes.push(`spec errors after audit: ${errors.join('; ')}`);
		console.warn('  ⚠ spec errors after audit:');
		for (const error of errors) console.warn(`    ${error}`);
	}
	return notes.length ? notes.join('; ') : undefined;
}

// ── Coverage ledger ──────────────────────────────────────────────────────────

/**
 * Lift a batch's non-blocked verdicts + evidence into the aspect's coverage
 * ledger, upserting one record per feature. The ledger is cached per aspect
 * across batches and rewritten after each of the aspect's batches. `aspectHash`
 * is the one taken when the aspect's prompt was read for dispatch. Each feature
 * is fingerprinted from its file as the audit left it. `pinned` is preserved
 * from any prior record; a `blocked` verdict is skipped so it never clobbers a
 * real audit.
 */
async function updateLedger({ aspectsDir, repoRoot, releases, aspect, aspectHash, features, reported, runId, finishedAt, ledgerCache }) {
	let entry = ledgerCache.get(aspect.name);
	if (!entry) {
		entry = { ledger: await readLedger(aspectsDir, aspect.name), snapshot: {} };
		ledgerCache.set(aspect.name, entry);
	}
	const { ledger, snapshot } = entry;
	const head = gitHead(repoRoot);
	const byCode = new Map(features.map(f => [f.code, f]));

	for (const v of reported.verdicts) {
		if (v.verdict === 'blocked') continue;    // audit didn't run — leave prior record
		const feat = byCode.get(v.code);
		if (!feat) continue;                        // code not in this batch (invented / mistyped)
		const existing = ledger.records[v.code];
		upsertRecord(ledger, v.code, {
			verdict: v.verdict,
			audited: finishedAt,
			'audited-commit': head,
			'feature-hash': featureFingerprintFor(feat, aspect, releases),
			'aspect-hash': aspectHash,
			evidence: reported.evidence?.[v.code] ?? [],
			run: runId,
			ticket: parseTicketPath(v.note),
			pinned: existing?.pinned === true,
		});
		snapshot[v.code] = { freshness: 'fresh', drift: 0 };   // just audited → fresh at write time
	}
	await writeLedger(aspectsDir, aspect.name, ledger, snapshot);
}

/** Pull a ticket path out of a verdict note like `gap (ticket: tickets/plan/x.md)`. */
function parseTicketPath(note) {
	if (!note) return null;
	const m = String(note).match(/ticket:\s*([^\s)]+)/i);
	return m ? m[1] : null;
}

/**
 * The features whose ledger record is missing or stale, ordered
 * most-churned-first. Freshness is derived here (never stored) by `cellFor`, as
 * `coverage.mjs` and the UI derive it. NB: this is unrelated to the runner's
 * `staleSet` (unverified blockers) — different axis, deliberately different names.
 */
async function staleFeatures(features, aspect, { aspectsDir, repoRoot, releases }) {
	const { records } = await readLedger(aspectsDir, aspect.name);
	const staleness = resolveStaleness(aspect.data);
	const aspectHash = await resolveAspectHash(aspect);

	const scored = [];
	for (const feature of features) {
		const cell = cellFor({ feature, aspect, record: records[feature.code] ?? null, aspectHash, staleness, releases, repoRoot });
		if (isStale(cell.state)) scored.push({ feature, priority: cell.priority });
	}
	scored.sort((a, b) => b.priority - a.priority);
	return scored.map(s => s.feature);
}

/** A usage error from resolving the run's target: printed, then exit 2, as `parseArgs` does for its own. */
function exitOnUsageError(result) {
	if (!result.error) return result;
	console.error(result.error);
	process.exit(2);
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
