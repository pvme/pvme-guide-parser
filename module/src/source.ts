import type { Diagnostic, SourcePosition, SourceRange } from "./types.js";
export interface Line { text: string; start: number; end: number; offsets?: number[] }
export class Source {
  readonly lines: Line[] = [];
  readonly diagnostics: Diagnostic[] = [];
  constructor(readonly text: string) {
    const re = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      this.lines.push({ text: match[1], start: match.index, end: match.index + match[1].length });
      if (!match[2]) break;
    }
  }
  position(offset: number): SourcePosition {
    let lo = 0, hi = this.lines.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.lines[mid].start <= offset) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lines[lo].start + 1, offset };
  }
  range(start: number, end = start): SourceRange {
    const a = this.position(start), b = this.position(end);
    return { start: a, end: b, startLine: a.line, endLine: b.line };
  }
  located(start: number, end: number) { return { raw: this.text.slice(start, end), range: this.range(start, end) }; }
  report(code: string, message: string, start: number, end = start, severity: Diagnostic["severity"] = "warning") {
    this.diagnostics.push({ code, message, severity, range: this.range(start, end) });
  }
}
