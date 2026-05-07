<script lang="ts">
	import { router } from './lib/router.svelte.js';
	import FeatureTree from './components/FeatureTree.svelte';
	import FeatureDetail from './components/FeatureDetail.svelte';
	import AspectList from './components/AspectList.svelte';
	import AspectDetail from './components/AspectDetail.svelte';
	import RunList from './components/RunList.svelte';
	import RunDetail from './components/RunDetail.svelte';
	import CoverageMatrix from './components/CoverageMatrix.svelte';

	const featureMatch = $derived(router.match('/feature/:path*'));
	const aspectsRoot = $derived(router.path === '/aspects');
	const aspectMatch = $derived(router.match('/aspect/:name'));
	const runsRoot = $derived(router.path === '/runs');
	const runMatch = $derived(router.match('/run/:filename'));
	const coverageRoot = $derived(router.path === '/coverage');

	const tab = $derived(
		aspectsRoot || aspectMatch ? 'aspects'
			: runsRoot || runMatch ? 'runs'
			: coverageRoot ? 'coverage'
			: 'features'
	);
</script>

<nav class="nav">
	<a class="nav-brand" href="#/">Rubric</a>
	<div class="nav-links">
		<a class="nav-link" class:active={tab === 'features'} href="#/">Features</a>
		<a class="nav-link" class:active={tab === 'aspects'} href="#/aspects">Aspects</a>
		<a class="nav-link" class:active={tab === 'runs'} href="#/runs">Runs</a>
		<a class="nav-link" class:active={tab === 'coverage'} href="#/coverage">Coverage</a>
	</div>
</nav>

<main class="main">
	{#if featureMatch}
		<FeatureDetail path={featureMatch.path} />
	{:else if aspectMatch}
		<AspectDetail name={aspectMatch.name} />
	{:else if aspectsRoot}
		<AspectList />
	{:else if runMatch}
		<RunDetail filename={runMatch.filename} />
	{:else if runsRoot}
		<RunList />
	{:else if coverageRoot}
		<CoverageMatrix />
	{:else}
		<FeatureTree />
	{/if}
</main>

<style>
	.nav {
		display: flex;
		align-items: center;
		gap: 2rem;
		padding: 0 1.5rem;
		height: 56px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		box-shadow: var(--shadow);
		position: sticky;
		top: 0;
		z-index: 100;
	}
	.nav-brand {
		font-weight: 700;
		font-size: 1.125rem;
		color: var(--text);
		letter-spacing: -0.02em;
	}
	.nav-brand:hover { text-decoration: none; }
	.nav-links { display: flex; gap: 0.25rem; flex: 1; }
	.nav-link {
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius);
		color: var(--text-muted);
		font-weight: 500;
		font-size: 0.875rem;
		transition: all var(--transition);
	}
	.nav-link:hover { background: var(--bg); color: var(--text); text-decoration: none; }
	.nav-link.active { background: var(--primary-subtle); color: var(--primary); }
	.main {
		max-width: 1280px;
		margin: 0 auto;
		padding: 1.5rem;
	}
</style>
