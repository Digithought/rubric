/**
 * Finding routing — whether a `gap`/`partial` ledger record names the ticket
 * that carries it or says why it has none (schema.md § Finding routing).
 *
 * The runner reads both from the free-text verdict line (`parseRouting`), the
 * check reads them back from the ledger (`routingProblems`), and `coverage.mjs`
 * sets them by hand (`applyRouting`).
 */

/** The reasons an audit may give for a finding with no ticket. */
export const AGENT_REASONS = ['unverified', 'below-bar', 'unbuilt'];
/** Every value a ledger's `no-ticket:` may hold; `unrecorded` is written only by `coverage.mjs normalize-routing`. */
export const LEDGER_REASONS = [...AGENT_REASONS, 'unrecorded'];

const ROUTED_VERDICTS = new Set(['gap', 'partial']);
// The lookbehind keeps `no-ticket: unverified` from reading as `ticket: unverified`.
const TICKET_RE = /(?<![\w-])ticket:\s*([^\s)]+)/gi;
const NO_TICKET_RE = /(?<![\w-])no-ticket:\s*([a-z-]+)/gi;

/** A verdict whose record must carry a ticket path or a `no-ticket:` reason. */
export function needsRouting(verdict) {
	return ROUTED_VERDICTS.has(verdict);
}

/** Strip wrapping backticks/quotes and trailing `, ; . :` (repeatedly); a value that is not then a `.md` path is null. */
export function normalizeTicketPath(raw) {
	if (raw == null) return null;
	let s = String(raw).trim();
	for (let prev = null; s !== prev;) {
		prev = s;
		s = s.replace(/^[`'"]+|[`'"]+$/g, '').replace(/[,;.:]+$/, '').trim();
	}
	return s.endsWith('.md') ? s : null;
}

/**
 * `{ ticket, noTicket }` from one verdict's text. The first `ticket:` that is a
 * `.md` path wins over any reason, so prose such as "No ticket: below the bar"
 * ahead of the routing does not hide it.
 */
export function parseRouting(verdict, text) {
	const s = String(text ?? '');
	const ticket = firstMatch(s, TICKET_RE, normalizeTicketPath);
	if (ticket || !needsRouting(verdict)) return { ticket, noTicket: null };
	const noTicket = firstMatch(s, NO_TICKET_RE, raw => (AGENT_REASONS.includes(raw.toLowerCase()) ? raw.toLowerCase() : null));
	return { ticket: null, noTicket };
}

function firstMatch(text, re, accept) {
	for (const m of text.matchAll(re)) {
		const value = accept(m[1]);
		if (value) return value;
	}
	return null;
}

/**
 * Set a record's routing in place, keeping its other keys and their order:
 * `ticket` is replaced, and `no-ticket` is written directly after it only when
 * set, so a record that needs no reason carries no key for one.
 */
export function applyRouting(record, { ticket, noTicket }) {
	const entries = Object.entries(record).filter(([key]) => key !== 'no-ticket');
	if (!entries.some(([key]) => key === 'ticket')) entries.push(['ticket', null]);
	for (const key of Object.keys(record)) delete record[key];
	for (const [key, value] of entries) {
		if (key !== 'ticket') { record[key] = value; continue; }
		record.ticket = ticket;
		if (noTicket) record['no-ticket'] = noTicket;
	}
	return record;
}

/** The command that routes one record by hand. */
export function routeCommand(code, aspectName) {
	return `node rubric/scripts/coverage.mjs route ${code} ${aspectName} <ticket-path> | --no-ticket <${AGENT_REASONS.join('|')}>`;
}

/** Routing-rule violations in one aspect's records, one human-readable line each. */
export function routingProblems(aspectName, records) {
	const problems = [];
	for (const [code, record] of Object.entries(records ?? {})) {
		if (!record || typeof record !== 'object') continue;
		const ticket = record.ticket ?? null;
		const noTicket = record['no-ticket'] ?? null;
		const where = `aspects/${aspectName}/coverage.md: ${code} (${record.verdict ?? 'no verdict'})`;
		const fix = `fix: ${routeCommand(code, aspectName)}`;
		if (ticket !== null && !(typeof ticket === 'string' && ticket.endsWith('.md'))) {
			problems.push(`${where}: ticket ${JSON.stringify(ticket)} is not a .md path — ${fix}`);
		}
		if (!needsRouting(record.verdict)) continue;
		if (noTicket !== null && !LEDGER_REASONS.includes(noTicket)) {
			problems.push(`${where}: no-ticket ${JSON.stringify(noTicket)} is not one of ${LEDGER_REASONS.join(', ')} — ${fix}`);
		} else if (ticket !== null && noTicket !== null) {
			problems.push(`${where}: has both a ticket and a no-ticket reason — ${fix}`);
		} else if (ticket === null && noTicket === null) {
			problems.push(`${where}: names no ticket and no no-ticket reason — ${fix}`);
		}
	}
	return problems;
}
