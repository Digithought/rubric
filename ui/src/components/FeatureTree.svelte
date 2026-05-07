<script lang="ts">
	import { api } from '../lib/api.js';
	import type { FeatureNode } from '../lib/types.js';
	import { filterTree } from '../lib/feature-tree.js';

	function encodePath(p: string): string {
		return p.split('/').map(encodeURIComponent).join('/');
	}

	let tree: FeatureNode[] = $state([]);
	let loading = $state(true);
	let query = $state('');
	let error: string | null = $state(null);

	const filtered = $derived(filterTree(tree, query));
	const total = $derived(countNodes(tree));
	const shown = $derived(countNodes(filtered));

	function countNodes(nodes: FeatureNode[]): number {
		let n = 0;
		for (const node of nodes) {
			n += 1 + countNodes(node.children);
		}
		return n;
	}

	$effect(() => {
		loading = true;
		api.features()
			.then(t => { tree = t; loading = false; })
			.catch(err => { error = err.message; loading = false; });
	});
</script>

<div class="header">
	<h1 class="title">Features</h1>
	<span class="count">
		{shown === total ? `${total} feature${total !== 1 ? 's' : ''}` : `${shown} of ${total}`}
	</span>
</div>

<input
	class="search"
	type="search"
	placeholder="Search by code or name…"
	bind:value={query}
/>

{#if loading}
	<div class="loading">Loading feature inventory…</div>
{:else if error}
	<div class="error">Error: {error}</div>
{:else if tree.length === 0}
	<div class="empty">
		No features found. Create your first feature file as
		<code>features/&lt;CODE&gt; - &lt;Name&gt;.md</code>.
	</div>
{:else}
	<div class="tree">
		{#each filtered as node}
			{@render renderNode(node, 0)}
		{/each}
	</div>
{/if}

{#snippet renderNode(node: FeatureNode, depth: number)}
	<a class="row" style:padding-left="{0.75 + depth * 1.25}rem" href="#/feature/{encodePath(node.path)}">
		<span class="code">{node.code}</span>
		<span class="name">{node.name}</span>
		{#if !node.hasFile}
			<span class="placeholder">dir-only</span>
		{/if}
	</a>
	{#each node.children as child}
		{@render renderNode(child, depth + 1)}
	{/each}
{/snippet}

<style>
	.header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}
	.title { font-size: 1.25rem; font-weight: 700; }
	.count {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-left: auto;
	}
	.search {
		width: 100%;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		margin-bottom: 0.75rem;
	}
	.search:focus {
		outline: none;
		border-color: var(--primary);
	}
	.loading, .empty, .error {
		text-align: center;
		padding: 2.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-muted);
	}
	.error { color: var(--danger); }
	.empty code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--surface-raised);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.tree {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		text-decoration: none;
		color: inherit;
		border-bottom: 1px solid var(--border);
		transition: background var(--transition);
	}
	.row:last-child { border-bottom: none; }
	.row:hover { background: var(--surface-raised); text-decoration: none; }
	.code {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--primary);
		min-width: 8rem;
	}
	.name {
		font-size: 0.9rem;
		color: var(--text);
	}
	.placeholder {
		font-size: 0.7rem;
		color: var(--text-light);
		font-style: italic;
		margin-left: auto;
	}
</style>
