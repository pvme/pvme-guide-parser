import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseGuide } from '@pvme/guide-parser';

export async function scanCorpus(root) {
  root = resolve(root);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.txt')) files.push(path);
    }
  }
  await walk(root);
  if (!files.length) throw new Error(`No .txt files found in ${root}`);
  const report = { files: files.length, crashes: 0, errors: 0, warnings: 0, commands: {}, diagnostics: [] };
  for (const path of files.sort()) {
    const source = await readFile(path, 'utf8');
    const file = relative(root, path).replaceAll('\\', '/');
    try {
      const doc = parseGuide(source);
      JSON.stringify(doc);
      for (const command of doc.commands) {
        const name = `.${command.name}`;
        report.commands[name] = (report.commands[name] ?? 0) + 1;
      }
      for (const d of doc.diagnostics) {
        report[d.severity === 'error' ? 'errors' : 'warnings']++;
        report.diagnostics.push({ file, line: d.range.start.line, column: d.range.start.column,
          severity: d.severity, code: d.code, message: d.message });
      }
    } catch (error) {
      report.crashes++;
      report.diagnostics.push({ file, line: 1, column: 1, severity: 'error', code: 'CRASH', message: String(error) });
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run corpus -- <local-pvme-guides-directory>');
    const report = await scanCorpus(process.argv[2]);
    for (const d of report.diagnostics) console.log(`${d.file}:${d.line}:${d.column} ${d.severity} ${d.code}: ${d.message}`);
    console.log(`${report.files} files; ${report.crashes} crashes; ${report.errors} errors; ${report.warnings} warnings`);
    console.log('Commands:', Object.entries(report.commands).map(([name, count]) => `${name}=${count}`).join(', '));
    if (report.crashes || report.errors) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
