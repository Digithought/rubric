/**
 * Argument parsing for `rubric run`.
 *
 * Usage:
 *   rubric run [--cadence <on-demand|on-change|daily|weekly|any>]
 *              [--aspect <name>]
 *              [--features <CODE,CODE,...>]
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
 *   max-batches: unlimited
 *   max-aspects: unlimited
 *   agent: claude
 */

const HELP = `rubric run — orchestrate aspect audits over the feature inventory.

Options:
  --cadence <name>      Trigger to filter aspects by ('on-demand', 'on-change',
                        'daily', 'weekly', 'any'). Default: on-demand.
  --aspect <name>       Run only the named aspect (overrides --cadence filter).
  --features <list>     Comma-separated feature codes; restricts the audit to
                        these features (default: per aspect's level/applies-to).
  --max-batches <N>     Cap total batches dispatched. Default: unlimited.
  --max-aspects <N>     Cap aspects considered. Default: unlimited.
  --agent <name>        Agent adapter to invoke. Default: claude.
  --resume <id|last>    Resume an existing run: skip its done tasks, re-dispatch
                        pending/failed/interrupted ones and blocked tasks whose
                        blocker is now resolved. 'last' picks the newest run.
  --dry-run             Print the dispatch plan; do not invoke any agent.
  --no-tickets          (Reserved.) Tell agents not to file gap tickets — only
                        write run logs. (Currently informational; the prompt
                        tells the agent.)
  -h, --help            This message.
`;

export function parseArgs(argv) {
	const opts = {
		cadence: 'on-demand',
		aspect: null,
		features: null,
		maxBatches: Infinity,
		maxAspects: Infinity,
		agent: 'claude',
		resume: null,
		dryRun: false,
		noTickets: false,
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
			case '--max-batches': opts.maxBatches = parseInt(consume(argv, ++i, a), 10); break;
			case '--max-aspects': opts.maxAspects = parseInt(consume(argv, ++i, a), 10); break;
			case '--agent': opts.agent = consume(argv, ++i, a); break;
			case '--resume': opts.resume = consume(argv, ++i, a); break;
			case '--dry-run': opts.dryRun = true; break;
			case '--no-tickets': opts.noTickets = true; break;
			default:
				console.error(`Unknown option: ${a}`);
				console.error(HELP);
				process.exit(2);
		}
	}
	return opts;
}

function consume(argv, i, flag) {
	if (i >= argv.length) {
		console.error(`Option ${flag} requires a value.`);
		process.exit(2);
	}
	return argv[i];
}
