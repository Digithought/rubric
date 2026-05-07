#!/usr/bin/env node
/**
 * `rubric init` — idempotently scaffold the peer folders rubric expects.
 *
 *   features/   the feature inventory (created with a starter README if absent)
 *   aspects/    active aspect folder (empty — opt in per aspect)
 *   .runs/      run-log directory (with a .gitkeep so the empty dir is tracked)
 *
 * Also adds .runs/ to .gitignore (with .gitkeep carve-out) and prints next-step
 * pointers. Re-running detects existing state and only fills in what's missing.
 *
 * Does NOT activate any aspect. Aspect activation is a deliberate, per-project
 * choice — see rubric/agent-rules/add-aspect.md.
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUBRIC_ROOT = resolve(__dirname, '..');

const FEATURES_README = `# Feature Inventory

Hierarchical, timeless functional specification. One file per feature. Codes live in filenames.

## Coding scheme

- 3–5 uppercase letters per layer, mnemonic where possible.
- Hyphenated for nesting: \`LIB-INS-MFT\`.
- Unique within siblings, not globally.
- Stable. Codes are retired but never reassigned.

## Front-matter

See \`rubric/schema.md\`.

## Conventions

- **Timeless.** No "currently", "now", "in progress". Describe the desired system.
- **No source-code references.** Spec language stays paths-and-files-free.
- **No architecture leakage.** Frameworks, modules, plumbing belong in architecture docs.
- **UI-agnostic where possible.** "Select an entity" beats "click an entity."
- **DRY.** A capability lives in exactly one feature; cross-references via \`related:\`.

## Aspect audits

Cross-cutting concerns are audited against this inventory by [rubric](../rubric/README.md).
Each active aspect lives under [\`aspects/\`](../aspects/) and is verified by agents that file
gap tickets when an aspect is missing for a feature.

## Root feature index

| Code | Name | Status | Summary |
|------|------|--------|---------|
| (add rows here) |
`;

const ASPECTS_README = `# Active aspects

This folder holds the cross-cutting aspects rubric audits against the [feature inventory](../features/README.md). An aspect is a folder; its presence here means it is active for this project.

To activate an aspect, see [\`rubric/agent-rules/add-aspect.md\`](../rubric/agent-rules/add-aspect.md). Each active aspect's folder contains:

- \`aspect.md\` — required. Configuration: level, batch size, cadence, ticket-system mapping.
- \`prompt.md\` — optional. Overrides the rubric default at \`rubric/defaults/aspects/<name>/prompt.md\`.
- \`ticket-template.md\` — optional. Overrides the default ticket template.

Defaults shipped with rubric are under \`rubric/defaults/aspects/\` — currently: code, unit-tests, help, agent-ux, agent-toolkit, marketing.
`;

const AGENT_RULE_NAMES = ['AGENTS.md', 'CLAUDE.md'];
const ROOT_SNIPPET_MARKER = '## Specification (rubric)';
const ROOT_SNIPPET = `${ROOT_SNIPPET_MARKER}

This project uses [rubric](rubric/) — a feature inventory plus cross-cutting aspect audits.
Agents manipulating features or aspects: read [rubric/agent-rules/root.md](rubric/agent-rules/root.md) first.
Features live in [features/](features/); active aspects in [aspects/](aspects/).
`;

async function ensureRootAgentRules(repoRoot, created, updated, existed) {
	for (const name of AGENT_RULE_NAMES) {
		const filePath = join(repoRoot, name);
		if (!existsSync(filePath)) {
			await writeFile(filePath, ROOT_SNIPPET, 'utf-8');
			created.push(name);
			continue;
		}
		const cur = await readFile(filePath, 'utf-8');
		if (cur.includes(ROOT_SNIPPET_MARKER)) {
			existed.push(`${name} (rubric section)`);
			continue;
		}
		// CLAUDE.md that only delegates to AGENTS.md needs no rubric section —
		// AGENTS.md is already the authoritative source for this project.
		if (name === 'CLAUDE.md' && /^@AGENTS\.m[dc]\s*$/i.test(cur.trim())) {
			existed.push(`${name} (delegates to AGENTS.md)`);
			continue;
		}
		const sep = cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n';
		await writeFile(filePath, cur + sep + ROOT_SNIPPET, 'utf-8');
		updated.push(name);
	}
}

async function main() {
	const repoRoot = process.cwd();
	const created = [];
	const existed = [];
	const updated = [];

	// features/
	const featuresDir = join(repoRoot, 'features');
	if (!existsSync(featuresDir)) {
		await mkdir(featuresDir, { recursive: true });
		created.push('features/');
	} else existed.push('features/');
	const featuresReadme = join(featuresDir, 'README.md');
	if (!existsSync(featuresReadme)) {
		await writeFile(featuresReadme, FEATURES_README, 'utf-8');
		created.push('features/README.md');
	}

	// aspects/
	const aspectsDir = join(repoRoot, 'aspects');
	if (!existsSync(aspectsDir)) {
		await mkdir(aspectsDir, { recursive: true });
		created.push('aspects/');
	} else existed.push('aspects/');
	const aspectsReadme = join(aspectsDir, 'README.md');
	if (!existsSync(aspectsReadme)) {
		await writeFile(aspectsReadme, ASPECTS_README, 'utf-8');
		created.push('aspects/README.md');
	}

	// .runs/
	const runsDir = join(repoRoot, '.runs');
	if (!existsSync(runsDir)) {
		await mkdir(runsDir, { recursive: true });
		created.push('.runs/');
	} else existed.push('.runs/');
	const gitkeep = join(runsDir, '.gitkeep');
	if (!existsSync(gitkeep)) {
		await writeFile(gitkeep, '', 'utf-8');
		created.push('.runs/.gitkeep');
	}

	// .gitignore — add .runs/* and !.runs/.gitkeep if not already present
	const gi = join(repoRoot, '.gitignore');
	if (existsSync(gi)) {
		let cur = await readFile(gi, 'utf-8');
		const wantPattern = '.runs/*';
		const wantExempt = '!.runs/.gitkeep';
		const lines = cur.split(/\r?\n/);
		const hasPattern = lines.some(l => l.trim() === wantPattern);
		const hasExempt = lines.some(l => l.trim() === wantExempt);
		if (!hasPattern || !hasExempt) {
			let block = '';
			if (!cur.endsWith('\n')) block += '\n';
			block += '\n# Rubric audit run logs\n';
			if (!hasPattern) block += `${wantPattern}\n`;
			if (!hasExempt)  block += `${wantExempt}\n`;
			await writeFile(gi, cur + block, 'utf-8');
			updated.push('.gitignore');
		}
	}

	// AGENTS.md / CLAUDE.md — append a rubric section if not already present
	await ensureRootAgentRules(repoRoot, created, updated, existed);

	// ── Report ──
	console.log('rubric init');
	if (created.length > 0) {
		console.log('  Created:');
		for (const p of created) console.log(`    + ${p}`);
	}
	if (updated.length > 0) {
		console.log('  Updated:');
		for (const p of updated) console.log(`    ~ ${p}`);
	}
	if (existed.length > 0) {
		console.log('  Already present:');
		for (const p of existed) console.log(`    · ${p}`);
	}
	console.log('');
	console.log('Next steps:');
	console.log('  - Add features under features/  (see rubric/agent-rules/add-feature.md)');
	console.log('  - Activate aspects under aspects/<name>/  (see rubric/agent-rules/add-aspect.md)');
	console.log('  - Run audits:  node rubric/scripts/run.mjs --help');
}

main().catch(err => {
	console.error('rubric init failed:', err);
	process.exit(1);
});
