import { codeSpan, fencePattern, parseBlocks, referencesIn } from "./blocks.js";
import { Source, type Line } from "./source.js";
import type { BlockNode, GuideDocument, GuideMessage, GuideSection, ParseOptions } from "./types.js";

export function parseGuide(text: string, options: ParseOptions = {}): GuideDocument {
  const source = new Source(text);
  const doc: GuideDocument = { type: "document", schemaVersion: 1, source: text, range: source.range(0, text.length), messages: [], sections: [], tags: Object.create(null), references: [], commands: [], embeds: [], attachments: [], separators: [], diagnostics: source.diagnostics };
  const sectionStack: GuideSection[] = [];
  // Reuse a diagnostic-free scanner rather than rebuilding source indexes per fence.
  const fenceScanner = new Source(text);
  let latestSection: GuideSection | undefined;
  function addMessage(lines: Line[], start: number, end: number) {
    if (!lines.length && start === end) return;
    const blocks = parseBlocks(lines, source);
    if (!blocks.length) return;
    const index = doc.messages.length;
    const message: GuideMessage = { index, blocks, anchors: [], pin: null, reactions: [], explicitBlank: false, ...source.located(start, end) };
    doc.messages.push(message);
    function visit(nodes: BlockNode[]) {
      for (const node of nodes) {
        if (node.type === "heading") {
          while (sectionStack.length && sectionStack.at(-1)!.level >= node.level) sectionStack.pop();
          latestSection = { id: node.id, heading: node.text, level: node.level, parentId: sectionStack.at(-1)?.id ?? null, messageIndex: index, tags: [], range: node.range };
          sectionStack.push(latestSection); doc.sections.push(latestSection);
        }
        if (node.type === "command" || node.type === "unknown-command") {
          doc.commands.push(node);
          if (node.valid) switch (node.name) {
            case "tag": {
              const anchor = { tag: node.parameter, heading: latestSection?.heading ?? null, headingLevel: latestSection?.level ?? null, sectionId: latestSection?.id ?? null, messageIndex: index, range: node.range };
              message.anchors.push(anchor);
              if (!latestSection) source.report("TAG_WITHOUT_HEADING", `Tag ${node.parameter} has no preceding heading; attached to this message`, node.range.start.offset, node.range.end.offset);
              else latestSection.tags.push(node.parameter);
              if (Object.hasOwn(doc.tags, node.parameter)) source.report("DUPLICATE_TAG", `Duplicate tag ${node.parameter}; first definition retained`, node.range.start.offset, node.range.end.offset, "error");
              else doc.tags[node.parameter] = anchor;
              break;
            }
            case "pin": message.pin = node.parameter; break;
            case "react": message.reactions.push(node.parameter); break;
            case "blank": message.explicitBlank = true; break;
          }
        }
        if (node.type === "embed") { doc.embeds.push(node); doc.references.push(...node.references); }
        else if (node.type === "attachment") doc.attachments.push(node);
        else if (node.type === "list") node.items.forEach(item => visit(item.children));
        else if (node.type === "blockquote") visit(node.children);
        else if ("children" in node) doc.references.push(...referencesIn(node.children));
      }
    }
    visit(blocks);
  }
  let first = 0, start = 0;
  for (let i = 0; i < source.lines.length; i++) {
    const line = source.lines[i];
    if (fencePattern.test(line.text)) {
      // Scan without emitting diagnostics twice; block parsing owns diagnostics.
      i = codeSpan(source.lines, i, fenceScanner).next - 1;
      continue;
    }
    if (line.text.trim() === ".") {
      addMessage(source.lines.slice(first, i), start, line.start);
      doc.separators.push(source.range(line.start, line.end));
      first = i + 1; start = source.lines[first]?.start ?? text.length;
    }
  }
  addMessage(source.lines.slice(first), start, text.length);
  const external = new Set(options.externalTags ?? []);
  if (options.validateReferences !== false) for (const reference of doc.references) {
    if (reference.kind === "tag" && !Object.hasOwn(doc.tags, reference.target) && !external.has(reference.target)) source.report("MISSING_TAG", `No tag named ${reference.target}`, reference.range.start.offset, reference.range.end.offset);
  }
  // Close section extents at the next sibling/ancestor heading, across messages.
  for (let i = 0; i < doc.sections.length; i++) {
    const section = doc.sections[i];
    const next = doc.sections.slice(i + 1).find(s => s.level <= section.level);
    section.range = source.range(section.range.start.offset, next?.range.start.offset ?? text.length);
  }
  doc.diagnostics.sort((a, b) => a.range.start.offset - b.range.start.offset || a.code.localeCompare(b.code));
  return doc;
}
