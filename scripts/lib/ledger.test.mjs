import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { parseFrontmatter } from './frontmatter.mjs';
import { featureFingerprint } from './ledger.mjs';

// Contract: schema.md § Hashes (feature-hash) — the fingerprint changes exactly when the file changes
// as it bears on this aspect's audit.

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const BODY = '# Picking\n\nSelect entities in the viewport.\n';
const file = (...lines) => fm(...lines) + BODY;
const BASE = ['status: implemented', 'summary: |', '  Pick things.', 'capabilities:', '  - Pick an entity', 'related: [SCN]'];

const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };
const BETA_GA = { present: true, current: 'BETA', codes: ['BETA', 'GA'], errors: [], unreadable: false };
const GA_ONLY = { ...BETA_GA, current: 'GA', codes: ['GA'] };   // after BETA ships

const code = { name: 'code', data: {} };
const performance = { name: 'performance', data: { annotation: { budget: { type: 'string', default: '5 s' } } } };
const webSmoke = { name: 'web-smoke', data: { surfaces: ['web', 'mobile'] } };

/** A walked record for `raw`: its parsed data, with effective target and surfaces its own, else `inherited`. */
function record(raw, inherited = {}) {
	const { data } = parseFrontmatter(raw);
	return { code: 'SCN-PCK', data, target: data.target ?? inherited.target ?? null, surfaces: data.surfaces ?? inherited.surfaces ?? null };
}
const fingerprint = (raw, { aspect = code, releases = OFF, inherited } = {}) => featureFingerprint({ raw, feature: record(raw, inherited), aspect, releases });
const sha12 = (text) => createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12);

test('a file using none of aspects:, surfaces:, target: or object-form capabilities, audited by an aspect with no annotation: or surfaces:, fingerprints as the sha256 of the whole file', () => {
	const raw = file(...BASE);
	const noFrontMatter = '# Notes\ntarget: GA\n';

	assert.equal(fingerprint(raw), sha12(raw));
	assert.equal(fingerprint(raw, { releases: BETA_GA }), sha12(raw));
	assert.equal(fingerprint(raw.replace(/\n/g, '\r\n')), sha12(raw), 'CRLF hashes as its LF copy');
	assert.equal(fingerprint(noFrontMatter), sha12(noFrontMatter));
});

test('another aspect\'s settings block leaves this aspect\'s fingerprint unchanged; its own block changes it', () => {
	const bare = file(...BASE);
	const helpBlock = file(...BASE, 'aspects:', '  help:', '    depth: reference');
	const bothBlocks = file(...BASE, 'aspects:', '  help:', '    depth: reference', '  performance:', '    budget: 2 s');

	assert.equal(fingerprint(helpBlock, { aspect: performance }), fingerprint(bare, { aspect: performance }));
	assert.notEqual(fingerprint(bothBlocks, { aspect: performance }), fingerprint(helpBlock, { aspect: performance }));
	assert.equal(fingerprint(bothBlocks), fingerprint(bare), 'an aspect with no annotation: ignores every block');
});

test('adding or removing a top-level target: changes nothing while no capability changes scope', () => {
	assert.equal(fingerprint(file(...BASE, 'target: GA'), { releases: BETA_GA }), fingerprint(file(...BASE), { releases: BETA_GA }));
});

test('a capability deferred to a later release is left out until that release is current, then counts as if plain', () => {
	const raw = file('status: planned', 'capabilities:', '  - Pick an entity', '  - text: Export to KML', '    target: GA');

	assert.equal(fingerprint(raw, { releases: BETA_GA }), sha12(file('status: planned', 'capabilities:', '  - Pick an entity')));
	assert.equal(fingerprint(raw, { releases: GA_ONLY }), sha12(file('status: planned', 'capabilities:', '  - Pick an entity', '  - Export to KML')));
});

test('retagging a feature from GA to current takes its GA capabilities out of scope, which changes the fingerprint', () => {
	const caps = ['capabilities:', '  - Pick an entity', '  - text: Export to KML', '    target: GA'];

	assert.equal(fingerprint(file('status: planned', 'target: GA', ...caps), { releases: BETA_GA }), sha12(file('status: planned', 'capabilities:', '  - Pick an entity', '  - Export to KML')));
	assert.equal(fingerprint(file('status: planned', ...caps), { releases: BETA_GA }), sha12(file('status: planned', 'capabilities:', '  - Pick an entity')));
});

test('an unlisted code counts as current, so with no release list every capability is in scope', () => {
	const asPlain = sha12(file('status: planned', 'capabilities:', '  - Export to KML'));

	assert.equal(fingerprint(file('status: planned', 'capabilities:', '  - text: Export to KML', '    target: RC'), { releases: BETA_GA }), asPlain);
	assert.equal(fingerprint(file('status: planned', 'capabilities:', '  - text: Export to KML', '    target: GA'), { releases: OFF }), asPlain);
});

test('a capability tagged with the current release fingerprints the same before it ships, once tess drops the code from the list, and once the tag is stripped', () => {
	const tagged = file('status: planned', 'target: BETA', 'capabilities:', '  - text: Export to KML', '    target: BETA');
	const before = fingerprint(tagged, { releases: BETA_GA });

	assert.equal(fingerprint(tagged, { releases: GA_ONLY }), before);
	assert.equal(fingerprint(file('status: planned', 'capabilities:', '  - Export to KML'), { releases: GA_ONLY }), before);
});

test('surfaces count only as their overlap with an aspect that declares surfaces:, inherited or own', () => {
	const bare = file(...BASE);
	const onWeb = file(...BASE, 'surfaces: [web]');

	assert.equal(fingerprint(file(...BASE, 'surfaces: [api, web]')), fingerprint(bare), 'an aspect without surfaces: ignores them');
	assert.equal(fingerprint(file(...BASE, 'surfaces: [api, web]'), { aspect: webSmoke }), fingerprint(onWeb, { aspect: webSmoke }), 'a surface the aspect does not audit');
	assert.notEqual(fingerprint(file(...BASE, 'surfaces: [web, mobile]'), { aspect: webSmoke }), fingerprint(onWeb, { aspect: webSmoke }), 'gaining one it does');
	assert.equal(fingerprint(bare, { aspect: webSmoke, inherited: { surfaces: ['web'] } }), fingerprint(onWeb, { aspect: webSmoke }), 'inherited counts as own');
});
