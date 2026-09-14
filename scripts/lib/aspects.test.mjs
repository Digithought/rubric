import assert from 'node:assert/strict';
import { test } from 'node:test';

import { annotationSchema, resolveAnnotation } from './aspects.mjs';

// Contract: schema.md § Aspect front-matter (annotation:) and § Feature front-matter (aspects:) —
// defaults overlaid by the feature's own block, keys in schema order.

const performance = {
	name: 'performance',
	data: {
		annotation: {
			budget: { type: 'string', default: 'opens within 5 s' },
			workload: { type: 'string' },
			depth: { type: 'enum', values: ['overview', 'reference'], default: 'overview' },
			strict: { type: 'boolean', default: null },
		},
	},
};
const feature = (aspects) => ({ code: 'SCN', data: aspects === undefined ? {} : { aspects } });

test('resolveAnnotation: a feature without a block gets every default that is not null', () => {
	assert.equal(JSON.stringify(resolveAnnotation(performance, feature())), '{"budget":"opens within 5 s","depth":"overview"}');
});

test('resolveAnnotation: the feature\'s block overrides defaults and fills keys without one, keeping schema order', () => {
	const own = feature({ performance: { depth: 'reference', workload: 'open-large' } });

	assert.equal(JSON.stringify(resolveAnnotation(performance, own)), '{"budget":"opens within 5 s","workload":"open-large","depth":"reference"}');
});

test('resolveAnnotation: another aspect\'s block, an empty block and an empty mapping all leave the defaults', () => {
	for (const aspects of [{ help: { depth: 'reference' } }, { performance: null }, { performance: {} }]) {
		assert.deepEqual(resolveAnnotation(performance, feature(aspects)), { budget: 'opens within 5 s', depth: 'overview' });
	}
});

test('resolveAnnotation: an aspect with no annotation: has no schema and resolves to {}', () => {
	const help = { name: 'help', data: {} };

	assert.equal(annotationSchema(help), null);
	assert.deepEqual(resolveAnnotation(help, feature({ help: { depth: 'reference' } })), {});
});
