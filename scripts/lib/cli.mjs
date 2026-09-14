/**
 * Argument parsing for `rubric run`.
 *
 * Usage:
 *   rubric run [--cadence <on-demand|on-change|daily|weekly|any>]
 *              [--aspect <name>]
 *              [--features <CODE,CODE,...>]
 *              [--target <current|all|CODE>]
 *              [--max-batches <N>]
 *              [--max-aspects <N>]
 *              [--agent <claude|...>]
 *              [--resume <runId|last>]
 *              [--dry-run]
 *              [--no-tickets]
 *              [--help]
 *
 * Defaults:
 *   cadence: on-demand
 *   target: current
 *   max-batches: unlimited
 *   max-aspects: unlimited
 *   agent: claude
 */

import { resolveTarget } from './scope.mjs';

const HELP = `rubric run — orchestrate aspect audits over the feature inventory.

Options:
  --cadence <name>      Trigger to filter aspects by ('on-demand', 'on-change',
                        'daily', 'weekly', 'any'). Default: on-demand.
  --aspect <name>       Run only the named aspect (overrides --cadence filter).
                        A parent aspect with children runs its children.
  --features <list>     Comma-separated feature codes; restricts the audit to
                        these features (default: per aspect's level/applies-to).
  --target <release>    Which release's work to audit. 'current' (default):
                        features and capabilities due in the current release,
                        later capabilities listed as deferred. A later code
                        from tickets/releases.md: only work deferred to it; gap
                        tickets go to tickets/backlog/<CODE>/ and the coverage
                        ledger is not written. 'all': everything. A resumed run
                        keeps the target it was planned under.
  --max-batches <N>     Cap total batches dispatched. Default: unlimited.
  --max-aspects <N>     Cap aspects considered. Default: unlimited.
  --agent <name>        Agent adapter to invoke. Default: claude.
  --resume <id|last>    Resume an existing run: skip its done tasks, re-dispatch
                        pending/failed/interrupted ones and blocked tasks whose
                        blocker is now resolved. 'last' picks the newest run.
  --stale-only          Audit only pairs whose coverage-ledger record is missing
                        or stale (by hash / drift / age), most-churned first.
                        Fresh pairs are pruned. Seeds nothing on its own — run a
                        full sweep first, then --stale-only on cadence.
  --dry-run             Print the dispatch plan; do not invoke any agent.
  --no-tickets          (Reserved.) Tell agents not to file gap tickets — only
                        write run logs. (Currently informational; the prompt
                        tells the agent.)
  --keep-going          Do not halt the run on a global blocking blocker, and
                        do not skip aspect/feature-scoped blocked tasks. Blockers
                        are still recorded + injected into later prompts, but
                        every task is dispatched. Use when a known, already-
                        ticketed blocker (e.g. an upstream dependency under
                        active repair) should not stop the rest of the sweep.
                        Alias: --no-halt.
  -h, --help            This message.
`;

export function parseArgs(argv) {
	const opts = {
		cadence: 'on-demand',
		aspect: null,
		features: null,
		target: null,
		maxBatches: Infinity,
		maxAspects: Infinity,
		agent: 'claude',
		resume: null,
		staleOnly: false,
		dryRun: false,
		noTickets: false,
		keepGoing: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case '-h':
			case '--help':
				console.log(HELP);
				process.exit(0);
			case '--cadence': opts.cadence = consume(argv, ++i, a); break;
			case '--aspect':  opts.aspect  = consume(argv, ++i, a); break;
			case '--features': opts.features = consume(argv, ++i, a).split(',').map(s => s.trim()).filter(Boolean); break;
			case '--target': opts.target = consume(argv, ++i, a); break;
			case '--max-batches': opts.maxBatches = parseInt(consume(argv, ++i, a), 10); break;
			case '--max-aspects': opts.maxAspects = parseInt(consume(argv, ++i, a), 10); break;
			case '--agent': opts.agent = consume(argv, ++i, a); break;
			case '--resume': opts.resume = consume(argv, ++i, a); break;
			case '--stale-only': opts.staleOnly = true; break;
			case '--dry-run': opts.dryRun = true; break;
			case '--no-tickets': opts.noTickets = true; break;
			case '--keep-going':
			case '--no-halt': opts.keepGoing = true; break;
			default:
				console.error(`Unknown option: ${a}`);
				console.error(HELP);
				process.exit(2);
		}
	}
	return opts;
}

/**
 * The release target a run plans and records under (agent-rules/runner.md
 * § Release scoping), or `{ error }` — a usage error, exit 2. A fresh run takes
 * `--target`. A resumed run takes its manifest's, which `--target` may repeat
 * but not change: `all` for a manifest written before targets existed, the
 * scope it was planned under, and `current` for a release shipped since, whose
 * work is current now.
 */
export function runTarget(opts, releases, manifest = null) {
	const target = manifest ? resumedTarget(opts.target, releases, manifest) : resolveTarget(opts.target, releases);
	if (!target.error && opts.staleOnly && target.kind === 'release') {
		return { error: `--stale-only cannot be combined with --target ${target.code}: the coverage ledger records current coverage only` };
	}
	return target;
}

function resumedTarget(asked, releases, manifest) {
	const recorded = manifest.target ?? 'all';
	const planned = resolveTarget(recorded, releases);
	const target = planned.error ? resolveTarget('current', releases) : planned;
	if (asked == null) return target;
	const given = resolveTarget(asked, releases);
	if (given.error) return given;
	if (given.kind !== target.kind || given.code !== target.code) {
		return { error: `--target ${asked} differs from run ${manifest.run}'s target, ${recorded} — resume without --target` };
	}
	return target;
}

function consume(argv, i, flag) {
	if (i >= argv.length) {
		console.error(`Option ${flag} requires a value.`);
		process.exit(2);
	}
	return argv[i];
}
