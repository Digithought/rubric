import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { buildAuditPrompt } from './prompt.mjs';

// Contract: agent-rules/principles.md § Aspect annotations, surfaces and hierarchy — an aspect owns an optional
// settings block in a feature's front-matter that only its audit reads and writes — as agent-rules/audit.md
// § Feature settings hands the settings to the audit.

const ROOT = resolve('project-root');
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
const feature = (featureCode, name, aspects) => ({
	code: featureCode, name, path: resolve(ROOT, 'features', `${featureCode} - ${name}.md`), data: aspects ? { aspects } : {},
});
const BATCH = [
	feature('SCN', 'Scene', { performance: { depth: 'reference', workload: 'open-large', budget: '2 s' } }),
	feature('TER', 'Terrain'),
];

const promptFor = (aspect) => buildAuditPrompt({
	aspect, aspectPromptBody: 'Audit it.', ticketTemplateBody: null, features: BATCH, repoRoot: ROOT,
	runLogPath: resolve(ROOT, '.runs', 'r1', `${aspect.name}-batch1.md`), runId: 'r1', runStartedAt: '2026-09-13T00:00:00Z',
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
