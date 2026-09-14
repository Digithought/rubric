import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFrontmatter, parseYaml, scanFrontmatter } from './frontmatter.mjs';

// Contract: scanFrontmatter's doc comment — spans come from the same segmentation parseYaml uses.

const FEATURE = [
	'---',                                // 0
	'status: planned',                    // 1
	'summary: |',                         // 2
	'  First line.',                      // 3
	'',                                   // 4
	'  Second paragraph.',                // 5
	'',                                   // 6
	'# a comment between keys',           // 7
	'capabilities:',                      // 8
	'  - Plain capability',               // 9
	'  # a comment inside the list',      // 10
	'  - text: Export to KML',            // 11
	'    target: GA',                     // 12
	'',                                   // 13
	'  - "Quoted: capability"',           // 14
	'',                                   // 15
	'aspects:',                           // 16
	'  performance:',                     // 17
	'    budget: "2 s"',                  // 18
	'related: [SCN, TER]',                // 19
	'---',                                // 20
	'# Body',                             // 21
	'related: not front-matter',          // 22
	'',
].join('\n');

const EXPECTED_KEYS = [
	{ key: 'status', line: 1, end: 1, items: null },
	{ key: 'summary', line: 2, end: 5, items: null },
	{ key: 'capabilities', line: 8, end: 14, items: [{ line: 9, end: 9 }, { line: 11, end: 12 }, { line: 14, end: 14 }] },
	{ key: 'aspects', line: 16, end: 18, items: null },
	{ key: 'related', line: 19, end: 19, items: null },
];

test('scanFrontmatter: key spans cover block scalars, block lists and nested mappings, ending before trailing blank lines; body lines are not keys', () => {
	const scan = scanFrontmatter(FEATURE);

	assert.equal(scan.eol, '\n');
	assert.equal(scan.start, 1);
	assert.equal(scan.end, 19);
	assert.deepEqual(scan.keys, EXPECTED_KEYS);
});

test('scanFrontmatter: each key span, parsed alone, is the value parseFrontmatter reads for that key', () => {
	const scan = scanFrontmatter(FEATURE);
	const { data } = parseFrontmatter(FEATURE);

	for (const { key, line, end } of scan.keys) {
		assert.deepEqual(parseYaml(scan.lines.slice(line, end + 1).join('\n'))[key], data[key], key);
	}
});

test('scanFrontmatter: each item span, parsed as a one-item list, is that item — scalar and mapping items alike', () => {
	const scan = scanFrontmatter(FEATURE);
	const { data } = parseFrontmatter(FEATURE);
	const { items } = scan.keys.find(k => k.key === 'capabilities');

	assert.deepEqual(data.capabilities, ['Plain capability', { text: 'Export to KML', target: 'GA' }, 'Quoted: capability']);
	items.forEach((item, i) => {
		const alone = parseYaml(['capabilities:', ...scan.lines.slice(item.line, item.end + 1)].join('\n'));
		assert.deepEqual(alone.capabilities, [data.capabilities[i]]);
	});
});

test('scanFrontmatter: a CRLF file has the same spans and lines as its LF copy, and reports its line ending', () => {
	const scan = scanFrontmatter(FEATURE.replace(/\n/g, '\r\n'));

	assert.equal(scan.eol, '\r\n');
	assert.deepEqual(scan.keys, EXPECTED_KEYS);
	assert.deepEqual(scan.lines, FEATURE.split('\n'));
});

test('scanFrontmatter: no front-matter, or an unclosed fence, is null', () => {
	assert.equal(scanFrontmatter('# Just a body\nstatus: planned\n'), null);
	assert.equal(scanFrontmatter('---\nstatus: planned\n'), null);
});
