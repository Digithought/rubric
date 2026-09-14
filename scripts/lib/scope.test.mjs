import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	capabilityDueWithFeature, capabilityScope, describeTarget, featureInScope, recordedTarget, resolveTarget,
} from './scope.mjs';

// Contract: agent-rules/principles.md § Current release assumption — the first release is current and anything
// untagged is due in it — as agent-rules/runner.md § Release scoping narrows a run to one release's work.

const LIST = { present: true, current: 'BETA', codes: ['BETA', 'GA', 'LATER'], errors: [], unreadable: false };
const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };
const EMPTY = { ...OFF, present: true };

const cap = (text, target = null) => ({ text, target, line: null });
const feature = (code, target, ...capabilities) => ({ code, target, capabilities });

// A current feature with a GA and a LATER capability, a GA feature with a LATER capability, and a LATER feature.
const PCK = feature('SCN-PCK', null, cap('Pick an entity'), cap('Pick through terrain', 'GA'), cap('Pick by voice', 'LATER'));
const KML = feature('EXP-KML', 'GA', cap('Export to KML'), cap('Export styles', 'LATER'));
const VR = feature('CAM-VR', 'LATER', cap('Walk in VR'));
const FEATURES = [PCK, KML, VR];

const inScope = (value, list = LIST) => FEATURES.filter(f => featureInScope(f, resolveTarget(value, list), list)).map(f => f.code);
/** A feature's capability scope as text: audited texts, deferred `text → CODE`, and `only`. */
function scopeOf(f, value, list = LIST) {
	const { audit, deferred, only } = capabilityScope(f, resolveTarget(value, list), list);
	return { audit: audit.map(c => c.text), deferred: deferred.map(d => `${d.cap.text} → ${d.code}`), only };
}

test('resolveTarget: current when omitted, named, or given the current code; a later code by its rank; all', () => {
	const current = { kind: 'current', code: 'BETA', rank: 0 };

	assert.deepEqual([null, 'current', 'BETA'].map(value => resolveTarget(value, LIST)), [current, current, current]);
	assert.deepEqual(resolveTarget('LATER', LIST), { kind: 'release', code: 'LATER', rank: 2 });
	assert.deepEqual(resolveTarget('all', LIST), { kind: 'all', code: null, rank: null });
});

test('resolveTarget: a code the list does not hold is an error naming the codes; with no list or an empty one only current and all resolve', () => {
	assert.deepEqual(resolveTarget('RC', LIST), { error: '--target RC is not a code in tickets/releases.md (BETA, GA, LATER)' });
	for (const list of [OFF, EMPTY]) {
		assert.deepEqual(resolveTarget('GA', list), { error: '--target GA: no release list (or it is empty) — use current or all' });
		assert.deepEqual([resolveTarget('current', list), resolveTarget('all', list)], [{ kind: 'current', code: null, rank: 0 }, { kind: 'all', code: null, rank: null }]);
	}
});

test('current: features due now, their due capabilities audited and every later one deferred with its release', () => {
	assert.deepEqual(inScope('current'), ['SCN-PCK']);
	assert.deepEqual(scopeOf(PCK, 'current'), { audit: ['Pick an entity'], deferred: ['Pick through terrain → GA', 'Pick by voice → LATER'], only: false });
});

test('a later release: features deferred to it, with later capabilities deferred; earlier features only for their capabilities deferred to it', () => {
	assert.deepEqual(inScope('GA'), ['SCN-PCK', 'EXP-KML']);
	assert.deepEqual(scopeOf(KML, 'GA'), { audit: ['Export to KML'], deferred: ['Export styles → LATER'], only: false });
	assert.deepEqual(scopeOf(PCK, 'GA'), { audit: ['Pick through terrain'], deferred: [], only: true });

	assert.deepEqual(inScope('LATER'), ['SCN-PCK', 'EXP-KML', 'CAM-VR']);
	assert.deepEqual(scopeOf(KML, 'LATER'), { audit: ['Export styles'], deferred: [], only: true });
	assert.deepEqual(scopeOf(VR, 'LATER'), { audit: ['Walk in VR'], deferred: [], only: false });
});

test('all: every feature and every capability, nothing deferred', () => {
	assert.deepEqual(inScope('all'), ['SCN-PCK', 'EXP-KML', 'CAM-VR']);
	assert.deepEqual(scopeOf(PCK, 'all'), { audit: ['Pick an entity', 'Pick through terrain', 'Pick by voice'], deferred: [], only: false });
});

test('a current feature whose capabilities are all deferred stays in scope for current, every capability deferred', () => {
	const select = feature('SCN-SEL', null, cap('Box select', 'GA'));

	assert.equal(featureInScope(select, resolveTarget('current', LIST), LIST), true);
	assert.deepEqual(scopeOf(select, 'current'), { audit: [], deferred: ['Box select → GA'], only: false });
});

test('a code the list does not hold counts as current, on a feature and on a capability', () => {
	const shipped = feature('SCN-TAG', 'RC', cap('Tag entities'), cap('Tag in bulk', 'RC'));
	const underGa = feature('EXP-SVG', 'GA', cap('Export to SVG'), cap('Export layers', 'RC'));

	assert.equal(featureInScope(shipped, resolveTarget('current', LIST), LIST), true);
	assert.equal(featureInScope(shipped, resolveTarget('GA', LIST), LIST), false);
	assert.deepEqual(scopeOf(shipped, 'current'), { audit: ['Tag entities', 'Tag in bulk'], deferred: [], only: false });
	assert.deepEqual(scopeOf(underGa, 'GA'), { audit: ['Export to SVG'], deferred: ['Export layers → RC'], only: false }, 'not the target\'s, so not audited');
});

test('with no release list, or an empty one, everything is current and nothing is deferred', () => {
	for (const list of [OFF, EMPTY]) {
		assert.deepEqual(inScope('current', list), ['SCN-PCK', 'EXP-KML', 'CAM-VR']);
		assert.deepEqual(scopeOf(PCK, 'current', list), { audit: ['Pick an entity', 'Pick through terrain', 'Pick by voice'], deferred: [], only: false });
	}
});

test('capabilityDueWithFeature: due when the capability\'s tag ranks no later than its feature\'s, an unlisted code ranking as current', () => {
	const due = (featureTarget, capTarget, releases = LIST) => capabilityDueWithFeature({ target: featureTarget }, { target: capTarget }, releases);

	assert.deepEqual(
		[due(null, null), due(null, 'BETA'), due(null, 'GA'), due('GA', 'GA'), due('GA', null), due('GA', 'RC'), due('RC', 'GA'), due(null, 'GA', OFF)],
		[true, true, false, true, true, true, false, true],
	);
});

test('recordedTarget and describeTarget: the name, current release and list presence a manifest records, and how the plan header shows them', () => {
	const recorded = (value, list = LIST) => recordedTarget(resolveTarget(value, list), list);

	assert.deepEqual([recorded('BETA'), recorded('GA'), recorded('all', OFF)], [
		{ target: 'current', release: 'BETA', releaseList: 'present' },
		{ target: 'GA', release: 'BETA', releaseList: 'present' },
		{ target: 'all', release: null, releaseList: 'absent' },
	]);
	assert.deepEqual([recorded('current'), recorded('GA'), recorded('all'), recorded('current', OFF), recorded('current', EMPTY)].map(describeTarget), [
		'current (release BETA)',
		'GA',
		'all',
		'current (no tickets/releases.md — everything is current)',
		'current (tickets/releases.md lists no release — everything is current)',
	]);
});
