#!/usr/bin/env node
/**
 * Check every coverage ledger's finding routing: each gap or partial record
 * names the ticket that carries it, or a `no-ticket:` reason saying why it has
 * none (`rubric/schema.md` § Finding routing). A record that does neither is a
 * finding nobody routed, and nothing else ever re-audits it.
 *
 * A separate script from check-spec.mjs on purpose: `run.mjs` and
 * `coverage.mjs` refuse to start while the spec check fails, and a ledger with
 * an unrouted record must not stop the audit or the `coverage.mjs route`
 * command that fixes it.
 *
 * Usage: node rubric/scripts/check-ledger.mjs [--root <dir>]
 *   --root  project root holding aspects/ (default: the parent of rubric/)
 * Exits 0 when clean, 1 on any problem, 2 on bad arguments.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverActiveAspects, hasVerdicts } from './lib/aspects.mjs';
import { readLedger } from './lib/ledger.mjs';
import { routingProblems } from './lib/routing.mjs';

const RUBRIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `rubric check-ledger — every gap or partial finding names a ticket or says why not.

Usage: check-ledger.mjs [--root <dir>]

Options:
  --root <dir>   Project root holding aspects/. Default: the parent of rubric/.
  -h, --help     This message.
`;

async function main() {
	const repoRoot = parseRoot(process.argv.slice(2));
	const aspects = (await discoverActiveAspects(join(repoRoot, 'aspects'), join(RUBRIC_ROOT, 'defaults', 'aspects'))).filter(hasVerdicts);
	const problems = [];
	let records = 0;
	for (const aspect of aspects) {
		const ledger = await readLedger(join(repoRoot, 'aspects'), aspect.name);
		records += Object.keys(ledger.records).length;
		problems.push(...routingProblems(aspect.name, ledger.records));
	}
	if (problems.length) {
		for (const problem of problems) console.error(problem);
		console.error(`\nrubric ledger: ${problems.length} problem(s) — the routing rule is in rubric/schema.md § Finding routing`);
		process.exit(1);
	}
	console.log(`rubric ledger: ${records} records in ${aspects.length} aspects — every gap and partial is ticketed or says why not`);
}

function parseRoot(argv) {
	let root = resolve(RUBRIC_ROOT, '..');
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '-h' || arg === '--help') { console.log(HELP); process.exit(0); }
		if (arg === '--root' && i + 1 < argv.length) { root = resolve(argv[++i]); continue; }
		console.error(arg === '--root' ? 'Option --root requires a value.' : `Unknown option: ${arg}`);
		console.error(HELP);
		process.exit(2);
	}
	return root;
}

main().catch(err => {
	console.error('rubric check-ledger failed:', err);
	process.exit(1);
});
