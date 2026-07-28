/**
 * Freshness — derived, never stored.
 *
 * Given a ledger record plus the current feature/aspect hashes and the drift
 * count over the record's evidence, decide whether a prior audit still holds.
 * Pure: no I/O, no git — the caller supplies the hashes and the drift result
 * (from `git.mjs`). The precedence here is authoritative-per-`schema.md`:
 *
 *   missing → criteria-stale → spec-stale → drift-stale → age-stale → fresh
 *
 * `pinned` records suppress the two churn-based states (drift-stale, age-stale)
 * — a human vouched for them — but never the hash-based states, since a real
 * spec or criteria change must still surface.
 */

/**
 * @param {object|null} record  ledger record, or null if none exists
 * @param {{featureHash?:string|null, aspectHash?:string|null,
 *          staleness?:object, drift?:{count:number, unverifiable:boolean}}} ctx
 * @returns {{state:string, drift:number, unverifiable:boolean, priority:number}}
 */
export function computeFreshness(record, { featureHash, aspectHash, staleness, drift } = {}) {
	if (record == null) {
		// No prior audit — highest re-audit priority.
		return { state: 'missing', drift: 0, unverifiable: false, priority: Infinity };
	}

	const st = staleness || {};
	const driftCount = drift?.count ?? 0;
	const unverifiable = drift?.unverifiable ?? false;
	const priority = driftCount;
	const done = (state) => ({ state, drift: driftCount, unverifiable, priority });

	// 1. criteria-stale — aspect config changed (unless the aspect opts out).
	if (st['on-criteria-change'] !== 'ignore'
		&& aspectHash != null && record['aspect-hash'] != null
		&& record['aspect-hash'] !== aspectHash) {
		return done('criteria-stale');
	}

	// 2. spec-stale — the feature file changed (unless the aspect opts out).
	if (st['on-spec-change'] !== 'ignore'
		&& featureHash != null && record['feature-hash'] != null
		&& record['feature-hash'] !== featureHash) {
		return done('spec-stale');
	}

	const pinned = record.pinned === true;
	const threshold = st['drift-threshold'] ?? 1;
	const maxAgeMs = st['max-age'] ?? null;   // resolveStaleness() has parsed this to ms | null

	// Pinned records skip the churn-based states entirely.
	if (pinned) return done('fresh');

	// 3. drift-stale — enough commits touched the evidence since the audit.
	//    When drift is unverifiable, fall back to the age backstop.
	if (unverifiable) {
		if (maxAgeMs != null) {
			return isOverAge(record.audited, maxAgeMs) ? done('age-stale') : done('fresh');
		}
		// No age backstop and we can't verify drift → surface as stale (age-stale
		// bucket) rather than silently trust it.
		return { state: 'age-stale', drift: driftCount, unverifiable: true, priority };
	}
	if (driftCount >= threshold) return done('drift-stale');

	// 4. age-stale — wall-clock backstop, even without drift.
	if (maxAgeMs != null && isOverAge(record.audited, maxAgeMs)) return done('age-stale');

	// 5. fresh.
	return done('fresh');
}

/** Read the `staleness:` block off an aspect's parsed front-matter, filling defaults. */
export function resolveStaleness(aspectData) {
	const s = (aspectData && aspectData.staleness) || {};
	return {
		'drift-threshold': s['drift-threshold'] ?? 1,
		'max-age': parseMaxAge(s['max-age'] ?? null),
		'on-spec-change': s['on-spec-change'] ?? 'stale',
		'on-criteria-change': s['on-criteria-change'] ?? 'stale',
	};
}

/** Any non-fresh state is stale (missing counts as stale — it needs auditing). */
export function isStale(state) {
	return state !== 'fresh';
}

/** Parse a max-age spec (`30d`, `12w`, or a bare number of days) to milliseconds, or null. */
export function parseMaxAge(spec) {
	if (spec == null || spec === '') return null;
	if (typeof spec === 'number') return spec * DAY;
	const m = String(spec).trim().match(/^(\d+)\s*([dw])?$/i);
	if (!m) return null;
	const n = parseInt(m[1], 10);
	const unit = (m[2] || 'd').toLowerCase();
	return n * (unit === 'w' ? 7 * DAY : DAY);
}

const DAY = 24 * 60 * 60 * 1000;

function isOverAge(audited, maxAgeMs) {
	if (!audited) return false;
	const t = Date.parse(audited);
	if (Number.isNaN(t)) return false;
	return (Date.now() - t) > maxAgeMs;
}
