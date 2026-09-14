/**
 * Release scope: which features and capabilities a run covers, given the
 * release list and the run's `--target`. The model is in
 * `agent-rules/principles.md` § Current release assumption; what each target
 * covers is tabled in `agent-rules/runner.md` § Release scoping.
 *
 * A rank is `dueRank`'s: no tag or the current code → 0, a later code → its
 * position in the list, a code the list does not hold → 0 (most likely a
 * release just shipped, before its tags were stripped). A capability ranks by
 * its own tag, else its feature's effective one.
 */

import { RELEASES_FILE, dueRank } from './releases.mjs';

/**
 * @typedef {{ kind: 'current'|'release'|'all', code: string|null, rank: number|null }} Target
 *   `code` is the current release for `current` (null with no release list), the
 *   release for `release`, null for `all`; `rank` is null for `all`.
 */

export function featureRank(feature, list) {
	return dueRank(list, feature.target);
}

export function capabilityRank(feature, cap, list) {
	return dueRank(list, cap.target ?? feature.target);
}

/**
 * A `--target` value — `current` (or none), `all`, or a release code — as a
 * Target, or `{ error }` for a code the list does not hold. Naming the current
 * code is `current`.
 */
export function resolveTarget(value, list) {
	if (value === 'all') return { kind: 'all', code: null, rank: null };
	const current = { kind: 'current', code: list.current, rank: 0 };
	if (value == null || value === 'current') return current;
	if (list.codes.length === 0) return { error: `--target ${value}: no release list (or it is empty) — use current or all` };
	const rank = list.codes.indexOf(value);
	if (rank === -1) return { error: `--target ${value} is not a code in ${RELEASES_FILE} (${list.codes.join(', ')})` };
	return rank === 0 ? current : { kind: 'release', code: value, rank };
}

/** How a manifest names a target: `current`, `all`, or the release code. */
export function targetName(target) {
	return target.kind === 'release' ? target.code : target.kind;
}

/** Whether a run under `target` audits the feature: it ranks at the target, or earlier with a capability at it. */
export function featureInScope(feature, target, list) {
	if (target.kind === 'all') return true;
	const rank = featureRank(feature, list);
	return rank === target.rank
		|| (rank < target.rank && feature.capabilities.some(cap => capabilityRank(feature, cap, list) === target.rank));
}

/**
 * What a run under `target` audits of a feature in scope. `audit` holds the
 * capabilities ranking at the target. `only` is true for a feature earlier than
 * the target, which is audited for those capabilities alone; otherwise
 * `deferred` holds every other capability with the release it is due in — for
 * a valid spec, the later ones.
 *
 * @returns {{ audit: object[], deferred: Array<{ cap: object, code: string|null }>, only: boolean }}
 */
export function capabilityScope(feature, target, list) {
	if (target.kind === 'all') return { audit: feature.capabilities, deferred: [], only: false };
	const audit = feature.capabilities.filter(cap => capabilityRank(feature, cap, list) === target.rank);
	if (featureRank(feature, list) < target.rank) return { audit, deferred: [], only: true };
	const deferred = feature.capabilities
		.filter(cap => !audit.includes(cap))
		.map(cap => ({ cap, code: cap.target ?? feature.target }));
	return { audit, deferred, only: false };
}

/**
 * Whether a capability is due with its feature: it ranks no later than the
 * feature. A plain capability has no tag of its own, so it always is.
 */
export function capabilityDueWithFeature(feature, cap, list) {
	return capabilityRank(feature, cap, list) <= featureRank(feature, list);
}

/**
 * A target as a run manifest records it (schema.md § Run-manifest schema): its
 * name, the current release, and whether a release list exists at all.
 */
export function recordedTarget(target, list) {
	return { target: targetName(target), release: list.current, releaseList: list.present ? 'present' : 'absent' };
}

/** A recorded target as the plan header and the manifest heading show it. */
export function describeTarget({ target, release, releaseList }) {
	if (target !== 'current') return target;
	if (release != null) return `current (release ${release})`;
	return releaseList === 'present'
		? `current (${RELEASES_FILE} lists no release — everything is current)`
		: `current (no ${RELEASES_FILE} — everything is current)`;
}
