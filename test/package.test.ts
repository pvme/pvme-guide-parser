import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGuide } from '@pvme/guide-parser';

it('packs only production files and works as an external ESM/types/CLI dependency', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'pvme-package-'));
  const npmCLI = process.env.npm_execpath;
  if (!npmCLI) throw new Error('Run this test with npm test');
  const npm = (args: string[], cwd: string) => execFileSync(process.execPath, [npmCLI, ...args], {
    cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache'), npm_config_update_notifier: 'false' },
  });
  try {
    // npm test builds first. Skip lifecycle hooks here; normal npm pack also
    // exercises the package's prepack build when run by a maintainer.
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], join(root, 'module')));
    expect(packed.files.map((f: { path: string }) => f.path).sort()).toEqual([
      'README.md', 'bin/parse.js', 'package.json',
      ...['blocks', 'index', 'inline', 'parseGuide', 'source', 'types'].flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`]),
    ].sort());
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], temporary);

    const input = '# __External consumer__\r\n.tag:intro\r\n⬥ **Hello** <:magic:123>\r\n.\r\n$linkmsg_intro$';
    const expected = JSON.stringify(parseGuide(input));
    writeFileSync(join(temporary, 'consumer.mjs'), `import { parseGuide } from '@pvme/guide-parser';\nconsole.log(JSON.stringify(parseGuide(${JSON.stringify(input)})));\n`);
    expect(execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, encoding: 'utf8' }).trim()).toBe(expected);

    writeFileSync(join(temporary, 'consumer.ts'), "import { parseGuide, type GuideDocument, type ParseOptions } from '@pvme/guide-parser';\nconst options: ParseOptions = {};\nconst doc: GuideDocument = parseGuide('# Title', options);\nconsole.log(doc.schemaVersion);\n");
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'], { cwd: temporary, stdio: 'pipe' });

    const installed = join(temporary, 'node_modules/@pvme/guide-parser');
    const metadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    expect(metadata.dependencies).toBeUndefined();
    expect(metadata.bin['pvme-guide-parse']).toBe('./bin/parse.js');
    expect(existsSync(join(temporary, `node_modules/.bin/pvme-guide-parse${process.platform === 'win32' ? '.cmd' : ''}`))).toBe(true);
    const cli = join(installed, 'bin/parse.js');
    writeFileSync(join(temporary, 'guide.txt'), input);
    const file = spawnSync(process.execPath, [cli, 'guide.txt'], { cwd: temporary, encoding: 'utf8' });
    expect(file.status).toBe(0); expect(file.stderr).toBe(''); expect(file.stdout.trim()).toBe(expected);
    const stdin = spawnSync(process.execPath, [cli], { input, encoding: 'utf8' });
    expect(stdin.status).toBe(0); expect(stdin.stderr).toBe(''); expect(stdin.stdout.trim()).toBe(expected);
    const badGuide = spawnSync(process.execPath, [cli, '-'], { input: '.embed:json', encoding: 'utf8' });
    expect(badGuide.status).toBe(0); expect(JSON.parse(badGuide.stdout).diagnostics[0].severity).toBe('error');
    const missing = spawnSync(process.execPath, [cli, 'missing.txt'], { cwd: temporary, encoding: 'utf8' });
    expect(missing.status).not.toBe(0); expect(missing.stdout).toBe(''); expect(missing.stderr).toContain('missing.txt');
    const usage = spawnSync(process.execPath, [cli, 'one', 'two'], { encoding: 'utf8' });
    expect(usage.status).not.toBe(0); expect(usage.stdout).toBe(''); expect(usage.stderr).toContain('Usage:');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 60_000);
