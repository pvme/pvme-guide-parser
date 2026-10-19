import { Source } from "./source.js";
import type { InlineNode, ReferenceNode, StyleNode } from "./types.js";

const styles: [string, StyleNode["type"]][] = [["***", "bold"], ["___", "underline"], ["**", "bold"], ["__", "underline"], ["~~", "strikethrough"], ["||", "spoiler"], ["*", "italic"], ["_", "italic"]];

function styleEnd(text: string, start: number, delimiter: string): number {
  let nestedSingle = false, nestedPair = false;
  for (let p = start; p < text.length;) {
    if (text[p] === "\\") { p += 2; continue; }
    if (text[p] === "`") {
      const ticks = text.slice(p).match(/^`+/)![0];
      const close = text.indexOf(ticks, p + ticks.length);
      if (close !== -1) { p = close + ticks.length; continue; }
    }
    if (text[p] !== delimiter[0]) { p++; continue; }
    let run = 1; while (text[p + run] === delimiter[0]) run++;
    if (delimiter.length === 1 && run === 2) { nestedPair = !nestedPair; p += 2; continue; }
    if (delimiter.length === 2 && run === 1 && /[*_]/.test(delimiter[0])) { nestedSingle = !nestedSingle; p++; continue; }
    let end = p;
    if (delimiter.length === 1 && run >= 3 && nestedPair) end += 2;
    if (delimiter.length === 2 && run >= 3 && nestedSingle) end++;
    if (run >= delimiter.length && !/\s/.test(text[p - 1] ?? " ") &&
        !(delimiter.includes("_") && /[\p{L}\p{N}]/u.test(text[end + delimiter.length] ?? ""))) return end;
    p += run;
  }
  return -1;
}

/** A map allows quoted/list text to retain offsets into the original, unmodified source. */
export function parseInline(text: string, source: Source, offset: number, map?: number[], depth = 0, destinationsOnly = false): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pos = (i: number) => map?.[i] ?? offset + i;
  const located = (a: number, b: number) => source.located(pos(a), pos(b));
  let i = 0;
  const addText = (value: string, a: number, b: number) => {
    const prev = nodes.at(-1);
    if (prev?.type === "text" && prev.range.end.offset === pos(a)) {
      prev.value += value; Object.assign(prev, source.located(prev.range.start.offset, pos(b)));
    } else nodes.push({ type: "text", value, ...located(a, b) });
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpMatchArray | null;
    if (rest[0] === "\\" && /^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(rest)) {
      addText(rest[1], i, i + 2); i += 2; continue;
    }
    if ((m = rest.match(/^(`+)([\s\S]*?)\1(?!`)/))) {
      nodes.push({ type: "inline-code", value: m[2].replace(/\r?\n/g, " "), ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\$linkmsg_([^$\r\n]+)\$/))) {
      nodes.push({ type: "reference", kind: "tag", target: m[1], ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\$data_(pvme|link):([^$\r\n]+)\$/))) {
      nodes.push({ type: "reference", kind: m[1] === "pvme" ? "data" : "data-link", target: m[2], ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\{\{([^{}\r\n]+)\}\}/))) {
      nodes.push({ type: "reference", kind: "template", target: m[1], ...located(i, i + m[0].length) });
      if (m[1] !== "channel:id") source.report("UNKNOWN_TEMPLATE", `Unknown template ${m[0]}`, pos(i), pos(i + m[0].length));
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^<(a?):([A-Za-z0-9_]+):(\d+)>/))) {
      nodes.push({ type: "emoji", name: m[2], id: m[3], animated: m[1] === "a", ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^<(@!?|@&|#)(\d+)>/))) {
      nodes.push({ type: "mention", kind: m[1] === "#" ? "channel" : m[1] === "@&" ? "role" : "user", target: m[2], ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^@(everyone|here)\b/))) {
      nodes.push({ type: "mention", kind: m[1] as "everyone" | "here", target: m[1], ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^<id:([\w-]+)>/))) {
      nodes.push({ type: "mention", kind: "special", target: m[1], ...located(i, i + m[0].length) });
      if (!["customize", "guide"].includes(m[1])) source.report("UNKNOWN_SPECIAL_MENTION", `Unknown special mention ${m[0]}`, pos(i), pos(i + m[0].length));
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^<t:(-?\d+)(?::([tTdDfFR]))?>/))) {
      nodes.push({ type: "timestamp", timestamp: m[1], ...(m[2] ? { style: m[2] } : {}), ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    // Links have balanced destinations: wiki URLs regularly contain parentheses.
    if (!destinationsOnly && (rest.startsWith("[") || rest.startsWith("!["))) {
      const image = rest.startsWith("!"), labelStart = i + (image ? 2 : 1);
      let labelEnd = labelStart, brackets = 1;
      for (; labelEnd < text.length; labelEnd++) {
        if (text[labelEnd] === "\\") { labelEnd++; continue; }
        if (text[labelEnd] === "[") brackets++;
        if (text[labelEnd] === "]" && --brackets === 0) break;
      }
      if (text[labelEnd + 1] === "(") {
        const targetStart = labelEnd + 2;
        let end = targetStart, level = 1, angle = false;
        for (; end < text.length; end++) {
          const c = text[end];
          if (c === "\\") { end++; continue; }
          if (c === "<") angle = true;
          if (c === ">") angle = false;
          if (!angle && c === "(") level++;
          if (!angle && c === ")" && --level === 0) break;
        }
        if (level === 0) {
          const target = text.slice(targetStart, end).trim();
          const parts = target.match(/^(<[^>]*>|[\s\S]*?)(?:\s+["']([^"']*)["'])?$/)!;
          const suppressEmbed = parts[1].startsWith("<") && parts[1].endsWith(">");
          const url = suppressEmbed ? parts[1].slice(1, -1) : parts[1];
          const u = targetStart + text.slice(targetStart, end).indexOf(url);
          nodes.push({ type: image ? "image" : "link", url, suppressEmbed, ...(parts[2] ? { title: parts[2] } : {}),
            children: depth < 64 ? parseInline(text.slice(labelStart, labelEnd), source, pos(labelStart), map?.slice(labelStart, labelEnd + 1), depth + 1) : [],
            destination: parseInline(url, source, pos(u), map?.slice(u, u + url.length + 1), depth + 1, true).filter((n): n is ReferenceNode => n.type === "reference"),
            ...located(i, end + 1) });
          i = end + 1; continue;
        }
      }
    }
    if (!destinationsOnly && (m = rest.match(/^<(https?:\/\/[^<>\s]+)>|^(https?:\/\/[^\s<>]+)/))) {
      let raw = m[0], url = m[1] ?? m[2];
      if (!m[1]) {
        url = url.replace(/[.,!;:]+$/, "");
        while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1);
        raw = url;
      }
      const u = i + (m[1] ? 1 : 0);
      nodes.push({ type: "link", url, suppressEmbed: !!m[1], children: [{ type: "text", value: url, ...located(u, u + url.length) }],
        destination: parseInline(url, source, pos(u), map?.slice(u, u + url.length + 1), depth + 1, true).filter((n): n is ReferenceNode => n.type === "reference"), ...located(i, i + raw.length) });
      i += raw.length; continue;
    }
    if ((m = rest.match(/^<(?::|a:|@|#|t:)[^>\r\n]*(?:>|$)|^\$(?:linkmsg|data_)[^$\r\n]*(?:\$|$)/))) {
      const code = rest.startsWith("$") ? "MALFORMED_REFERENCE" : /^<a?:/.test(rest) ? "MALFORMED_EMOJI" : "MALFORMED_MENTION";
      nodes.push({ type: "unknown-inline", ...located(i, i + m[0].length) });
      source.report(code, `Malformed recognised syntax: ${m[0]}`, pos(i), pos(i + m[0].length)); i += m[0].length; continue;
    }
    if (rest.startsWith("_ _")) { nodes.push({ type: "spacer", ...located(i, i + 3) }); i += 3; continue; }
    if (rest[0] === "\n" || rest.startsWith("\r\n")) {
      const len = rest[0] === "\r" ? 2 : 1;
      nodes.push({ type: "line-break", ...located(i, i + len) }); i += len; continue;
    }
    let styled = false;
    if (depth < 64) for (const [delimiter, type] of styles) {
      if (!rest.startsWith(delimiter) || /\s/.test(rest[delimiter.length] ?? " ")) continue;
      if (delimiter.includes("_") && /[\p{L}\p{N}]/u.test(text[i - 1] ?? "")) continue;
      const end = styleEnd(text, i + delimiter.length, delimiter);
      if (end === -1) continue;
      const a = i + delimiter.length;
      let children = parseInline(text.slice(a, end), source, pos(a), map?.slice(a, end + 1), depth + 1, destinationsOnly);
      if (delimiter.length === 3) children = [{ type: "italic", children, ...located(i + 1, end + 2) }];
      nodes.push({ type, children, ...located(i, end + delimiter.length) });
      i = end + delimiter.length; styled = true; break;
    }
    if (styled) continue;
    if ((m = rest.match(/^<[A-Za-z][\w:.-]*>/))) {
      nodes.push({ type: "unknown-inline", ...located(i, i + m[0].length) });
      source.report("UNKNOWN_SYNTAX", `Unrecognised angle token ${m[0]}; preserved verbatim`, pos(i), pos(i + m[0].length));
      i += m[0].length; continue;
    }
    if (!destinationsOnly && (m = rest.match(/^:[A-Za-z][\w+-]*:/))) {
      nodes.push({ type: "emoji", name: m[0].slice(1, -1), id: null, animated: false, ...located(i, i + m[0].length) }); i += m[0].length; continue;
    }
    addText(text[i], i, i + 1); i++;
  }
  return nodes;
}

export function inlineText(nodes: InlineNode[]): string {
  return nodes.map(n => "children" in n ? inlineText(n.children) : "value" in n ? n.value : n.raw).join("");
}
