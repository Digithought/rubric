<script lang="ts">
	import { marked } from 'marked';
	import { api } from '../lib/api.js';
	import { router } from '../lib/router.svelte.js';
	import type { AspectDetail as AspectDetailData } from '../lib/types.js';

	let { name }: { name: string } = $props();

	function formatValue(val: unknown): string {
		if (val === undefined || val === null) return '—';
		if (Array.isArray(val)) return val.length ? val.join(', ') : '[]';
		if (typeof val === 'object') return JSON.stringify(val);
		const s = String(val);
		return s || '—';
	}

	let detail = $state<AspectDetailData | null>(null);
	let loading = $state(true);
	let error: string | null = $state(null);

	const promptHtml = $derived(detail?.prompt.content ? marked.parse(detail.prompt.content) as string : '');
	const bodyHtml = $derived(detail?.body ? marked.parse(detail.body) as string : '');
	const tplHtml = $derived(detail?.ticketTemplate.content ? marked.parse(detail.ticketTemplate.content) as string : '');

	$effect(() => {
		name;
		loading = true;
		error = null;
		api.aspect(name)
			.then(d => { detail = d; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});
</script>

<div class="header">
	<button class="back" onclick={() => router.navigate('/aspects')}>← Aspects</button>
	{#if detail}
		<h1 class="title">{detail.name}</h1>
		{#if detail.extends && detail.extends !== detail.name}
			<span class="extends">extends {detail.extends}</span>
		{/if}
	{/if}
</div>

{#if loading}
	<div class="loading">Loading…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if detail}
	<div class="config">
		<h3 class="section-label">Configuration</h3>
		<div class="config-grid">
			{#each Object.entries(detail.meta) as [key, val]}
				<div class="config-row">
					<span class="config-key">{key}</span>
					<span class="config-val">{formatValue(val)}</span>
				</div>
			{/each}
		</div>
	</div>

	{#if detail.body.trim()}
		<div class="block">
			<h3 class="section-label">Notes</h3>
			<div class="md content">{@html bodyHtml}</div>
		</div>
	{/if}

	<div class="block">
		<h3 class="section-label">
			Prompt
			<span class="badge {detail.prompt.source}">{detail.prompt.source}</span>
		</h3>
		{#if detail.prompt.source === 'missing'}
			<div class="empty-inline">No prompt found. The project must supply <code>prompt.md</code>.</div>
		{:else}
			<div class="md content">{@html promptHtml}</div>
		{/if}
	</div>

	{#if detail.ticketTemplate.source !== 'missing'}
		<div class="block">
			<h3 class="section-label">
				Ticket template
				<span class="badge {detail.ticketTemplate.source}">{detail.ticketTemplate.source}</span>
			</h3>
			<div class="md content">{@html tplHtml}</div>
		</div>
	{/if}
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
	.extends {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-style: italic;
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

	.config {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
	}
	.config-grid {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.4rem 1.25rem;
	}
	.config-row {
		display: contents;
	}
	.config-key {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-muted);
		font-weight: 600;
	}
	.config-val {
		font-size: 0.875rem;
		color: var(--text);
	}

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
		margin-bottom: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.badge {
		font-size: 0.6rem;
		padding: 0.1rem 0.45rem;
		border-radius: 99px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 700;
	}
	.badge.project { background: var(--primary-subtle); color: var(--primary); }
	.badge.default { background: var(--info-subtle); color: var(--info); }
	.badge.missing { background: var(--danger-subtle); color: var(--danger); }

	.empty-inline {
		color: var(--text-muted);
		font-size: 0.875rem;
	}
	.empty-inline code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--surface-raised);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.content { font-size: 0.9rem; }
</style>
