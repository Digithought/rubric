import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRouting, routingProblems } from './routing.mjs';

// Contract: schema.md § Finding routing — a gap or partial record carries exactly one
// of a ticket path or a no-ticket reason; a ticket is a bare .md path; a reason is one of the listed values.

test('parseRouting: a note yields a bare ticket path or an audit reason, never both, and never a reason on a covered verdict', () => {
	const cases = [
		['partial', 'ticket: tickets/fix/a.md', { ticket: 'tickets/fix/a.md', noTicket: null }],
		['partial', 'ticket: `tickets/fix/a.md`,', { ticket: 'tickets/fix/a.md', noTicket: null }],
		['partial', 'no-ticket: unverified — geolocation permission', { ticket: null, noTicket: 'unverified' }],
		['partial', 'ticket: none — env gap', { ticket: null, noTicket: null }],
		['partial', 'no-ticket: env', { ticket: null, noTicket: null }],
		['partial', 'no-ticket: unrecorded', { ticket: null, noTicket: null }],
		['gap', 'no-ticket: unbuilt; ticket: tickets/plan/b.md', { ticket: 'tickets/plan/b.md', noTicket: null }],
		['partial', '(Op-only) — No ticket: below the bar. (ticket: tickets/plan/c.md)', { ticket: 'tickets/plan/c.md', noTicket: null }],
		['covered', 'no-ticket: below-bar', { ticket: null, noTicket: null }],
		// regression: plural `tickets:` lists were read as unrouted (rubric-routing-reads-plural-tickets)
		['partial', '(tickets: tickets/fix/a.md, tickets/plan/b.md).', { ticket: 'tickets/fix/a.md', noTicket: null }],
		['partial', '(tickets: `tickets/plan/a.md`, `tickets/fix/b.md`)', { ticket: 'tickets/plan/a.md', noTicket: null }],
		['partial', '(tickets: see note, tickets/fix/b.md)', { ticket: null, noTicket: null }],
		// regression: an unspaced list recorded `a.md,b.md` as one path, which still passes the `.md` check
		['partial', '(tickets: tickets/fix/a.md,`tickets/plan/b.md`)', { ticket: 'tickets/fix/a.md', noTicket: null }],
	];
	for (const [verdict, note, expected] of cases) {
		assert.deepEqual(parseRouting(verdict, note), expected, `${verdict} (${note})`);
	}
});

test('routingProblems: one problem per record that breaks the routing rule, none for a routed or historical record', () => {
	const records = {
		NEITHER: { verdict: 'partial', ticket: null },
		BOTH: { verdict: 'gap', ticket: 'tickets/plan/x.md', 'no-ticket': 'below-bar' },
		BOGUS: { verdict: 'partial', ticket: null, 'no-ticket': 'bogus' },
		SAME: { verdict: 'partial', ticket: 'same' },
		HISTORY: { verdict: 'covered', ticket: 'tickets/plan/y.md' },
		RETROFIT: { verdict: 'partial', ticket: null, 'no-ticket': 'unrecorded' },
	};
	const problems = routingProblems('smoke-testing', records);
	const perCode = Object.fromEntries(Object.keys(records).map(code => [code, problems.filter(p => p.includes(`: ${code} (`)).length]));
	assert.deepEqual(perCode, { NEITHER: 1, BOTH: 1, BOGUS: 1, SAME: 1, HISTORY: 0, RETROFIT: 0 });
});
