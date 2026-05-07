import type { FeatureNode } from './types.js';

// Walk the tree in pre-order, returning a flat array of nodes. Useful for
// search filtering where we still want a flat list to render.
export function flatten(tree: FeatureNode[], out: FeatureNode[] = []): FeatureNode[] {
	for (const n of tree) {
		out.push(n);
		flatten(n.children, out);
	}
	return out;
}

// Return only nodes whose code or name matches the query (case-insensitive).
// Always preserves children of matches so the user keeps context.
export function filterTree(tree: FeatureNode[], query: string): FeatureNode[] {
	if (!query.trim()) return tree;
	const q = query.toLowerCase();

	function visit(node: FeatureNode): FeatureNode | null {
		const selfMatch =
			node.code.toLowerCase().includes(q) ||
			node.name.toLowerCase().includes(q);
		const filteredChildren = node.children
			.map(visit)
			.filter((n): n is FeatureNode => n !== null);
		if (selfMatch || filteredChildren.length > 0) {
			return { ...node, children: selfMatch ? node.children : filteredChildren };
		}
		return null;
	}

	return tree.map(visit).filter((n): n is FeatureNode => n !== null);
}
