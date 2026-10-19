import { Source, type Line } from "./source.js";
import { inlineText, parseInline } from "./inline.js";
import type { BlockNode, CodeBlock, CommandBlock, InlineNode, ListBlock, ListItem, ReferenceNode } from "./types.js";

export const fencePattern = /^\s*(`{3,}|~{3,})(.*)$/;
export const listPattern = /^(\s*)([⬥•⬩●○▪▫‣►◆★→*+\-]|\d+[.)]|[A-Za-z][.)])\s+(.*)$/;
export function codeSpan(lines: Line[], index: number, source: Source): { node: CodeBlock; next: number } {
  const first = lines[index], match = first.text.match(fencePattern)!;
  const fence = match[1], rest = match[2];
  const close = (s: string) => {
    const re = new RegExp(`${fence[0]}{${fence.length},}`);
    return re.exec(s);
  };
  const same = close(rest);
  let language: string | null = null, value = "", next = index + 1, closed = false, end = first.end;
  if (same) {
    value = rest.slice(0, same.index); closed = true;
    const trailing = rest.slice(same.index + same[0].length);
    if (trailing.trim()) source.report("FENCE_TRAILING_TEXT", "Text after closing code fence is preserved in raw", first.end - trailing.length, first.end);
  }
  else {
    // Discord permits content immediately after ```, unlike CommonMark info strings.
    if (/^[\w+-]+\s*$/.test(rest)) language = rest.trim();
    else if (rest) value = rest + "\n";
    const buffer: string[] = [];
    for (; next < lines.length; next++) {
      const line = lines[next], found = close(line.text);
      end = line.end;
      if (found) {
        if (found.index) buffer.push(line.text.slice(0, found.index));
        const trailing = line.text.slice(found.index + found[0].length);
        if (trailing.trim()) source.report("FENCE_TRAILING_TEXT", "Text after closing code fence is preserved in raw", line.start + found.index + found[0].length, line.end);
        closed = true; next++; break;
      }
      buffer.push(line.text);
    }
    value += buffer.join("\n");
  }
  if (!closed) source.report("UNCLOSED_CODE_FENCE", "Unclosed fenced code block", first.start, end, "error");
  return { node: { type: "codeblock", fence, language, value, closed, ...source.located(first.start, end) }, next };
}

function childrenFor(lines: Line[], source: Source): InlineNode[] {
  let text = ""; const map: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (index) { map.push(lines[index - 1].end); text += "\n"; }
    for (let j = 0; j < line.text.length; j++) map.push(line.start + j);
    text += line.text;
  }
  map.push(lines.at(-1)?.end ?? 0);
  return parseInline(text, source, lines[0]?.start ?? 0, map);
}
export function referencesIn(nodes: InlineNode[]): ReferenceNode[] {
  return nodes.flatMap(n => n.type === "reference" ? [n] : "children" in n ? [...referencesIn(n.children), ...("destination" in n ? n.destination : [])] : []);
}

/** Blocks are parsed independently of message routing and any rendering. */
export function parseBlocks(lines: Line[], source: Source, root = true, depth = 0, listItemHead = false): BlockNode[] {
  const blocks: BlockNode[] = [];
  if (depth > 64) {
    if (lines.length) {
      source.report("NESTING_LIMIT", "Block nesting exceeds 64 levels; preserved as text", lines[0].start, lines.at(-1)!.end);
      blocks.push({ type: "paragraph", children: childrenFor(lines, source), ...source.located(lines[0].start, lines.at(-1)!.end) });
    }
    return blocks;
  }
  const special = (s: string) => !s.trim() || fencePattern.test(s) || /^\s{0,3}(?:#{1,6}\s|>|-#\s)/.test(s) || listPattern.test(s) || (root && /^\s*\./.test(s) && !/^\s*\.\./.test(s));
  for (let i = 0; i < lines.length;) {
    const line = lines[i], trimmed = line.text.trim();
    let m: RegExpMatchArray | null;
    if (!trimmed) { blocks.push({ type: "blank", ...source.located(line.start, line.end) }); i++; continue; }
    if (fencePattern.test(line.text)) { const code = codeSpan(lines, i, source); blocks.push(code.node); i = code.next; continue; }
    // A JSON-looking line is an embed only when a postfix marker actually follows.
    if (root && /^[{[]/.test(trimmed)) {
      let marker = i + 1;
      for (; marker < lines.length; marker++) {
        if (/^\s*\.embed:json\s*$/.test(lines[marker].text)) break;
        if (/^\s*\.(?!\.)/.test(lines[marker].text)) { marker = lines.length; break; }
      }
      if (marker < lines.length) {
        const end = lines[marker].end, jsonEnd = lines[marker - 1].end;
        const json = source.text.slice(line.start, jsonEnd);
        let value: unknown = null, valid = true;
        try { value = JSON.parse(json); }
        catch (error) {
          valid = false;
          const message = error instanceof Error ? error.message : String(error);
          const position = message.match(/position (\d+)/i);
          const at = line.start + (position ? Number(position[1]) : 0);
          source.report("INVALID_EMBED_JSON", message, at, at, "error");
        }
        // Scan JSON string *source* so every reference keeps its exact source position,
        // including JSON escapes. Values themselves remain untouched.
        const references: ReferenceNode[] = [];
        for (const token of json.matchAll(/"(?:\\.|[^"\\])*"/g)) {
          const tokenStart = line.start + token.index! + 1;
          const decodedMap: number[] = []; let decoded = "";
          const body = token[0].slice(1, -1);
          for (let p = 0; p < body.length;) {
            const start = p;
            if (body[p] === "\\") {
              const length = body[p + 1] === "u" ? 6 : 2;
              try { decoded += JSON.parse('"' + body.slice(p, p + length) + '"'); } catch { decoded += body.slice(p, p + length); }
              p += length;
            } else { decoded += body[p]; p++; }
            while (decodedMap.length < decoded.length) decodedMap.push(tokenStart + start);
          }
          decodedMap.push(tokenStart + body.length);
          references.push(...referencesIn(parseInline(decoded, source, tokenStart, decodedMap)));
        }
        blocks.push({ type: "embed", value, valid, references, ...source.located(line.start, end) });
        blocks.push({ type: "command", name: "embed", parameter: "json", valid, ...source.located(lines[marker].start, end) });
        i = marker + 1; continue;
      }
    }
    if (root && /^\s*\.(?!\.)/.test(line.text)) {
      const command = trimmed.match(/^\.([A-Za-z][\w-]*)(?::(.*))?$/);
      const name = command?.[1].toLowerCase() ?? trimmed.slice(1), parameter = command?.[2]?.trim() ?? "";
      const known = ["tag", "img", "file", "pin", "embed", "react", "blank"].includes(name);
      let valid = known && !!command && command[2] !== undefined;
      if (known && ["tag", "img", "file", "react"].includes(name) && !parameter) valid = false;
      if (["img", "file"].includes(name) && !/^https?:\/\/\S+$/.test(parameter.replace(/^<|>$/g, ""))) valid = false;
      if (name === "blank" && parameter) valid = false;
      if (name === "embed") valid = false; // JSON marker without its payload.
      const node: CommandBlock = { type: known ? "command" : "unknown-command", name, parameter, valid, ...source.located(line.start, line.end) };
      blocks.push(node);
      if (!known) source.report("UNKNOWN_COMMAND", `Unknown command ${trimmed}`, line.start, line.end);
      else if (!valid) source.report("MALFORMED_COMMAND", `Malformed .${name} command${name === "embed" ? ": expected preceding JSON and .embed:json" : ""}`, line.start, line.end, "error");
      else if (["img", "file"].includes(name)) blocks.push({ type: "attachment", kind: name === "img" ? "image" : "file", url: parameter.replace(/^<|>$/g, ""), ...source.located(line.start, line.end) });
      if (name === "pin" && parameter !== "" && parameter !== "delete") source.report("LEGACY_PIN_VALUE", `Unrecognised pin value ${parameter}; retained for consumer policy`, line.start, line.end);
      if (name === "tag" && valid && !/^[A-Za-z0-9_-]+$/.test(parameter)) source.report("NONCANONICAL_TAG", `Legacy tag name ${parameter}; retained literally`, line.start, line.end);
      i++; continue;
    }
    if ((m = line.text.match(/^(\s{0,3})(>>>|>)\s?/))) {
      const multiline = m[2] === ">>>", quoted: Line[] = [];
      const first = i;
      for (; i < lines.length; i++) {
        const q = lines[i].text.match(/^\s{0,3}>\s?/);
        if (i !== first && !multiline && !q) break;
        const length = i === first ? m[0].length : q?.[0].length ?? 0;
        quoted.push({ ...lines[i], text: lines[i].text.slice(length), start: lines[i].start + length });
      }
      blocks.push({ type: "blockquote", multiline, children: parseBlocks(quoted, source, false, depth + 1), ...source.located(line.start, lines[i - 1].end) }); continue;
    }
    if ((m = line.text.match(/^\s{0,3}(#{1,6})\s+(.*)$/))) {
      const content = m[2].replace(/\s+#+\s*$/, ""), start = line.start + line.text.indexOf(m[2]);
      const children = parseInline(content, source, start);
      blocks.push({ type: "heading", id: `section-${line.start}`, level: m[1].length, text: inlineText(children), children, ...source.located(line.start, line.end) }); i++; continue;
    }
    if ((m = line.text.match(/^\s{0,3}-#\s+(.*)$/))) {
      blocks.push({ type: "subtext", children: parseInline(m[1], source, line.start + line.text.indexOf(m[1])), ...source.located(line.start, line.end) }); i++; continue;
    }
    // The stripped item head is still on the outer marker's source line.
    // Only subsequent lines can introduce a nested list.
    if (!(listItemHead && i === 0) && (m = line.text.match(listPattern))) {
      const first = i, indent = m[1].length;
      const style = /^\d/.test(m[2]) ? "number" : /^[A-Za-z]/.test(m[2]) ? "letter" : "bullet";
      const list: ListBlock = { type: "list", style, ordered: style !== "bullet", items: [], ...source.located(line.start, line.end) };
      while (i < lines.length) {
        const itemMatch = lines[i].text.match(listPattern);
        if (!itemMatch || itemMatch[1].length !== indent) break;
        const itemStyle = /^\d/.test(itemMatch[2]) ? "number" : /^[A-Za-z]/.test(itemMatch[2]) ? "letter" : "bullet";
        if (itemStyle !== style) break;
        const itemFirst = i, head = lines[i], prefix = itemMatch[0].length - itemMatch[3].length;
        const itemLines: Line[] = [{ ...head, text: itemMatch[3], start: head.start + prefix }]; i++;
        while (i < lines.length) {
          const next = lines[i], nextMatch = next.text.match(listPattern), whitespace = next.text.match(/^\s*/)?.[0].length ?? 0;
          if (!next.text.trim()) {
            let after = i + 1; while (after < lines.length && !lines[after].text.trim()) after++;
            const later = lines[after]?.text.match(listPattern);
            if (later && later[1].length >= indent) { itemLines.push(next); i++; continue; }
            break;
          }
          if (nextMatch && nextMatch[1].length <= indent) break;
          if (whitespace <= indent || (root && /^\s*\.(?!\.)/.test(next.text))) break;
          // Preserve indentation of nested markers; continuation text can be de-indented.
          itemLines.push(next); i++;
        }
        const item: ListItem = { type: "list-item", marker: itemMatch[2], indent, children: parseBlocks(itemLines, source, false, depth + 1, true), ...source.located(lines[itemFirst].start, lines[i - 1].end) };
        list.items.push(item);
      }
      Object.assign(list, source.located(lines[first].start, lines[i - 1].end)); blocks.push(list); continue;
    }
    const paragraph: Line[] = [];
    do {
      const l = lines[i];
      // Leading double dot escapes exactly one dot, retaining its raw location.
      const escaped = root ? l.text.match(/^(\s*)\.\./) : null;
      const skip = escaped ? escaped[1].length + 1 : 0;
      paragraph.push(escaped ? { ...l, text: l.text.slice(skip), start: l.start + skip } : l);
      i++;
    } while (i < lines.length && !special(lines[i].text) && !(root && /^[{[]/.test(lines[i].text.trim())));
    blocks.push({ type: "paragraph", children: childrenFor(paragraph, source), ...source.located(line.start, lines[i - 1].end) });
  }
  return blocks;
}
