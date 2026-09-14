import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planAspects } from './plan.mjs';

// Contract: agent-rules/principles.md § Aspect annotations, surfaces and hierarchy and schema.md § Surfaces, parent and
// annotation — a parent with children has no verdicts, so a run plans its children, each by its own cadence and
// batch; and the --aspect, --max-aspects and --max-batches options as scripts/lib/cli.mjs documents them.

const OPTS = { cadence: 'weekly', aspect: null, features: null, maxBatches: Infinity, maxAspects: Infinity, staleOnly: false };

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

const FEATURES = [
	{ code: 'SCN', level: 'root', data: {}, surfaces: null },
	{ code: 'SCN-PCK', level: 'leaf', data: {}, surfaces: null },
	{ code: 'SCN-SEL', level: 'leaf', data: {}, surfaces: null },
];

/** The plan for `opts` as `[aspect name, batches of codes]`. */
async function planned(opts = {}) {
	const plan = await planAspects({ aspects: aspects(), features: FEATURES, opts: { ...OPTS, ...opts } });
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

	const plan = await planAspects({ aspects: all, features, opts: { ...OPTS, aspect: 'tooltips' } });

	assert.deepEqual(plan.map(({ aspect, batches, skipped }) => [aspect.name, batches, skipped]), [
		['tooltips', [], 'no features match level/applies-to/surfaces/--features (parent ux\'s included)'],
	]);
});
