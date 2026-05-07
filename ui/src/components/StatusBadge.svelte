<script lang="ts">
	import { statusVariant } from '../lib/frontmatter.js';

	let { status, size = 'md' }: { status: string | undefined; size?: 'sm' | 'md' } = $props();

	const variant = $derived(statusVariant(status));
	const label = $derived(status ?? 'unknown');
</script>

<span class="badge {variant} {size}">{label}</span>

<style>
	.badge {
		display: inline-block;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.125rem 0.5rem;
		border-radius: 99px;
		line-height: 1.4;
	}
	.badge.sm { font-size: 0.6rem; }
	.badge.md { font-size: 0.65rem; }
	.success { background: var(--success-subtle); color: var(--success); }
	.warning { background: var(--warning-subtle); color: var(--warning); }
	.info { background: var(--info-subtle); color: var(--info); }
	.muted { background: var(--bg); color: var(--text-muted); }
</style>
