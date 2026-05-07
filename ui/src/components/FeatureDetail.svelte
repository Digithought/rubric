<script lang="ts">
	import { marked } from 'marked';
	import { api } from '../lib/api.js';
	import { router } from '../lib/router.svelte.js';
	import type { FeatureDetail as FeatureDetailData } from '../lib/types.js';
	import { asArray, asString } from '../lib/frontmatter.js';
	import StatusBadge from './StatusBadge.svelte';

	let { path }: { path: string } = $props();

	let detail = $state<FeatureDetailData | null>(null);
	let loading = $state(true);
	let error: string | null = $state(null);

	const status = $derived(detail ? asString(detail.meta.status) : undefined);
	const summary = $derived(detail ? asString(detail.meta.summary) : undefined);
	const description = $derived(detail ? asString(detail.meta.description) : undefined);
	const capabilities = $derived(detail ? asArray(detail.meta.capabilities) : []);
	const related = $derived(detail ? asArray(detail.meta.related) : []);

	const bodyHtml = $derived(detail ? marked.parse(detail.body) as string : '');

	$effect(() => {
		path; // reactive dependency
		loading = true;
		error = null;
		api.feature(path)
			.then(d => { detail = d; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});
</script>

<div class="header">
	<button class="back" onclick={() => router.navigate('/')}>← Features</button>
	{#if detail}
		<span class="code">{detail.code}</span>
		<h1 class="title">{detail.name}</h1>
		<StatusBadge {status} />
	{/if}
</div>

{#if loading}
	<div class="loading">Loading…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if detail}
	{#if summary}
		<div class="summary"><pre>{summary}</pre></div>
	{/if}

	<div class="meta-grid">
		{#if description}
			<div class="meta-block">
				<h3 class="section-label">Description</h3>
				<pre class="prose">{description}</pre>
			</div>
		{/if}

		{#if capabilities.length}
			<div class="meta-block">
				<h3 class="section-label">Capabilities</h3>
				<ul class="cap-list">
					{#each capabilities as cap}
						<li>{cap}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if related.length}
			<div class="meta-block">
				<h3 class="section-label">Related</h3>
				<div class="chips">
					{#each related as code}
						<code class="chip">{code}</code>
					{/each}
				</div>
			</div>
		{/if}

		<div class="meta-block">
			<h3 class="section-label">File</h3>
			<code class="filepath">features/{detail.path}</code>
		</div>
	</div>

	{#if detail.body.trim()}
		<div class="body-section">
			<h3 class="section-label">Body</h3>
			<div class="body-content md">{@html bodyHtml}</div>
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
	.code {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--primary);
	}
	.title { font-size: 1.25rem; font-weight: 700; flex: 1; }

	.loading, .error {
		text-align: center;
		padding: 2.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-muted);
	}
	.error { color: var(--danger); }

	.summary {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
	}
	.summary pre { font-size: 0.95rem; color: var(--text); }

	.meta-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.meta-block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.25rem;
	}
	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
	}
	.prose { font-size: 0.9rem; color: var(--text); }
	.cap-list {
		list-style: none;
		padding: 0;
	}
	.cap-list li {
		font-size: 0.875rem;
		padding: 0.25rem 0;
		border-bottom: 1px dashed var(--border);
	}
	.cap-list li:last-child { border-bottom: none; }

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
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

	.filepath {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.body-section {
		margin-top: 1rem;
	}
	.body-content {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}
</style>
