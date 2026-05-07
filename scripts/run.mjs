#!/usr/bin/env node
/**
 * Rubric runner — orchestrates aspect audits over the feature inventory.
 *
 * For a given trigger (cadence) it:
 *   1. Discovers active aspects under `aspects/<name>/`.
 *   2. Filters them by cadence (and optional --aspect override).
 *   3. For each aspect, walks `features/`, applies the aspect's `level` and
 *      `applies-to`, then splits into batches per `batch:`.
 *   4. Dispatches one audit agent per batch, passing it a prompt that
 *      points at the relevant feature files and a target run-log path.
 *   5. The agent owns all artifacts: gap tickets land in the project's
 *      ticket queue; the run log lands in `.runs/`.
 *
 * The runner does not parse agent stdout — it only dispatches. Verdicts and
 * ticket file paths flow through the agent's run log, which the UI reads.
 */

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, stat } from 'node:fs/promises';

import { parseArgs } from './lib/cli.mjs';
import { discoverActiveAspects, filterByCadence, readPrompt, readTicketTemplate } from './lib/aspects.mjs';
import { walkFeatures, filterFeatures } from './lib/features.mjs';
import { batchFeatures } from './lib/batch.mjs';
import { buildAuditPrompt } from './lib/prompt.mjs';
import { runAgent } from './lib/agent.mjs';

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

	// ── Discover active aspects ──
	let aspects = await discoverActiveAspects(aspectsDir, defaultsDir);
	if (aspects.length === 0) {
		console.log(`No aspects activated. Create a folder under ${rel(aspectsDir, repoRoot)}/<name>/ with an aspect.md to activate one.`);
		console.log(`See: rubric/agent-rules/add-aspect.md`);
		return;
	}

	if (opts.aspect) {
		aspects = aspects.filter(a => a.name === opts.aspect);
		if (aspects.length === 0) {
			console.error(`Aspect "${opts.aspect}" is not active. Active aspects:`);
			(await discoverActiveAspects(aspectsDir, defaultsDir)).forEach(a => console.error(`  ${a.name}`));
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

	// ── Walk features once; reuse across aspects ──
	const allFeatures = await walkFeatures(featuresDir);
	if (allFeatures.length === 0) {
		console.error(`No features found under ${rel(featuresDir, repoRoot)}/. Did you run rubric init?`);
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
		const size = aspect.data.batch || 8;
		const batches = batchFeatures(features, size);
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

	// ── Dispatch ──
	const runId = `${tsCompact()}-${process.pid}`;
	for (const { aspect, batches } of plan) {
		if (batches.length === 0) continue;
		let aspectPromptBody;
		try { aspectPromptBody = await readPrompt(aspect); }
		catch (e) {
			console.error(`  ${aspect.name}: ${e.message} — skipping.`);
			continue;
		}
		const ticketTemplateBody = await readTicketTemplate(aspect);
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const startedAt = new Date().toISOString();
			const stamp = startedAt.replace(/[:.]/g, '-');
			const runLogPath = join(runsDir, `${stamp}-${aspect.name}-batch${i + 1}.md`);
			const logFile = runLogPath.replace(/\.md$/, '.agent.log');
			const prompt = buildAuditPrompt({
				aspect,
				aspectPromptBody,
				ticketTemplateBody,
				features: batch,
				repoRoot,
				runLogPath,
				runId,
				runStartedAt: startedAt,
			});
			console.log(`\n→ ${aspect.name} batch ${i + 1}/${batches.length}: ${batch.map(f => f.code).join(', ')}`);
			const t0 = Date.now();
			const result = await runAgent({
				agent: opts.agent,
				prompt,
				cwd: repoRoot,
				logFile,
			});
			const secs = Math.round((Date.now() - t0) / 1000);
			console.log(`  exit ${result.exitCode}${result.timedOut ? ' (idle timeout)' : ''} in ${secs}s — log: ${rel(logFile, repoRoot)}`);
		}
	}
	console.log('\nDone.');
}

function rel(absPath, repoRoot) {
	const r = absPath.startsWith(repoRoot) ? absPath.slice(repoRoot.length + 1) : absPath;
	return r.split('\\').join('/');
}

function tsCompact() {
	return new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, 'T').replace(/Z$/, 'Z');
}

main().catch(err => {
	console.error('rubric runner failed:', err);
	process.exit(1);
});
