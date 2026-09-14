import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseArgs, runTarget } from './cli.mjs';

// Contract: agent-rules/runner.md § Release scoping — `--target` picks the release a run audits, a resumed run keeps
// the target its manifest records, and `--stale-only` needs the ledger, which records current coverage only.

const LIST = { present: true, current: 'BETA', codes: ['BETA', 'GA', 'LATER'], errors: [], unreadable: false };
const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };
const CURRENT = { kind: 'current', code: 'BETA', rank: 0 };
const GA = { kind: 'release', code: 'GA', rank: 1 };
const args = (...argv) => parseArgs(argv);

test('parseArgs: --target is kept as given, and is null when omitted', () => {
	assert.equal(args().target, null);
	assert.equal(args('--target', 'GA').target, 'GA');
});

test('runTarget: a fresh run resolves --target — current by default or by the current code, a later code, all', () => {
	assert.deepEqual([args(), args('--target', 'current'), args('--target', 'BETA')].map(opts => runTarget(opts, LIST)), [CURRENT, CURRENT, CURRENT]);
	assert.deepEqual(runTarget(args('--target', 'GA'), LIST), GA);
	assert.deepEqual(runTarget(args('--target', 'all'), OFF), { kind: 'all', code: null, rank: null });
});

test('runTarget: a code the list does not hold, or any code with no release list, is a usage error', () => {
	assert.deepEqual(runTarget(args('--target', 'RC'), LIST), { error: '--target RC is not a code in tickets/releases.md (BETA, GA, LATER)' });
	assert.deepEqual(runTarget(args('--target', 'GA'), OFF), { error: '--target GA: no release list (or it is empty) — use current or all' });
});

test('runTarget: --stale-only is refused with a later release and allowed with current and all', () => {
	assert.deepEqual(runTarget(args('--stale-only', '--target', 'GA'), LIST), {
		error: '--stale-only cannot be combined with --target GA: the coverage ledger records current coverage only',
	});
	assert.deepEqual(runTarget(args('--stale-only'), LIST), CURRENT);
	assert.equal(runTarget(args('--stale-only', '--target', 'all'), LIST).kind, 'all');
});

test('runTarget: a resumed run takes its manifest\'s target; --target may repeat it but not change it', () => {
	const manifest = { run: 'r1', target: 'GA' };

	assert.deepEqual(runTarget(args('--resume', 'r1'), LIST, manifest), GA);
	assert.deepEqual(runTarget(args('--resume', 'r1', '--target', 'GA'), LIST, manifest), GA);
	assert.deepEqual(runTarget(args('--resume', 'r1', '--target', 'current'), LIST, manifest), {
		error: '--target current differs from run r1\'s target, GA — resume without --target',
	});
	assert.deepEqual(runTarget(args('--resume', 'r1', '--target', 'BETA'), LIST, { run: 'r1', target: 'current' }), CURRENT, 'the current code is current');
});

test('runTarget: a manifest written before targets resumes as all; one whose release has shipped since resumes as current', () => {
	assert.deepEqual(runTarget(args('--resume', 'r0'), LIST, { run: 'r0' }), { kind: 'all', code: null, rank: null });
	assert.match(runTarget(args('--resume', 'r0', '--target', 'current'), LIST, { run: 'r0' }).error, /differs from run r0's target, all/);

	const betaShipped = { ...LIST, current: 'GA', codes: ['GA', 'LATER'] };
	const gaShipped = { ...LIST, current: 'LATER', codes: ['LATER'] };
	assert.deepEqual(runTarget(args('--resume', 'r1'), betaShipped, { run: 'r1', target: 'GA' }), { kind: 'current', code: 'GA', rank: 0 });
	assert.deepEqual(runTarget(args('--resume', 'r1'), gaShipped, { run: 'r1', target: 'GA' }), { kind: 'current', code: 'LATER', rank: 0 });
});
