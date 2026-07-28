<script lang="ts">
	import { api } from '../lib/api.js';
	import type { CoverageData, CoverageCell } from '../lib/types.js';
	import { verdictColor, verdictBackground } from '../lib/runs.js';

	let data = $state<CoverageData | null>(null);
	let loading = $state(true);
	let error: string | null = $state(null);

	$effect(() => {
		loading = true;
		api.coverage()
			.then(d => { data = d; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});

	function symbol(v: string | undefined): string {
		if (!v) return '·';
		if (v === 'covered') return '✓';
		if (v === 'partial') return '◐';
		if (v === 'gap') return '✗';
		if (v === 'na' || v === 'n/a' || v === 'n') return '–';
		if (v === 'blocked') return '‖';
		return '?';
	}

	// Accent hue for a freshness state, composed from existing :root tokens
	// (no new hex): hash-based staleness → warning, churn-based drift → info,
	// wall-clock age → muted. `fresh` and `missing` carry no accent.
	function freshnessAccent(freshness: string | undefined): string {
		switch (freshness) {
			case 'criteria-stale':
			case 'spec-stale':
				return 'var(--warning)';
			case 'drift-stale':
				return 'var(--info)';
			case 'age-stale':
				return 'var(--text-muted)';
			default:
				return 'transparent'; // fresh / missing / unknown
		}
	}

	function cellBg(cell: CoverageCell | undefined): string {
		if (!cell) return 'transparent';
		return verdictBackground(cell.verdict);
	}

	function isStale(cell: CoverageCell | undefined): boolean {
		return !!cell && cell.freshness !== 'fresh' && cell.freshness !== 'missing';
	}

	function tooltip(code: string, aspect: string, cell: CoverageCell | undefined): string {
		if (!cell) return `${code} × ${aspect}\nfreshness: missing (never audited)`;
		const parts = [
			`${code} × ${aspect}`,
			`verdict: ${cell.verdict}`,
			`freshness: ${cell.freshness}`,
		];
		if (typeof cell.drift === 'number') parts.push(`drift: ${cell.drift} commit${cell.drift === 1 ? '' : 's'}`);
		if (cell.audited) parts.push(`audited: ${cell.audited}`);
		if (cell.unverifiable) parts.push('drift: unverifiable (rebase/squash/shallow)');
		if (cell.pinned) parts.push('pinned');
		if (cell.ticket) parts.push(`ticket: ${cell.ticket}`);
		return parts.join('\n');
	}

	function encodePath(p: string): string {
		return p.split('/').map(encodeURIComponent).join('/');
	}
</script>

<div class="header">
	<h1 class="title">Coverage Matrix</h1>
	{#if data}
		<span class="count">
			{data.features.length} feature{data.features.length !== 1 ? 's' : ''}
			× {data.aspects.length} aspect{data.aspects.length !== 1 ? 's' : ''}
		</span>
	{/if}
</div>

{#if loading}
	<div class="loading">Loading…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if data}
	{#if data.aspects.length === 0}
		<div class="empty">
			<p>No active aspects yet.</p>
			<p class="muted">
				Coverage is derived from the per-aspect ledgers
				(<code>aspects/&lt;name&gt;/coverage.md</code>). Activate at least one aspect
				(under <code>aspects/</code>) and run an audit to seed a ledger and populate this view.
			</p>
		</div>
	{:else if data.features.length === 0}
		<div class="empty">No features in inventory.</div>
	{:else}
		<div class="legends">
			<div class="legend">
				<span class="leg-label">Verdict</span>
				<span class="leg"><span class="sym" style:color="var(--success)">✓</span> covered</span>
				<span class="leg"><span class="sym" style:color="var(--warning)">◐</span> partial</span>
				<span class="leg"><span class="sym" style:color="var(--danger)">✗</span> gap</span>
				<span class="leg"><span class="sym" style:color="var(--text-light)">–</span> n/a</span>
				<span class="leg"><span class="sym" style:color="var(--text-light)">·</span> missing</span>
			</div>
			<div class="legend">
				<span class="leg-label">Freshness</span>
				<span class="leg"><span class="swatch fresh"></span> fresh</span>
				<span class="leg"><span class="swatch stale" style:--fresh-accent="var(--warning)"></span> spec / criteria-stale</span>
				<span class="leg"><span class="swatch stale" style:--fresh-accent="var(--info)"></span> drift-stale</span>
				<span class="leg"><span class="swatch stale" style:--fresh-accent="var(--text-muted)"></span> age-stale</span>
				<span class="leg"><span class="swatch missing"></span> missing</span>
			</div>
		</div>

		<div class="matrix-wrap">
			<table class="matrix">
				<thead>
					<tr>
						<th class="corner">Feature</th>
						{#each data.aspects as a}
							<th class="aspect-col">
								<a href="#/aspect/{encodeURIComponent(a.name)}">{a.name}</a>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each data.features as f}
						<tr>
							<td class="feature-cell">
								{#if f.hasFile}
									<a href="#/feature/{encodePath(f.path)}">
										<code class="fcode">{f.code}</code>
										<span class="fname">{f.name}</span>
									</a>
								{:else}
									<code class="fcode dir">{f.code}</code>
									<span class="fname">{f.name}</span>
								{/if}
							</td>
							{#each data.aspects as a}
								{@const cell = data.matrix[f.code]?.[a.name]}
								<td
									class="cell"
									class:stale={isStale(cell)}
									style:color={cell ? verdictColor(cell.verdict) : 'var(--text-light)'}
									style:background={cellBg(cell)}
									style:--fresh-accent={freshnessAccent(cell?.freshness)}
									title={tooltip(f.code, a.name, cell)}
								>
									{symbol(cell?.verdict)}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

<style>
	.header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.title { font-size: 1.25rem; font-weight: 700; }
	.count { font-size: 0.8rem; color: var(--text-muted); margin-left: auto; }

	.loading, .error {
		text-align: center;
		padding: 2.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-muted);
	}
	.error { color: var(--danger); }

	.empty {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
		text-align: center;
	}
	.empty p { margin-bottom: 0.5rem; }
	.empty .muted { color: var(--text-muted); font-size: 0.9rem; }
	.empty code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--surface-raised);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}

	.legends {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	.legend {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: center;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.leg-label {
		font-weight: 700;
		color: var(--text-light);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-size: 0.65rem;
		min-width: 4.5rem;
	}
	.leg { display: flex; align-items: center; gap: 0.25rem; }
	.sym { font-size: 1rem; font-weight: 700; }

	/* Freshness legend swatches mirror the in-cell treatment. */
	.swatch {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border-radius: 3px;
		background: var(--surface-raised);
		position: relative;
	}
	.swatch.fresh { background: var(--success-subtle); }
	.swatch.missing { background: transparent; border: 1px dotted var(--text-light); }
	.swatch.stale {
		outline: 1px dashed var(--fresh-accent);
		outline-offset: -3px;
	}
	.swatch.stale::after {
		content: '';
		position: absolute;
		top: 1px;
		right: 1px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--fresh-accent);
	}

	.matrix-wrap {
		overflow-x: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.matrix {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.8rem;
	}
	.matrix th, .matrix td {
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--border);
		text-align: center;
	}
	.matrix thead th {
		background: var(--surface-raised);
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.corner {
		text-align: left;
		min-width: 14rem;
	}
	.aspect-col {
		min-width: 4.5rem;
		font-weight: 600;
	}
	.aspect-col a {
		color: var(--text);
		text-decoration: none;
	}
	.aspect-col a:hover {
		color: var(--primary);
	}
	.feature-cell {
		text-align: left;
		white-space: nowrap;
	}
	.feature-cell a {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		color: inherit;
		text-decoration: none;
	}
	.feature-cell a:hover .fname { color: var(--primary); }
	.fcode {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--primary);
	}
	.fcode.dir { color: var(--text-light); }
	.fname { color: var(--text); font-size: 0.85rem; }

	.cell {
		font-size: 1.1rem;
		font-weight: 700;
		min-width: 3rem;
		position: relative;
	}
	/* Stale cells keep their verdict symbol + tint but gain a dashed accent
	   border (inset via outline so no layout shift) and a corner dot whose
	   hue names the stale category. */
	.cell.stale {
		outline: 1px dashed var(--fresh-accent);
		outline-offset: -3px;
	}
	.cell.stale::after {
		content: '';
		position: absolute;
		top: 3px;
		right: 3px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--fresh-accent);
	}
</style>
