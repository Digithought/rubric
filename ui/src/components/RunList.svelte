<script lang="ts">
	import { api } from '../lib/api.js';
	import type { RunSummary } from '../lib/types.js';
	import { formatDuration } from '../lib/runs.js';

	let runs: RunSummary[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);

	$effect(() => {
		loading = true;
		api.runs()
			.then(r => { runs = r; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});
</script>

<div class="header">
	<h1 class="title">Run Logs</h1>
	<span class="count">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
</div>

{#if loading}
	<div class="loading">Loading…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if runs.length === 0}
	<div class="empty">
		<p>No audits run yet.</p>
		<p class="muted">
			Run logs appear in <code>.runs/&lt;ISO-datetime&gt;-&lt;aspect&gt;.md</code>
			after an audit completes.
		</p>
	</div>
{:else}
	<div class="run-list">
		{#each runs as run}
			<a class="card" href="#/run/{encodeURIComponent(run.filename)}">
				<div class="card-header">
					<span class="aspect-name">{run.aspect}</span>
					<span class="time">{run.started ?? '—'}</span>
					{#if formatDuration(run.started, run.finished)}
						<span class="duration">{formatDuration(run.started, run.finished)}</span>
					{/if}
					<span class="batch-size">{run.batch.length} feature{run.batch.length !== 1 ? 's' : ''}</span>
				</div>
				<div class="tally">
					<span class="t covered">{run.tally.covered} covered</span>
					<span class="t partial">{run.tally.partial} partial</span>
					<span class="t gap">{run.tally.gap} gap</span>
					<span class="t na">{run.tally.na} n/a</span>
				</div>
				{#if run.batch.length > 0}
					<div class="batch-codes">
						{#each run.batch.slice(0, 10) as code}
							<code class="chip">{code}</code>
						{/each}
						{#if run.batch.length > 10}
							<span class="more">+{run.batch.length - 10} more</span>
						{/if}
					</div>
				{/if}
			</a>
		{/each}
	</div>
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

	.run-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.card {
		display: block;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.875rem 1rem;
		text-decoration: none;
		color: inherit;
		transition: all var(--transition);
	}
	.card:hover {
		border-color: var(--primary);
		box-shadow: var(--shadow-lg);
		transform: translateY(-1px);
		text-decoration: none;
	}
	.card-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.aspect-name { font-weight: 700; font-size: 0.95rem; }
	.time {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.duration {
		font-size: 0.7rem;
		color: var(--text-light);
	}
	.batch-size {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-left: auto;
	}

	.tally {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.t {
		padding: 0.125rem 0.5rem;
		border-radius: 99px;
		font-weight: 600;
	}
	.t.covered { background: var(--success-subtle); color: var(--success); }
	.t.partial { background: var(--warning-subtle); color: var(--warning); }
	.t.gap { background: var(--danger-subtle); color: var(--danger); }
	.t.na { background: var(--bg); color: var(--text-light); }

	.batch-codes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chip {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		background: var(--bg);
		color: var(--text-muted);
		border-radius: 4px;
	}
	.more {
		font-size: 0.7rem;
		color: var(--text-light);
	}
</style>
