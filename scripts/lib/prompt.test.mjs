import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { buildAuditPrompt } from './prompt.mjs';
import { resolveTarget } from './scope.mjs';

// Contract: agent-rules/principles.md § Aspect annotations, surfaces and hierarchy — an aspect owns an optional
// settings block in a feature's front-matter that only its audit reads and writes — as agent-rules/audit.md
// § Feature settings hands the settings to the audit; and § Current release assumption, as agent-rules/audit.md
// § Release scope tells an audit which capabilities are not its release's and where its gap tickets go.

const ROOT = resolve('project-root');
const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };
const LIST = { present: true, current: 'BETA', codes: ['BETA', 'GA', 'LATER'], errors: [], unreadable: false };
const performance = {
	name: 'performance',
	data: {
		annotation: {
			budget: { type: 'string', default: '5 s' },
			workload: { type: 'string' },
			depth: { type: 'enum', values: ['overview', 'reference'], default: 'overview' },
		},
	},
};
const code = { name: 'code', data: {} };
const cap = (text, target = null) => ({ text, target, line: null });
const feature = (featureCode, name, { aspects, target = null, capabilities = [] } = {}) => ({
	code: featureCode, name, path: resolve(ROOT, 'features', `${featureCode} - ${name}.md`), data: aspects ? { aspects } : {}, target, capabilities,
});
const BATCH = [
	feature('SCN', 'Scene', { aspects: { performance: { depth: 'reference', workload: 'open-large', budget: '2 s' } } }),
	feature('TER', 'Terrain'),
];
// A current feature with capabilities deferred to GA and LATER, and a GA feature with one deferred to LATER.
const PCK = feature('SCN-PCK', 'Picking', { capabilities: [cap('Pick an entity'), cap('Pick through terrain', 'GA'), cap('Pick by voice', 'LATER')] });
const KML = feature('EXP-KML', 'KML export', { target: 'GA', capabilities: [cap('Export to KML'), cap('Export styles', 'LATER')] });

const promptFor = (aspect, { features = BATCH, target = 'current', releases = OFF, ticketTemplateBody = null } = {}) => buildAuditPrompt({
	aspect, aspectPromptBody: 'Audit it.', ticketTemplateBody, features, repoRoot: ROOT,
	runLogPath: resolve(ROOT, '.runs', 'r1', `${aspect.name}-batch1.md`), runId: 'r1', runStartedAt: '2026-09-13T00:00:00Z',
	target: resolveTarget(target, releases), releases,
});
/** The prompt's lines listing the batch. */
const featureLines = (prompt) => prompt.split('## Features in this batch\n\n')[1].split('\n\n')[0];

test('buildAuditPrompt: an aspect with annotation: gives each feature a settings: line of its resolved settings, keys in the schema\'s order', () => {
	assert.equal(featureLines(promptFor(performance)), [
		'- SCN — Scene  (features/SCN - Scene.md)',
		'  settings: {"budget":"2 s","workload":"open-large","depth":"reference"}',
		'- TER — Terrain  (features/TER - Terrain.md)',
		'  settings: {"budget":"5 s","depth":"overview"}',
	].join('\n'));
});

test('buildAuditPrompt: the settings section says the audit may write only its own block, only declared keys', () => {
	const prompt = promptFor(performance);

	assert.match(prompt, /\n## Feature settings for this aspect\n/);
	assert.match(prompt, /write it only under `aspects\.performance` in that feature's front-matter, only keys the annotation declares \(`budget`, `workload`, `depth`\), and change nothing else in the file/);
});

test('buildAuditPrompt: an aspect without annotation: has no settings lines and no settings section', () => {
	const prompt = promptFor(code);

	assert.equal(featureLines(prompt), '- SCN — Scene  (features/SCN - Scene.md)\n- TER — Terrain  (features/TER - Terrain.md)');
	assert.doesNotMatch(prompt, /settings/i);
});

test('buildAuditPrompt: a current run lists a feature\'s later capabilities as deferred, each with its release; an all run lists none', () => {
	assert.equal(featureLines(promptFor(code, { features: [PCK, BATCH[1]], releases: LIST })), [
		'- SCN-PCK — Picking  (features/SCN-PCK - Picking.md)',
		'  deferred — do not audit, do not file gaps:',
		'    "Pick through terrain" → GA',
		'    "Pick by voice" → LATER',
		'- TER — Terrain  (features/TER - Terrain.md)',
	].join('\n'));
	assert.equal(featureLines(promptFor(code, { features: [PCK], target: 'all', releases: LIST })), '- SCN-PCK — Picking  (features/SCN-PCK - Picking.md)');
});

test('buildAuditPrompt: a later-release run limits an earlier feature to its capabilities in that release, and defers a feature\'s later ones', () => {
	assert.equal(featureLines(promptFor(code, { features: [PCK, KML], target: 'GA', releases: LIST })), [
		'- SCN-PCK — Picking  (features/SCN-PCK - Picking.md)',
		'  audit only:',
		'    "Pick through terrain"',
		'- EXP-KML — KML export  (features/EXP-KML - KML export.md)',
		'  deferred — do not audit, do not file gaps:',
		'    "Export styles" → LATER',
	].join('\n'));
});

test('buildAuditPrompt: a later-release run files gap tickets in that release\'s backlog folder; current and all runs send gaps about later work there', () => {
	const later = promptFor(code, { features: [KML], target: 'GA', releases: LIST });

	assert.match(later, /under `tickets\/backlog\/GA\/code-<feature-code-lower>\.md`/);
	assert.match(promptFor(code, { features: [KML], target: 'GA', releases: LIST, ticketTemplateBody: 'TEMPLATE' }), /under `tickets\/backlog\/GA\/<aspect>-<feature-slug>\.md`/);
	assert.doesNotMatch(later, /belongs in/);
	for (const target of ['current', 'all']) {
		const prompt = promptFor(code, { target, releases: LIST });
		assert.match(prompt, /under `tickets\/plan\/code-<feature-code-lower>\.md`/);
		assert.match(prompt, /\n\nA gap that concerns only work tagged `target: <CODE>` belongs in `tickets\/backlog\/<CODE>\/` instead\.\n/);
	}
});

test('buildAuditPrompt: with no release list the prompt has no release wording at all', () => {
	for (const ticketTemplateBody of [null, 'TEMPLATE']) {
		assert.doesNotMatch(promptFor(code, { features: [PCK, KML], ticketTemplateBody }), /deferred|audit only|backlog|target|release/i);
	}
});
