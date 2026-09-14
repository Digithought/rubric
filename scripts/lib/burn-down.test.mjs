import assert from 'node:assert/strict';
import { test } from 'node:test';

import { burnDown, formatBurnDown } from './burn-down.mjs';

// Contract: agent-rules/principles.md § Current release assumption — the burn-down for the current release is
// derivable: every untagged capability not yet implemented and covered, and every stale or missing coverage cell for
// an untagged feature.

const LIST = { present: true, current: 'BETA', codes: ['BETA', 'GA'], errors: [], unreadable: false };
const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };

const cap = (text, target = null) => ({ text, target, line: null });
const feature = (code, name, { level = 'leaf', status, target = null, capabilities = [] } = {}) =>
	({ code, name, level, data: status ? { status } : {}, surfaces: null, target, capabilities });

// SCN has children, so its status is derived; TER is a childless root, which stores its own.
const FEATURES = [
	feature('SCN', 'Scene', { level: 'root', status: 'partial' }),
	feature('SCN-PCK', 'Picking', { status: 'planned', capabilities: [cap('Pick an entity'), cap('Pick by voice', 'GA')] }),
	feature('SCN-SEL', 'Selection', { status: 'implemented' }),
	feature('SCN-TAG', 'Tagging'),
	feature('SCN-VR', 'Walk in VR', { status: 'planned', target: 'GA' }),
	feature('SCN-OLD', 'Old picking', { status: 'retired' }),
	feature('TER', 'Terrain', { level: 'root', status: 'partial' }),
];

/** `code` (any level), `ux` (leaf) and its child `tooltips` — sorted by name, as discovery gives them. */
function aspects() {
	const aspect = (name, data = {}, parent = null) => ({ name, data, parent, children: [] });
	const ux = aspect('ux', { level: 'leaf' });
	ux.children = ['tooltips'];
	return [aspect('code'), aspect('tooltips', {}, ux), ux];
}

const CELLS = {
	'code:SCN-PCK': { state: 'missing', verdict: null },
	'code:SCN-SEL': { state: 'fresh', verdict: 'gap', ticket: 'tickets/plan/code-scn-sel.md' },
	'code:SCN-TAG': { state: 'drift-stale', verdict: 'covered' },
	'code:TER': { state: 'fresh', verdict: 'partial', ticket: 'tickets/plan/code-ter.md' },
	'tooltips:SCN-TAG': { state: 'fresh', verdict: 'n/a' },
};

/** The report under `releases`, and the `aspect:CODE` pairs it asked for a cell. */
function report(releases) {
	const asked = [];
	const cellOf = (f, aspect) => {
		asked.push(`${aspect.name}:${f.code}`);
		return { ticket: null, ...(CELLS[`${aspect.name}:${f.code}`] ?? { state: 'fresh', verdict: 'covered' }) };
	};
	return { report: burnDown({ features: FEATURES, aspects: aspects(), releases, cellOf }), asked };
}

test('burnDown: childless features due now that are not implemented or retired, with their due capabilities, and per aspect the open cells of features due now', () => {
	const { report: out, asked } = report(LIST);

	assert.deepEqual(out, {
		release: 'BETA',
		notImplemented: [
			{ code: 'SCN-PCK', name: 'Picking', status: 'planned', capabilities: ['Pick an entity'] },
			{ code: 'SCN-TAG', name: 'Tagging', status: null, capabilities: [] },
			{ code: 'TER', name: 'Terrain', status: 'partial', capabilities: [] },
		],
		aspects: [
			{
				name: 'code', parent: null, open: [
					{ code: 'SCN-PCK', state: 'missing', verdict: null, ticket: null },
					{ code: 'SCN-SEL', state: 'fresh', verdict: 'gap', ticket: 'tickets/plan/code-scn-sel.md' },
					{ code: 'SCN-TAG', state: 'drift-stale', verdict: 'covered', ticket: null },
					{ code: 'TER', state: 'fresh', verdict: 'partial', ticket: 'tickets/plan/code-ter.md' },
				],
			},
			{ name: 'tooltips', parent: 'ux', open: [] },
		],
	});
	assert.deepEqual(asked, [
		'code:SCN', 'code:SCN-PCK', 'code:SCN-SEL', 'code:SCN-TAG', 'code:TER',
		'tooltips:SCN-PCK', 'tooltips:SCN-SEL', 'tooltips:SCN-TAG',
	], 'never a deferred or retired feature, a parent with children, or a feature its aspect does not apply to');
});

test('burnDown: with no release list everything is due — deferred features and capabilities included', () => {
	const { report: out } = report(OFF);

	assert.equal(out.release, null);
	assert.deepEqual(out.notImplemented.map(f => [f.code, f.capabilities]), [
		['SCN-PCK', ['Pick an entity', 'Pick by voice']], ['SCN-TAG', []], ['SCN-VR', []], ['TER', []],
	]);
	assert.deepEqual(out.aspects[0].open.map(cell => cell.code), ['SCN-PCK', 'SCN-SEL', 'SCN-TAG', 'TER']);
});

test('formatBurnDown: CODE [status] Name with due capabilities beneath, <aspect> — N open with aligned cells, then the summary', () => {
	assert.equal(formatBurnDown(report(LIST).report), [
		'Not implemented — 3',
		'  SCN-PCK [planned] Picking',
		'    - Pick an entity',
		'  SCN-TAG [no status] Tagging',
		'  TER [partial] Terrain',
		'',
		'code — 4 open',
		'  SCN-PCK  missing      —        —',
		'  SCN-SEL  fresh        gap      tickets/plan/code-scn-sel.md',
		'  SCN-TAG  drift-stale  covered  —',
		'  TER      fresh        partial  tickets/plan/code-ter.md',
		'',
		'ux/tooltips — 0 open',
		'',
		'release BETA: 3 not implemented, 4 open coverage cell(s) across 2 aspect(s)',
	].join('\n'));
	assert.match(formatBurnDown(report(OFF).report), /\nno release list — everything is current: 4 not implemented, 4 open coverage cell\(s\) across 2 aspect\(s\)$/);
});
