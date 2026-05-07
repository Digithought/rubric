<script lang="ts">
	import { marked } from 'marked';
	import { api } from '../lib/api.js';
	import { router } from '../lib/router.svelte.js';
	import type { RunDetail as RunDetailData } from '../lib/types.js';
	import { verdictColor, verdictBackground, formatDuration } from '../lib/runs.js';

	let { filename }: { filename: string } = $props();

	let detail = $state<RunDetailData | null>(null);
	let loading = $state(true);
	let error: string | null = $state(null);

	const bodyHtml = $derived(detail ? marked.parse(detail.body) as string : '');

	$effect(() => {
		filename;
		loading = true;
		error = null;
		api.run(filename)
			.then(d => { detail = d; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});
</script>

<div class="header">
	<button class="back" onclick={() => router.navigate('/runs')}>← Runs</button>
	{#if detail}
		<h1 class="title">{detail.aspect}</h1>
		<span class="filename">{detail.filename}</span>
	{/if}
</div>

{#if loading}
	<div class="loading">Loading…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if detail}
	<div class="meta-bar">
		<div class="meta-item">
			<span class="meta-label">Started</span>
			<span class="meta-value">{detail.started ?? '—'}</span>
		</div>
		<div class="meta-item">
			<span class="meta-label">Finished</span>
			<span class="meta-value">{detail.finished ?? '—'}</span>
		</div>
		{#if formatDuration(detail.started, detail.finished)}
			<div class="meta-item">
				<span class="meta-label">Duration</span>
				<span class="meta-value">{formatDuration(detail.started, detail.finished)}</span>
			</div>
		{/if}
		{#if detail.runner}
			<div class="meta-item">
				<span class="meta-label">Runner</span>
				<span class="meta-value">{detail.runner}</span>
			</div>
		{/if}
	</div>

	{#if detail.verdicts.length}
		<div class="block">
			<h3 class="section-label">Verdicts</h3>
			<div class="verdicts">
				{#each detail.verdicts as v}
					<div
						class="verdict-row"
						style:background={verdictBackground(v.verdict)}
						style:border-color={verdictColor(v.verdict)}
					>
						<code class="vcode">{v.code}</code>
						<span class="vverdict" style:color={verdictColor(v.verdict)}>{v.verdict}</span>
						<span class="vline">{v.line}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="block">
		<h3 class="section-label">Body</h3>
		<div class="md content">{@html bodyHtml}</div>
	</div>
{/if}

<style>
	.header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.back {
		color: var(--text-muted);
		font-size: 0.875rem;
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius);
		transition: all var(--transition);
	}
	.back:hover { background: var(--surface); color: var(--text); }
	.title { font-size: 1.25rem; font-weight: 700; }
	.filename {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-left: auto;
	}

	.loading, .error {
		text-align: center;
		padding: 2.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-muted);
	}
	.error { color: var(--danger); }

	.meta-bar {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.875rem 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}
	.meta-item { display: flex; flex-direction: column; gap: 0.125rem; }
	.meta-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.meta-value { font-size: 0.875rem; color: var(--text); }

	.block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
	}
	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
	}

	.verdicts { display: flex; flex-direction: column; gap: 0.25rem; }
	.verdict-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		border-left-width: 3px;
	}
	.vcode {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 700;
		min-width: 7rem;
	}
	.vverdict {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-width: 5rem;
	}
	.vline {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		flex: 1;
	}

	.content { font-size: 0.9rem; }
</style>
