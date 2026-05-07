// Hash-based router with parameter matching, mirroring tess/ui/src/lib/router.svelte.ts.
// Supports a final `:rest*` segment that captures the remainder of the path
// (used so we can pass nested feature paths like SCN - Scene/TRN - Transform Composition.md).

class Router {
	hash = $state(window.location.hash.slice(1) || '/');

	constructor() {
		window.addEventListener('hashchange', () => {
			this.hash = window.location.hash.slice(1) || '/';
		});
	}

	get path() { return this.hash.split('?')[0]; }

	get query(): Record<string, string> {
		const qs = this.hash.split('?')[1];
		return qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
	}

	navigate(path: string) {
		window.location.hash = path;
	}

	match(pattern: string): Record<string, string> | null {
		const pp = pattern.split('/');
		const hp = this.path.split('/');
		const params: Record<string, string> = {};
		for (let i = 0; i < pp.length; i++) {
			const seg = pp[i];
			if (seg.startsWith(':') && seg.endsWith('*')) {
				// rest capture
				const name = seg.slice(1, -1);
				params[name] = hp.slice(i).map(decodeURIComponent).join('/');
				return params;
			}
			if (i >= hp.length) return null;
			if (seg.startsWith(':')) {
				params[seg.slice(1)] = decodeURIComponent(hp[i]);
			} else if (seg !== hp[i]) {
				return null;
			}
		}
		if (hp.length !== pp.length) return null;
		return params;
	}
}

export const router = new Router();
