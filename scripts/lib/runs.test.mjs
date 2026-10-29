import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVerdicts } from './runs.mjs';

// regression: a verdict bullet hard-wrapped after `(ticket:` lost its routing and reached the ledger unrouted (rubric-verdict-routing-read-across-wrapped-lines)
test('parseVerdicts: a bullet wrapped onto indented continuation lines parses as its one-line form', () => {
	const cases = [
		['one-line routing', ['- `A` — partial (ticket: tickets/implement/x.md), scope: foo']],
		['ticket path on the next line', ['- `A` — partial (ticket:', '  tickets/implement/x.md), scope: foo']],
		['no-ticket reason on the next line', ['- `A` — gap (no-ticket:', '  below-bar) the export half']],
		['tickets list continuing', ['- `A` — partial (tickets: tickets/fix/a.md,', '  tickets/fix/b.md) both halves']],
	];
	for (const [name, lines] of cases) {
		const oneLine = lines.map(l => l.trim()).join(' ');
		const parse = text => parseVerdicts(`## Verdicts\n\n${text}\n\n## Evidence\n`);
		assert.deepEqual(parse(lines.join('\n')), parse(oneLine), name);
		assert.equal(parse(oneLine).length, 1, name);
	}

	const two = parseVerdicts('## Verdicts\n- `A` — partial (ticket:\n  tickets/fix/a.md)\n- `B` — covered\n');
	assert.deepEqual(two.map(v => [v.code, v.detail]), [['A', '(ticket: tickets/fix/a.md)'], ['B', '']]);
});
