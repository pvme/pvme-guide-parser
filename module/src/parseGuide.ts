import { scanMessages, type MessageSegment } from "./scanner.js";
import { messageBlocks } from "./messageBlocks.js";
import { referencesIn } from "./blocks.js";
import { Source } from "./source.js";
import type { BlockNode, GuideDocument, GuideMessage, GuideSection, ParseOptions } from "./types.js";

export function parseGuide(text: string, options: ParseOptions = {}): GuideDocument {
  const source = new Source(text);
  const doc: GuideDocument = { type: "document", schemaVersion: 1, source: text, range: source.range(0, text.length), messages: [], sections: [], tags: Object.create(null), references: [], commands: [], embeds: [], attachments: [], separators: [], diagnostics: source.diagnostics };
  const sectionStack: GuideSection[] = [];
  let latestSection: GuideSection | undefined;
  function addMessage(segment: MessageSegment) {
    const { start, end } = segment;
    const { blocks, content } = messageBlocks(segment.content, segment.commands, source);
    const index = doc.messages.length;
    const message: GuideMessage = { index, content, blocks, anchors: [], pin: null, reactions: [], explicitBlank: false, ...source.located(start, end) };
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
              if (latestSection) latestSection.tags.push(node.parameter);
              if (Object.hasOwn(doc.tags, node.parameter)) source.report("DUPLICATE_TAG", `Duplicate tag ${node.parameter}; first definition retained`, node.range.start.offset, node.range.end.offset, "error");
              else doc.tags[node.parameter] = anchor;
              break;
            }
            case "pin": message.pin = node.parameter; break;
            case "react": message.reactions.push(node.parameter); break;
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
  const scanned = scanMessages(source);
  doc.separators = scanned.separators;
  for (const segment of scanned.messages) addMessage(segment);
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
