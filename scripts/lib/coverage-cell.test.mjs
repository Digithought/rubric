import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { discoverActiveAspects } from './aspects.mjs';
import { cellFor, featureFingerprintFor, resolveAspectHash } from './coverage-cell.mjs';
import { walkFeatures } from './features.mjs';
import { resolveStaleness } from './freshness.mjs';
import { withTree } from './test-tree.mjs';

// Contract: schema.md § Hashes and § Freshness — a record goes spec-stale exactly when its feature
// changes as it bears on the aspect's audit, and criteria-stale when the instructions its audit uses change,
// a child's parent's included.

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const PICKING = ['status: planned', 'capabilities:', '  - Pick an entity', '  - text: Export to KML', '    target: GA'];
const PATH = 'features/SCN - Scene.md';

const BETA_GA = { present: true, current: 'BETA', codes: ['BETA', 'GA'], errors: [], unreadable: false };
const GA_ONLY = { ...BETA_GA, current: 'GA', codes: ['GA'] };
const performance = { name: 'performance', data: { annotation: { budget: { type: 'string', default: '5 s' } } } };
const staleness = resolveStaleness({});

/** Record an audit of SCN against `PICKING` under `BETA_GA`, rewrite the file as `after`, and derive the cell under `releases`. */
async function stateAfter(after, releases = BETA_GA) {
	return withTree({ [PATH]: fm(...PICKING) }, async (root) => {
		const [audited] = await walkFeatures(join(root, 'features'));
		const record = { verdict: 'covered', 'feature-hash': featureFingerprintFor(audited, performance, BETA_GA), 'aspect-hash': 'a1', evidence: [] };
		await writeFile(join(root, PATH), fm(...after), 'utf-8');
		const [feature] = await walkFeatures(join(root, 'features'));
		return cellFor({ feature, aspect: performance, record, aspectHash: 'a1', staleness, releases, repoRoot: root }).state;
	});
}

test('cellFor: fresh after edits that do not bear on the aspect — another aspect\'s block, a top-level target:, surfaces the aspect does not audit', async () => {
	assert.equal(await stateAfter([...PICKING, 'aspects:', '  help:', '    depth: reference']), 'fresh');
	assert.equal(await stateAfter([...PICKING, 'target: BETA']), 'fresh');
	assert.equal(await stateAfter([...PICKING, 'surfaces: [web]']), 'fresh');
});

test('cellFor: spec-stale after an edit to the aspect\'s own block or a capability, or when the release a deferred capability waits for ships', async () => {
	assert.equal(await stateAfter([...PICKING, 'aspects:', '  performance:', '    budget: 2 s']), 'spec-stale');
	assert.equal(await stateAfter(PICKING.map(line => line.replace('Pick an entity', 'Pick entities'))), 'spec-stale');
	assert.equal(await stateAfter(PICKING, GA_ONLY), 'spec-stale');
});

test('cellFor: a pair with no record is missing', async () => {
	await withTree({ [PATH]: fm(...PICKING) }, async (root) => {
		const [feature] = await walkFeatures(join(root, 'features'));

		assert.deepEqual(
			cellFor({ feature, aspect: performance, record: null, aspectHash: 'a1', staleness, releases: BETA_GA, repoRoot: root }),
			{ state: 'missing', drift: 0, unverifiable: false, priority: Infinity, verdict: null },
		);
	});
});

test('featureFingerprintFor: fingerprints the file as it reads now, even through a record walked before an audit wrote its own block; null when unreadable', async () => {
	await withTree({ [PATH]: fm(...PICKING) }, async (root) => {
		const [walkedBefore] = await walkFeatures(join(root, 'features'));
		await writeFile(join(root, PATH), fm(...PICKING, 'aspects:', '  performance:', '    budget: 2 s'), 'utf-8');
		const [walkedAfter] = await walkFeatures(join(root, 'features'));

		assert.equal(featureFingerprintFor(walkedBefore, performance, BETA_GA), featureFingerprintFor(walkedAfter, performance, BETA_GA));
		assert.equal(featureFingerprintFor({ ...walkedAfter, path: join(root, 'features', 'gone.md') }, performance, BETA_GA), null);
	});
});

const sha12 = (text) => createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12);

test('resolveAspectHash: a child\'s hash covers its parent\'s prompt and aspect.md, so editing either criteria-stales the child; a top-level aspect hashes its aspect.md, prompt and template', async () => {
	const CODE = fm('name: code');
	const files = {
		'aspects/ux/aspect.md': fm('name: ux', 'level: leaf'),
		'aspects/ux/prompt.md': 'Judge the interface.\n',
		'aspects/tooltips/aspect.md': fm('name: tooltips', 'parent: ux'),
		'aspects/tooltips/prompt.md': 'Also check tooltips.\n',
		'aspects/code/aspect.md': CODE,
		'aspects/code/prompt.md': 'Find the code.\n',
	};
	await withTree(files, async (root) => {
		const hashOf = async (name) => resolveAspectHash((await discoverActiveAspects(join(root, 'aspects'), join(root, 'defaults'))).find(a => a.name === name));
		const original = await hashOf('tooltips');
		await writeFile(join(root, 'aspects/ux/prompt.md'), 'Judge the interface, reworded.\n', 'utf-8');
		const afterPrompt = await hashOf('tooltips');
		await writeFile(join(root, 'aspects/ux/aspect.md'), fm('name: ux', 'level: leaf', 'batch: 4'), 'utf-8');

		assert.notEqual(afterPrompt, original);
		assert.notEqual(await hashOf('tooltips'), afterPrompt);
		assert.equal(await hashOf('code'), sha12(`${CODE}\nFind the code.\n\n`), 'aspect.md, prompt, and an absent template as empty');
	});
});
