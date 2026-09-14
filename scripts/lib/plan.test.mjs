import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planAspects } from './plan.mjs';
import { resolveTarget } from './scope.mjs';

// Contract: agent-rules/principles.md § Aspect annotations, surfaces and hierarchy and schema.md § Surfaces, parent and
// annotation — a parent with children has no verdicts, so a run plans its children, each by its own cadence and
// batch; the --aspect, --max-aspects and --max-batches options as scripts/lib/cli.mjs documents them; and
// agent-rules/runner.md § Release scoping — a run plans only the features in its --target.

const OPTS = { cadence: 'weekly', aspect: null, features: null, maxBatches: Infinity, maxAspects: Infinity, staleOnly: false };
const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };
const LIST = { present: true, current: 'BETA', codes: ['BETA', 'GA', 'LATER'], errors: [], unreadable: false };
const CURRENT = resolveTarget('current', OFF);

/** Active aspects as discovery gives them, sorted by name: `ux` (leaf) is the parent of `menus` (on-demand, batch 1) and `tooltips`. */
function aspects() {
	const aspect = (name, data = {}, parent = null) => ({ name, data: { cadence: ['weekly'], ...data }, parent, children: [] });
	const ux = aspect('ux', { level: 'leaf' });
	const all = [
		aspect('code'),
		aspect('help', { level: 'root' }),
		aspect('menus', { cadence: ['on-demand'], batch: 1 }, ux),
		aspect('tooltips', {}, ux),
		ux,
	];
	ux.children = ['menus', 'tooltips'];
	return all;
}

const feature = (code, level, target = null, capabilities = []) => ({ code, level, data: {}, surfaces: null, target, capabilities });
const FEATURES = [feature('SCN', 'root'), feature('SCN-PCK', 'leaf'), feature('SCN-SEL', 'leaf')];

/** The plan for `opts` as `[aspect name, batches of codes]`. */
async function planned(opts = {}) {
	const plan = await planAspects({ aspects: aspects(), features: FEATURES, opts: { ...OPTS, ...opts }, target: CURRENT, releases: OFF });
	return plan.map(({ aspect, batches }) => [aspect.name, batches.map(batch => batch.map(f => f.code))]);
}
const names = async (opts) => (await planned(opts)).map(([name]) => name);

test('planAspects: a parent with children is never planned; each child runs by its own cadence, over the features its parent admits', async () => {
	assert.deepEqual(await planned(), [
		['code', [['SCN', 'SCN-PCK', 'SCN-SEL']]],
		['help', [['SCN']]],
		['tooltips', [['SCN-PCK', 'SCN-SEL']]],
	]);
	assert.deepEqual(await names({ cadence: 'any' }), ['code', 'help', 'menus', 'tooltips']);
});

test('planAspects: --aspect <parent> runs its children, cadence not applied, each by its own batch:; --aspect <child> runs only that child', async () => {
	assert.deepEqual(await planned({ aspect: 'ux' }), [
		['menus', [['SCN-PCK'], ['SCN-SEL']]],
		['tooltips', [['SCN-PCK', 'SCN-SEL']]],
	]);
	assert.deepEqual(await names({ aspect: 'menus' }), ['menus']);
});

test('planAspects: --max-aspects counts the aspects a run dispatches, children included', async () => {
	assert.deepEqual(await names({ cadence: 'any', maxAspects: 3 }), ['code', 'help', 'menus']);
	assert.deepEqual(await names({ aspect: 'ux', maxAspects: 1 }), ['menus']);
});

test('planAspects: --max-batches caps batches across the whole plan, in plan order', async () => {
	assert.deepEqual(await planned({ aspect: 'ux', maxBatches: 2 }), [['menus', [['SCN-PCK'], ['SCN-SEL']]], ['tooltips', []]]);
});

test('planAspects: a child whose surfaces and its parent\'s share no feature plans an empty audit with a reason, not an error', async () => {
	const all = aspects();
	const tooltips = all.find(a => a.name === 'tooltips');
	tooltips.data.surfaces = ['api'];
	tooltips.parent.data.surfaces = ['web'];
	const features = [{ ...FEATURES[1], surfaces: ['web'] }, { ...FEATURES[2], surfaces: ['api'] }];

	const plan = await planAspects({ aspects: all, features, opts: { ...OPTS, aspect: 'tooltips' }, target: CURRENT, releases: OFF });

	assert.deepEqual(plan.map(({ aspect, batches, skipped }) => [aspect.name, batches, skipped]), [
		['tooltips', [], 'no features match level/applies-to/surfaces/--features within target current (parent ux\'s included)'],
	]);
});

// SCN is current; SCN-PCK is current with a capability deferred to GA; SCN-SEL is deferred to GA, SCN-VR to LATER.
const RELEASED = [
	feature('SCN', 'root'),
	feature('SCN-PCK', 'leaf', null, [{ text: 'Pick an entity', target: null, line: null }, { text: 'Pick by voice', target: 'GA', line: null }]),
	feature('SCN-SEL', 'leaf', 'GA'),
	feature('SCN-VR', 'leaf', 'LATER'),
];

/** The release-scoped plan for `opts` as `[aspect name, batches of codes, skipped, excluded]`. */
async function plannedFor(target, opts = {}) {
	const plan = await planAspects({ aspects: aspects(), features: RELEASED, opts: { ...OPTS, ...opts }, target: resolveTarget(target, LIST), releases: LIST });
	return plan.map(({ aspect, batches, skipped, excluded }) => [aspect.name, batches.map(batch => batch.map(f => f.code)), skipped, excluded]);
}

test('planAspects: a target keeps only the features in it — current ones, or those deferred to a later release and earlier ones with a capability deferred to it', async () => {
	assert.deepEqual(await plannedFor('current', { aspect: 'code' }), [['code', [['SCN', 'SCN-PCK']], undefined, undefined]]);
	assert.deepEqual(await plannedFor('GA', { aspect: 'code' }), [['code', [['SCN-PCK', 'SCN-SEL']], undefined, undefined]]);
	assert.deepEqual(await plannedFor('all', { aspect: 'code' }), [['code', [['SCN', 'SCN-PCK', 'SCN-SEL', 'SCN-VR']], undefined, undefined]]);
});

test('planAspects: a --features code the target leaves out is listed as excluded, per aspect that applies to it, and a skip names the target', async () => {
	assert.deepEqual(await plannedFor('GA', { features: ['SCN', 'SCN-SEL'] }), [
		['code', [['SCN-SEL']], undefined, ['SCN']],
		['help', [], 'no features match level/applies-to/surfaces/--features within target GA', ['SCN']],
		['tooltips', [['SCN-SEL']], undefined, undefined],
	]);
});
