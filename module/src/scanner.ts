import { Source, type Line } from "./source.js";

export interface MessageSegment { content: Line[]; commands: Line[]; start: number; end: number }

/** Legacy PVME syntax runs before Markdown, including fenced/quoted content. */
export function scanMessages(source: Source): { messages: MessageSegment[]; separators: ReturnType<Source["range"]>[] } {
  const messages: MessageSegment[] = [], separators: ReturnType<Source["range"]>[] = [];
  let segment: MessageSegment = { content: [], commands: [], start: 0, end: 0 };
  let commandState = false;
  // Split on LF, removing CRs semantically, and ignore exactly one terminal LF.
  let end = source.text.length;
  while (end && source.text[end - 1] === "\r") end--;
  if (source.text[end - 1] === "\n") end--;
  let start = 0;
  while (start <= end) {
    const lf = source.text.indexOf("\n", start);
    const stop = lf < 0 || lf >= end ? end : lf;
    const raw = source.text.slice(start, stop);
    const offsets: number[] = [];
    let text = "";
    for (let i = 0; i < raw.length; i++) if (raw[i] !== "\r") { text += raw[i]; offsets.push(start + i); }
    const lineEnd = raw.endsWith("\r") ? stop - 1 : stop;
    let line: Line = { text, start, end: lineEnd, offsets };
    const next = lf < 0 || lf >= end ? source.text.length : lf + 1;
    if (text.startsWith(".") && !text.slice(1).trim()) {
      segment.end = start; messages.push(segment);
      separators.push(source.range(start, lineEnd));
      segment = { content: [], commands: [], start: next, end: next };
      commandState = false;
    } else if (text.startsWith(".") && !text.startsWith("..")) {
      segment.commands.push(line); commandState = true;
    } else {
      if (commandState) {
        segment.end = start; messages.push(segment);
        segment = { content: [], commands: [], start, end: start };
        commandState = false;
      }
      if (text.startsWith("..")) line = { ...line, text: text.slice(1), start: offsets[1], offsets: offsets.slice(1) };
      segment.content.push(line);
    }
    if (lf < 0 || lf >= end) break;
    start = lf + 1;
  }
  segment.end = source.text.length; messages.push(segment);
  return { messages, separators };
}
