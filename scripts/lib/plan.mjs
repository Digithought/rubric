/**
 * Planning a run: which aspects it audits and the batches each one gets. Pure
 * apart from the `narrowToStale` hook run.mjs passes for `--stale-only`, so what
 * a run would dispatch can be tested without an agent, a ledger or git.
 */

import { aspectsNamed, filterByCadence, hasVerdicts } from './aspects.mjs';
import { batchFeatures } from './batch.mjs';
import { filterFeatures } from './features.mjs';

/**
 * The aspects a run audits, before `--max-aspects`: `--aspect <name>` (a
 * parent's children; cadence is not applied), else every aspect with verdicts
 * whose cadence includes `--cadence`. A parent with children is never among
 * them — it has no verdicts; its children carry its audits.
 */
export function selectAspects(aspects, opts) {
	return opts.aspect
		? aspectsNamed(aspects, opts.aspect)
		: filterByCadence(aspects.filter(hasVerdicts), opts.cadence);
}

/**
 * The run's plan: one `{ aspect, batches, skipped? }` per selected aspect, in
 * selection order, up to `--max-aspects`. An aspect's batches hold the features
 * it applies to, limited to `--features`, narrowed by `narrowToStale` under
 * `--stale-only`, and split per its `batch:`; `--max-batches` caps the batches
 * across the whole plan.
 *
 * @param {{ aspects: object[], features: object[], opts: object,
 *   narrowToStale?: (features: object[], aspect: object) => Promise<object[]> }} input
 *   `aspects` is every active aspect; `opts` is `parseArgs`' result.
 */
export async function planAspects({ aspects, features, opts, narrowToStale }) {
	let selected = selectAspects(aspects, opts);
	if (Number.isFinite(opts.maxAspects)) selected = selected.slice(0, opts.maxAspects);
	const plan = [];
	for (const aspect of selected) {
		let audited = filterFeatures(features, aspect);
		if (opts.features) {
			const codes = new Set(opts.features);
			audited = audited.filter(f => codes.has(f.code));
		}
		if (opts.staleOnly && narrowToStale && audited.length) audited = await narrowToStale(audited, aspect);
		if (audited.length === 0) plan.push({ aspect, batches: [], skipped: skipReason(aspect, opts) });
		else plan.push({ aspect, batches: batchFeatures(audited, aspect.data.batch || 8) });
	}
	capBatches(plan, opts.maxBatches);
	return plan;
}

function skipReason(aspect, opts) {
	if (opts.staleOnly) return 'nothing stale (all fresh) or no features match';
	const parent = aspect.parent ? ` (parent ${aspect.parent.name}'s included)` : '';
	return `no features match level/applies-to/surfaces/--features${parent}`;
}

/** Trim batches, in plan order, so the whole plan holds at most `maxBatches`. */
function capBatches(plan, maxBatches) {
	let remaining = maxBatches;
	for (const item of plan) {
		if (!Number.isFinite(remaining)) return;
		if (remaining <= 0) { item.batches = []; continue; }
		if (item.batches.length > remaining) item.batches = item.batches.slice(0, remaining);
		remaining -= item.batches.length;
	}
}
