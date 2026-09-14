#!/usr/bin/env node
/**
 * Check the spec fields rubric reads — surfaces, release targets, capability
 * forms, aspect settings and parents, and the release list — so a mistake in
 * them fails here instead of silently changing what gets audited. Field rules
 * are in `rubric/schema.md`.
 *
 * Usage: node rubric/scripts/check-spec.mjs [--root <dir>]
 *   --root  project root holding features/ and aspects/ (default: the parent of rubric/)
 * Exits 0 when clean, 1 on any error, 2 on bad arguments.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lastShippedRelease } from './lib/git.mjs';
import { exitIfSpecInvalid, loadSpec } from './lib/validate.mjs';

const RUBRIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `rubric check-spec — validate feature and aspect front-matter fields.

Usage: check-spec.mjs [--root <dir>]

Options:
  --root <dir>   Project root holding features/ and aspects/. Default: the parent of rubric/.
  -h, --help     This message.
`;

async function main() {
	const repoRoot = parseRoot(process.argv.slice(2));
	const spec = await loadSpec(repoRoot);
	if (spec.features.length === 0) {
		console.error(`No features found under ${join(repoRoot, 'features')}. Did you run rubric init?`);
		process.exit(1);
	}
	exitIfSpecInvalid(repoRoot, spec, lastShippedRelease(repoRoot));
	console.log(`rubric spec: ${spec.features.length} features, ${spec.aspects.length} aspects — clean`);
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
	console.error('rubric check-spec failed:', err);
	process.exit(1);
});
