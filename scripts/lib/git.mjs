/**
 * Thin git wrappers for drift-based staleness.
 *
 * Everything here tolerates a non-git tree, a shallow clone, or a commit that
 * has fallen out of history (rebase/squash) by returning nulls / `unverifiable`
 * rather than throwing. Drift is a best-effort signal; the ledger degrades to
 * age-based staleness when git can't answer.
 *
 * Paths are compared repo-relative with forward slashes. The glob matcher
 * understands `**` (any depth, crossing `/`), `*` (within a segment), and
 * literal segments — the subset audit evidence actually uses.
 */

import { execFileSync } from 'node:child_process';

/** Run git, capturing stdout. Returns null on any failure (incl. non-git tree). */
function git(cwd, args) {
	try {
		return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return null;
	}
}

/** Short sha of HEAD, or null if this isn't a git repo / has no commits. */
export function gitHead(cwd) {
	const out = git(cwd, ['rev-parse', '--short', 'HEAD']);
	return out ? out.trim() : null;
}

/** True if `sha` is an ancestor of (or equal to) HEAD. False on any error/absence. */
export function commitInHistory(cwd, sha) {
	if (!sha) return false;
	try {
		execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd, stdio: 'ignore' });
		return true;   // exit 0 → ancestor
	} catch {
		return false;  // exit 1 → not ancestor; other → error, treat as absent
	}
}

/**
 * Count commits in `<sinceCommit>..HEAD` that touch any path matching `globs`.
 *
 * @returns {{count:number, unverifiable:boolean}}
 *   - `globs` empty → `{ count: 0, unverifiable: false }` (a record with no
 *     evidence can never go drift-stale).
 *   - `sinceCommit` missing or absent from history → `{ count: 0, unverifiable: true }`
 *     (caller falls back to age-based staleness).
 */
export function commitsTouching(cwd, sinceCommit, globs) {
	if (!globs || globs.length === 0) return { count: 0, unverifiable: false };
	if (!sinceCommit) return { count: 0, unverifiable: true };
	if (!commitInHistory(cwd, sinceCommit)) return { count: 0, unverifiable: true };

	const out = git(cwd, ['log', `${sinceCommit}..HEAD`, '--name-only', '--format=%x00%H']);
	if (out == null) return { count: 0, unverifiable: true };

	const regexes = globs.map(globToRegex);
	// `%x00%H` prefixes each commit with a NUL, so splitting the whole log on NUL
	// yields one block per commit (the first split element, before any NUL, is empty).
	const blocks = out.split('\0').slice(1);
	let count = 0;
	for (const block of blocks) {
		const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
		const files = lines.slice(1);   // line 0 is the sha
		if (files.some(f => regexes.some(r => r.test(f)))) count++;
	}
	return { count, unverifiable: false };
}

/** Compile a repo-relative glob (`**`, `*`, literals) to an anchored RegExp. */
export function globToRegex(glob) {
	const g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '').trim();
	let re = '';
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === '*') {
			if (g[i + 1] === '*') {
				i++;
				if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; }  // **/ → any dirs (or none)
				else re += '.*';                                   // ** → anything, crossing /
			} else {
				re += '[^/]*';                                     // * → within one segment
			}
		} else if ('/.+^${}()|[]\\'.includes(c)) {
			re += '\\' + c;
		} else {
			re += c;
		}
	}
	return new RegExp('^' + re + '$');
}

/** True if a repo-relative path matches any of the globs. */
export function pathMatchesAny(path, globs) {
	const p = String(path).replace(/\\/g, '/');
	return (globs || []).some(g => globToRegex(g).test(p));
}
