<script lang="ts">
	import { api } from '../lib/api.js';
	import type { AspectSummary } from '../lib/types.js';
	import StatusBadge from './StatusBadge.svelte';

	let aspects: AspectSummary[] = $state([]);
	let defaults: string[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);

	$effect(() => {
		loading = true;
		Promise.all([api.aspects(), api.defaultAspects()])
			.then(([a, d]) => { aspects = a; defaults = d; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});
</script>

<div class="header">
	<h1 class="title">Aspects</h1>
	<span class="count">{aspects.length} active</span>
</div>

{#if loading}
	<div class="loading">Loading…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if aspects.length === 0}
	<div class="empty">
		<p>No aspects activated for this project.</p>
		<p class="muted">
			Create a folder under <code>aspects/&lt;name&gt;/</code> with at least an
			<code>aspect.md</code>. See <code>rubric/agent-rules/add-aspect.md</code>
			for the activation workflow.
		</p>
		{#if defaults.length}
			<div class="defaults">
				<h4 class="section-label">Available default aspects</h4>
				<div class="chips">
					{#each defaults as name}
						<code class="chip">{name}</code>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="aspect-list">
		{#each aspects as a}
			<a class="card" href="#/aspect/{encodeURIComponent(a.name)}">
				<div class="card-header">
					<span class="aspect-name">{a.name}</span>
					<StatusBadge status={a.status} size="sm" />
					{#if a.extends && a.extends !== a.name}
						<span class="extends">extends {a.extends}</span>
					{/if}
					<span class="prompt-source" class:project={a.hasProjectPrompt}>
						{a.hasProjectPrompt ? 'project prompt' : a.hasDefaultPrompt ? 'default prompt' : 'no prompt'}
					</span>
				</div>
				<div class="card-meta">
					{#if a.level}<span class="meta">level: <strong>{a.level}</strong></span>{/if}
					{#if a.batch}<span class="meta">batch: <strong>{a.batch}</strong></span>{/if}
					{#if a.cadence?.length}
						<span class="meta">cadence: <strong>{a.cadence.join(', ')}</strong></span>
					{/if}
					{#if a.ticketSystem}
						<span class="meta">tickets: <strong>{a.ticketSystem}{a.ticketStage ? ` / ${a.ticketStage}` : ''}</strong></span>
					{/if}
				</div>
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
	.empty p { margin-bottom: 0.75rem; }
	.empty .muted { color: var(--text-muted); font-size: 0.9rem; }
	.empty code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--surface-raised);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.defaults {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}
	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		justify-content: center;
	}
	.chip {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		background: var(--primary-subtle);
		color: var(--primary);
		border-radius: 99px;
		font-weight: 600;
	}

	.aspect-list { display: flex; flex-direction: column; gap: 0.5rem; }
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
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.aspect-name {
		font-weight: 700;
		font-size: 1rem;
	}
	.extends {
		font-size: 0.7rem;
		color: var(--text-muted);
		font-style: italic;
	}
	.prompt-source {
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-left: auto;
	}
	.prompt-source.project { color: var(--primary); font-weight: 600; }

	.card-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.card-meta strong { color: var(--text); font-weight: 600; }
</style>
