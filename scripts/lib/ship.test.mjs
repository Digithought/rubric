/**
 * Tests for rubric's half of shipping a release: stripping a shipped code's
 * `target:` tags from the feature inventory (`planShip` / `applyShip`), the
 * refusal a still-listed or absent release list produces (`shipGuard`), and
 * finding which code was last shipped from git history (`lastShippedRelease`).
 *
 * Contract: agent-rules/principles.md § Current release assumption — shipping
 * strips every `target:` tag that named the shipped code, mechanically; and
 * schema.md § Hashes — a capability's `target:` (and the fingerprint-invariance
 * cases here, the feature's own) does not itself change the feature-hash.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { walkFeatures } from './features.mjs';
import { featureFingerprint } from './ledger.mjs';
import { applyShip, planShip, shipGuard } from './ship.mjs';
import { lastShippedRelease } from './git.mjs';
import { withTree } from './test-tree.mjs';

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const BODY = '# Picking\n\nSelect entities in the viewport.\n';
const file = (...lines) => fm(...lines) + BODY;

const BETA_GA = { present: true, current: 'BETA', codes: ['BETA', 'GA'], errors: [], unreadable: false };
const GA_ONLY = { present: true, current: 'GA', codes: ['GA'], errors: [], unreadable: false };   // after BETA ships

/** Build a `features/` tree under a temp root, walk it, run `fn(root, features)`, then clean up. */
async function withInventory(entries, fn) {
	return withTree(entries, async (root) => fn(root, await walkFeatures(join(root, 'features'))));
}

// ── planShip / applyShip ──────────────────────────────────────────────────────

test('strips a top-level feature target and a capability target naming the shipped code, leaving every other byte — including tags naming other codes — untouched', async () => {
	await withInventory({
		'features/SCN - Scene.md': file(
			'status: planned', 'target: BETA', 'related: [TER]', 'capabilities:',
			'  - Pick an entity',
			'  - text: Export to KML', '    target: BETA',
			'  - text: Export to DXF', '    target: GA',
		),
		'features/TER - Terrain.md': file('status: implemented', 'target: GA'),
	}, async (root, features) => {
		const plan = planShip({ features, code: 'BETA' });

		assert.deepEqual(plan.edits, [{ path: join(root, 'features', 'SCN - Scene.md'), featureTarget: true, capabilities: 1 }]);

		await applyShip(plan, 'BETA');

		assert.equal(await readFile(join(root, 'features', 'SCN - Scene.md'), 'utf-8'), file(
			'status: planned', 'related: [TER]', 'capabilities:',
			'  - Pick an entity',
			'  - Export to KML',
			'  - text: Export to DXF', '    target: GA',
		));
		assert.equal(await readFile(join(root, 'features', 'TER - Terrain.md'), 'utf-8'), file('status: implemented', 'target: GA'), 'a tag naming a different code is untouched');
	});
});

test('running again after a successful strip finds nothing left to plan or apply', async () => {
	await withInventory({ 'features/SCN - Scene.md': file('status: planned', 'target: BETA') }, async (root, features) => {
		const first = planShip({ features, code: 'BETA' });
		await applyShip(first, 'BETA');
		const stripped = await readFile(join(root, 'features', 'SCN - Scene.md'), 'utf-8');

		const again = planShip({ features: await walkFeatures(join(root, 'features')), code: 'BETA' });
		assert.deepEqual(again.edits, []);
		await applyShip(again, 'BETA');   // a no-op over an empty plan
		assert.equal(await readFile(join(root, 'features', 'SCN - Scene.md'), 'utf-8'), stripped);
	});
});

test('a target-first capability item collapses to plain text, and one whose text needs quoting is quoted', async () => {
	await withInventory({
		'features/SCN - Scene.md': file(
			'status: planned', 'capabilities:',
			'  - target: BETA', '    # why it waited', '    text: Export to KML',
			'  - text: "Supports 3D: yes"', '    target: BETA',
		),
	}, async (root, features) => {
		const plan = planShip({ features, code: 'BETA' });
		await applyShip(plan, 'BETA');

		assert.equal(await readFile(join(root, 'features', 'SCN - Scene.md'), 'utf-8'), file(
			'status: planned', 'capabilities:',
			'  - Export to KML',
			'    # why it waited',
			'  - "Supports 3D: yes"',
		));
	});
});

test('a CRLF feature file keeps CRLF on every line after stripping', async () => {
	const raw = file('status: planned', 'target: BETA', 'capabilities:', '  - target: BETA', '    text: Export to KML').replace(/\n/g, '\r\n');
	await withInventory({ 'features/SCN - Scene.md': raw }, async (root, features) => {
		await applyShip(planShip({ features, code: 'BETA' }), 'BETA');

		const out = await readFile(join(root, 'features', 'SCN - Scene.md'), 'utf-8');
		assert.match(out, /\r\n/);
		assert.doesNotMatch(out.replace(/\r\n/g, '\n'), /\r/);
		assert.equal(out, file('status: planned', 'capabilities:', '  - Export to KML').replace(/\n/g, '\r\n'));
	});
});

// ── Fingerprint invariance (schema.md § Hashes) ───────────────────────────────

test('featureFingerprint is identical before tess ships, between the two ship commands, and after rubric strips the tag', async () => {
	const before = file(
		'status: planned', 'target: BETA', 'capabilities:',
		'  - Pick an entity',
		'  - text: Export to KML', '    target: BETA',
	);
	const aspect = { name: 'code', data: {} };

	await withInventory({ 'features/SCN - Scene.md': before }, async (root, initialFeatures) => {
		const [scnBefore] = initialFeatures;
		const beforeShip = featureFingerprint({ raw: before, feature: scnBefore, aspect, releases: BETA_GA });
		// Between: tess has shipped, BETA is no longer listed, but rubric has not stripped the tag yet.
		const between = featureFingerprint({ raw: before, feature: scnBefore, aspect, releases: GA_ONLY });
		assert.equal(between, beforeShip, 'an unlisted code ranks as current, so the tag scopes capabilities the same either side of tess\'s ship');

		await applyShip(planShip({ features: initialFeatures, code: 'BETA' }), 'BETA');
		const strippedRaw = await readFile(join(root, 'features', 'SCN - Scene.md'), 'utf-8');
		const strippedFeatures = await walkFeatures(join(root, 'features'));
		const after = featureFingerprint({ raw: strippedRaw, feature: strippedFeatures[0], aspect, releases: GA_ONLY });

		assert.equal(after, beforeShip, 'stripping the tag rubric\'s scripts left behind changes nothing rubric hashes');
	});
});

// ── shipGuard ──────────────────────────────────────────────────────────────────

test('shipGuard refuses a code still listed in tickets/releases.md', () => {
	assert.match(shipGuard(BETA_GA, 'BETA'), /^BETA is still in tickets\/releases\.md — run node tess\/scripts\/release\.mjs ship first$/);
	assert.equal(shipGuard(GA_ONLY, 'BETA'), null, 'BETA no longer listed — clear to ship');
});

test('shipGuard refuses when tickets/releases.md does not exist', () => {
	assert.equal(shipGuard({ present: false, current: null, codes: [], errors: [], unreadable: false }, 'BETA'), 'tickets/releases.md does not exist — nothing was shipped through tess');
});

test('shipGuard refuses when the release list exists but could not be read', () => {
	const unreadable = { present: true, current: null, codes: [], errors: ['tickets/releases.md exists but tess\'s reader was not found'], unreadable: true };
	assert.equal(shipGuard(unreadable, 'BETA'), unreadable.errors[0]);
});

// ── lastShippedRelease ────────────────────────────────────────────────────────

function git(cwd, ...args) {
	return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' });
}

/** A temp git repository, one seed commit already made: the directory path. */
async function makeRepo() {
	const root = await mkdtemp(join(tmpdir(), 'rubric-ship-test-'));
	git(root, 'init', '-q');
	git(root, 'config', 'user.email', 'rubric@example.invalid');
	git(root, 'config', 'user.name', 'rubric test');
	git(root, 'config', 'commit.gpgsign', 'false');
	await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf-8');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'seed');
	return root;
}

async function withRepo(fn) {
	const root = await makeRepo();
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('lastShippedRelease finds the code in tess\'s exact ship-commit subject', async () => {
	await withRepo(async (root) => {
		git(root, 'commit', '-q', '--allow-empty', '-m', 'tess: ship release BETA');
		assert.equal(lastShippedRelease(root), 'BETA');
	});
});

test('lastShippedRelease picks the latest matching subject and ignores similar ones', async () => {
	await withRepo(async (root) => {
		git(root, 'commit', '-q', '--allow-empty', '-m', 'tess: ship release GA');
		git(root, 'commit', '-q', '--allow-empty', '-m', 'tess: ship release beta');        // lowercase code — no match
		git(root, 'commit', '-q', '--allow-empty', '-m', 'tess: ship release BETA extra');  // trailing text — no match

		assert.equal(lastShippedRelease(root), 'GA', 'the two more recent near-misses do not count; the older exact match does');
	});
});

test('lastShippedRelease is null with no ship commit, and null outside a git repository entirely', async () => {
	await withRepo(async (root) => {
		assert.equal(lastShippedRelease(root), null);
	});
	await withTree({ 'features/README.md': '# Features\n' }, async (root) => {
		assert.equal(lastShippedRelease(root), null);
	});
});
