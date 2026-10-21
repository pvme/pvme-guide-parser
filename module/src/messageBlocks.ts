import { parseBlocks, referencesIn } from "./blocks.js";
import { parseInline } from "./inline.js";
import { Source, type Line } from "./source.js";
import type { BlockNode, CommandBlock, ReferenceNode } from "./types.js";

/** Commands come from the PVME scanner, never from Markdown parsing. */
export function messageBlocks(content: Line[], commands: Line[], source: Source): { blocks: BlockNode[]; content: string } {
  let text = content.map(line => line.text).join("\n");
  const blocks: BlockNode[] = [];
  let embedded = false, tagged = false, attached = false;
  for (const line of commands) {
    // Trim the envelope as in the checker; preserve leading parameter whitespace.
    const match = line.text.slice(1).trim().match(/^(.*?):(.*)$/);
    const name = match?.[1] ?? line.text.slice(1), parameter = match?.[2] ?? "";
    const known = ["tag", "img", "file", "pin", "embed", "react"].includes(name);
    let valid = known && !!match;
    if (name === "pin" && parameter !== "" && parameter !== "delete") valid = false;
    if (name === "embed" && parameter !== "" && parameter !== "json") valid = false;
    if (["img", "file"].includes(name) && !/https?:\/\//.test(parameter)) valid = false;
    const node: CommandBlock = { type: known ? "command" : "unknown-command", name, parameter, valid, ...source.located(line.start, line.end) };
    blocks.push(node);
    if (!known) source.report("UNKNOWN_COMMAND", `Unknown command ${line.text}`, line.start, line.end, "error");
    else if (!valid) source.report("MALFORMED_COMMAND", `Malformed .${name} command`, line.start, line.end, "error");
    if (!match) continue;
    if (name === "tag") {
      if (tagged) { node.valid = false; source.report("MULTIPLE_MESSAGE_TAGS", "Message already tagged", line.start, line.end, "error"); }
      tagged = true;
      if (parameter && !/^[A-Za-z0-9_-]+$/.test(parameter)) source.report("NONCANONICAL_TAG", `Legacy tag name ${parameter}; retained literally`, line.start, line.end);
    }
    if (name === "img" || name === "file") {
      if (attached) { node.valid = false; source.report("MULTIPLE_MESSAGE_ATTACHMENTS", "Message already contains attachment", line.start, line.end, "error"); }
      attached = true;
      if (node.valid) blocks.push({ type: "attachment", kind: name === "img" ? "image" : "file", url: parameter.replace(/^<|>$/g, ""), ...source.located(line.start, line.end) });
    }
    if (name === "embed" && parameter === "json") {
      const json = text;
      const jsonOffsets: number[] = [];
      for (const [index, item] of content.entries()) {
        if (index) jsonOffsets.push(content[index - 1].end);
        for (let j = 0; j < item.text.length; j++) jsonOffsets.push(item.offsets?.[j] ?? item.start + j);
      }
      const jsonPosition = (offset: number) => jsonOffsets[offset] ?? line.start;
      const start = content[0]?.start ?? line.start;
      const end = line.end;
      let value: unknown = null;
      try { value = JSON.parse(json); }
      catch (error) {
        node.valid = false;
        source.report("INVALID_EMBED_JSON", error instanceof Error ? error.message : String(error), start, end, "error");
      }
      // Scan JSON string *source* so every reference keeps its exact source position,
      // including JSON escapes. Values themselves remain untouched.
      const references: ReferenceNode[] = [];
      for (const token of json.matchAll(/"(?:\\.|[^"\\])*"/g)) {
        const tokenStart = token.index! + 1;
        const decodedMap: number[] = []; let decoded = "";
        const body = token[0].slice(1, -1);
        for (let p = 0; p < body.length;) {
          const start = p;
          if (body[p] === "\\") {
            const length = body[p + 1] === "u" ? 6 : 2;
            try { decoded += JSON.parse('"' + body.slice(p, p + length) + '"'); } catch { decoded += body.slice(p, p + length); }
            p += length;
          } else { decoded += body[p]; p++; }
          while (decodedMap.length < decoded.length) decodedMap.push(jsonPosition(tokenStart + start));
        }
        decodedMap.push(jsonPosition(tokenStart + body.length));
        references.push(...referencesIn(parseInline(decoded, source, jsonPosition(tokenStart), decodedMap)));
      }
      blocks.push({ type: "embed", value, valid: node.valid, references, ...source.located(start, end) });
      embedded = true;
      // Preserve the full envelope and avoid the checker's content slice(1) bug.
      text = value && typeof value === "object" && "content" in value && typeof value.content === "string" ? value.content : "";
    }
  }
  if (!embedded) blocks.unshift(...parseBlocks(content, source));
  blocks.sort((a, b) => a.range.start.offset - b.range.start.offset);
  return { blocks, content: text };
}
