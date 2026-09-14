import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteFrontmatter } from './feature-text.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

// Contract: rewriteFrontmatter's doc comment — an edit takes a whole key or item as the parser reads
// it, and every other byte (the body, comments, each line's own ending) stays as written.

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
// The body repeats front-matter shapes, so any edit reaching past the closing fence would show.
const BODY = '# Picking\n\ncapabilities:\n  - text: body text, not front-matter\n    target: GA\ntarget: GA\n';
const file = (...lines) => fm(...lines) + BODY;
const plainAll = { capability: () => 'plain' };

test('dropKeys removes each named top-level key with every line it owns, comments included, and nothing else', () => {
	const raw = file(
		'status: planned',
		'surfaces: [web]',
		'aspects:',
		'  performance:',
		'    budget: "2 s"',
		'  # owned by aspects:',
		'target: GA',
		'related: [SCN]',
	);

	assert.equal(rewriteFrontmatter(raw, { dropKeys: new Set(['aspects', 'surfaces', 'target']) }), file('status: planned', 'related: [SCN]'));
});

test('capability drop removes the whole item; the callback sees each item as walkFeatures normalises it', () => {
	const raw = file('capabilities:', '  - Pick an entity', '  - text: Export to KML', '    target: GA', '  - Undo a pick');
	const seen = [];
	const out = rewriteFrontmatter(raw, {
		capability: (cap) => { seen.push(cap); return cap.target || cap.text === 'Undo a pick' ? 'drop' : 'keep'; },
	});

	assert.equal(out, file('capabilities:', '  - Pick an entity'));
	assert.deepEqual(seen, [
		{ text: 'Pick an entity', target: null, line: 3 },
		{ text: 'Export to KML', target: 'GA', line: 4 },
		{ text: 'Undo a pick', target: null, line: 6 },
	]);
});

test('capability plain rewrites a text:/target: item as - <text> at its dash indent — text first, target first, or under a bare dash — keeping comments inside it', () => {
	const raw = file(
		'capabilities:',
		'  - text: Export to KML',
		'    target: GA',
		'  - target: GA',
		'    # why it waits',
		'    text: Export to DXF',
		'  -',
		'    text: Export to CSV',
		'    target: GA',
		'  - Already plain',
	);

	assert.equal(rewriteFrontmatter(raw, plainAll), file(
		'capabilities:',
		'  - Export to KML',
		'  - Export to DXF',
		'    # why it waits',
		'  - Export to CSV',
		'  - Already plain',
	));
});

test('capability plain keeps the text as written after text: unless it would read differently as a list item, and then quotes it', () => {
	const raw = file(
		'capabilities:',
		'  - text: Export: KML',
		'    target: GA',
		'  - text: >-',
		'      Export to',
		'      DXF',
		'    target: GA',
		'  - text: "Supports 3D: yes"',
		'    target: GA',
	);
	const out = rewriteFrontmatter(raw, plainAll);

	assert.equal(out, file('capabilities:', '  - "Export: KML"', '  - Export to DXF', '  - "Supports 3D: yes"'));
	assert.deepEqual(parseFrontmatter(out).data.capabilities, ['Export: KML', 'Export to DXF', 'Supports 3D: yes']);
});

test('capability plain leaves an item with another key, or with multi-line text, as written', () => {
	const raw = file(
		'capabilities:',
		'  - text: Export to KML',
		'    target: GA',
		'    note: extra',
		'  - text: |',
		'      Two',
		'      lines',
		'    target: GA',
	);

	assert.equal(rewriteFrontmatter(raw, plainAll), raw);
});

test('an inline capabilities list is written again from the edited list when an item changes, and left alone when none does', () => {
	const raw = file('capabilities: [Pick an entity, { text: Export to KML, target: GA }, { text: Import, target: LATER }]');
	const unchanged = file('capabilities: [Pick an entity, "Quoted: item"]');

	assert.equal(rewriteFrontmatter(raw, { capability: cap => (cap.target === 'LATER' ? 'drop' : 'plain') }), file('capabilities: [Pick an entity, Export to KML]'));
	assert.equal(rewriteFrontmatter(unchanged, plainAll), unchanged);
});

test('a CRLF file keeps CRLF on every line, edited or not, and rewrites to its LF copy\'s result', () => {
	const raw = file('status: planned', 'target: GA', 'capabilities:', '  - target: GA', '    text: Export to KML');
	const edits = { dropKeys: new Set(['target']), ...plainAll };

	assert.equal(rewriteFrontmatter(raw.replace(/\n/g, '\r\n'), edits), rewriteFrontmatter(raw, edits).replace(/\n/g, '\r\n'));
});

test('a file with nothing to change, or no front-matter at all, comes back as the same string', () => {
	const raw = file('status: planned', 'capabilities:', '  - Pick an entity');
	const edits = { dropKeys: new Set(['target', 'aspects']), ...plainAll };

	assert.equal(rewriteFrontmatter(raw, edits), raw);
	assert.equal(rewriteFrontmatter(BODY, { dropKeys: new Set(['capabilities', 'target']), ...plainAll }), BODY);
});
