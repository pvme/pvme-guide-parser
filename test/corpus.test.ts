import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGuide } from '@pvme/guide-parser';
import { scanCorpus } from './corpus.mjs';

// Complete AST digests from before the packaging refactor, including locations.
// Fixtures are unmodified PVME guides at d2ff0d8, licensed under CC BY-NC-SA 4.0.
const fixtures = {
  'style-guide.txt': 'b8b64e69499e9ec82d7f0b1a252582fb72d61157d128ca81e1b13075fc2061ce',
  'afk-arch-glacor.txt': '86dd884b56366f9e918a4ef8d8af30166fc67e133f955fdc2eba65cca6f05977',
  'alt1.txt': 'a29606285c09a77c5f4665ad569ab5b11a9b9aff2ec15bf7d2913e4bd4c904b6',
  'biting.txt': '9f6821018f5cc342179ba31dac268401bf42aef640e6288d3ae7fdcc0ba24e1c',
  'telos_basic_test.txt': 'df28b7750207319ab263c4b4810653d744bc6697da416292f3438d79da65de9f',
};

it('preserves the exact ASTs of representative real guides', () => {
  for (const [name, digest] of Object.entries(fixtures)) {
    const source = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    const doc = parseGuide(source);
    expect(doc.diagnostics, name).toEqual([]);
    expect(createHash('sha256').update(JSON.stringify(doc)).digest('hex'), name).toBe(digest);
  }
});

it('reports corpus errors, unknown syntax and filename/line locations recursively', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pvme-corpus-'));
  try {
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, '.hidden', 'invalid.txt'), '# Title\n.tag:duplicate\n.tag:duplicate\n$linkmsg_missing$\n.future:value\n{"broken":}\n.embed:json\n.\n```js\nunclosed');
    writeFileSync(join(root, 'ignored.md'), '.not-a-guide:');
    const report = await scanCorpus(root);
    expect(report.files).toBe(1);
    expect(report.crashes).toBe(0);
    expect(report.errors).toBe(3);
    expect(report.commands['.future']).toBe(1);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ file: '.hidden/invalid.txt', line: 5, code: 'UNKNOWN_COMMAND' }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ line: 6, code: 'INVALID_EMBED_JSON' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(!process.env.PVME_GUIDES_PATH)('parses the full local corpus with no crashes or structural errors', async () => {
  const report = await scanCorpus(process.env.PVME_GUIDES_PATH!);
  for (const d of report.diagnostics) console.info(`${d.file}:${d.line}:${d.column} ${d.code}: ${d.message}`);
  console.info(`${report.files} files; ${report.crashes} crashes; ${report.errors} errors; ${report.warnings} warnings`);
  expect(report.files).toBeGreaterThan(0);
  expect(report.crashes).toBe(0);
  expect(report.errors).toBe(0);
}, 120_000);
