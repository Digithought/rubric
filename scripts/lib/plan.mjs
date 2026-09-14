/**
 * Planning a run: which aspects it audits and the batches each one gets. Pure
 * apart from the `narrowToStale` hook run.mjs passes for `--stale-only`, so what
 * a run would dispatch can be tested without an agent, a ledger or git.
 */

import { aspectsNamed, filterByCadence, hasVerdicts } from './aspects.mjs';
import { batchFeatures } from './batch.mjs';
import { filterFeatures } from './features.mjs';
import { featureInScope, targetName } from './scope.mjs';

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
 * The run's plan: one `{ aspect, batches, skipped?, excluded? }` per selected
 * aspect, in selection order, up to `--max-aspects`. An aspect's batches hold
 * the features it applies to, limited to `--features` and to the release
 * `target` (scope.mjs), narrowed by `narrowToStale` under `--stale-only`, and
 * split per its `batch:`; `--max-batches` caps the batches across the whole
 * plan. `excluded` lists the codes `--features` names that the aspect applies
 * to but the target leaves out, so a plan never drops a named feature silently.
 *
 * @param {{ aspects: object[], features: object[], opts: object, target: object, releases: object,
 *   narrowToStale?: (features: object[], aspect: object) => Promise<object[]> }} input
 *   `aspects` is every active aspect; `opts` is `parseArgs`' result, `target`
 *   `runTarget`'s and `releases` `readReleaseList`'s.
 */
export async function planAspects({ aspects, features, opts, target, releases, narrowToStale }) {
	let selected = selectAspects(aspects, opts);
	if (Number.isFinite(opts.maxAspects)) selected = selected.slice(0, opts.maxAspects);
	const plan = [];
	for (const aspect of selected) {
		let applicable = filterFeatures(features, aspect);
		if (opts.features) {
			const codes = new Set(opts.features);
			applicable = applicable.filter(f => codes.has(f.code));
		}
		const [inTarget, outOfTarget] = partition(applicable, f => featureInScope(f, target, releases));
		let audited = inTarget;
		if (opts.staleOnly && narrowToStale && audited.length) audited = await narrowToStale(audited, aspect);
		const item = audited.length === 0
			? { aspect, batches: [], skipped: skipReason(aspect, opts, target) }
			: { aspect, batches: batchFeatures(audited, aspect.data.batch || 8) };
		if (opts.features && outOfTarget.length) item.excluded = outOfTarget.map(f => f.code);
		plan.push(item);
	}
	capBatches(plan, opts.maxBatches);
	return plan;
}

function skipReason(aspect, opts, target) {
	const within = `within target ${targetName(target)}`;
	if (opts.staleOnly) return `nothing stale (all fresh) or no features match ${within}`;
	const parent = aspect.parent ? ` (parent ${aspect.parent.name}'s included)` : '';
	return `no features match level/applies-to/surfaces/--features ${within}${parent}`;
}

/** `[kept, rest]`: the items `keep` accepts and the others, each in order. */
function partition(items, keep) {
	const kept = [];
	const rest = [];
	for (const item of items) (keep(item) ? kept : rest).push(item);
	return [kept, rest];
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
