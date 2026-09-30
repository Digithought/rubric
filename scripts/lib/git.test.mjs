import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evidencePath, globToRegex } from './git.mjs';

// Contract: schema.md § Run log (`## Evidence`) — drift is judged per file, so an entry that
// cites a section of a document goes drift-stale when any commit touches that document.

const matches = (entry, file) => globToRegex(evidencePath(entry)).test(file);

test('a cited section still names its file', () => {
	assert.equal(matches('docs/site-cad-backend.md#backend-readers-of-frontend-owned-schemas', 'docs/site-cad-backend.md'), true);
});

test('a trailing aside after a cited section is dropped too', () => {
	assert.equal(evidencePath("docs/site-cad.md#database-architecture (Removing an account's data from this device)"), 'docs/site-cad.md');
});

test('plain paths and globs pass through unchanged', () => {
	assert.equal(evidencePath('packages/site-cad/src/lib/clip-plan.ts'), 'packages/site-cad/src/lib/clip-plan.ts');
	assert.equal(matches('packages/**/*.ts', 'packages/site-cad/src/lib/clip-plan.ts'), true);
});
