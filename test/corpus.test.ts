import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanCorpus } from './corpus.mjs';

it('reports corpus errors, unknown syntax and filename/line locations recursively', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pvme-corpus-'));
  try {
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, '.hidden', 'invalid.txt'), '# Title\n.tag:duplicate\n.tag:duplicate\n$linkmsg_missing$\n.future:value\n{"broken":}\n.embed:json\n.\n```js\nunclosed');
    writeFileSync(join(root, 'ignored.md'), '.not-a-guide:');
    const report = await scanCorpus(root);
    expect(report.files).toBe(1);
    expect(report.crashes).toBe(0);
    expect(report.errors).toBe(4);
    expect(report.commands['.future']).toBe(1);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ file: '.hidden/invalid.txt', line: 5, code: 'UNKNOWN_COMMAND' }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ line: 6, code: 'INVALID_EMBED_JSON' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
