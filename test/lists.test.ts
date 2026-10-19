import { describe, expect, it } from "vitest";
import { parseGuide } from "@pvme/guide-parser";
import type { BlockNode, ListBlock } from "@pvme/guide-parser";

function list(block: BlockNode): ListBlock {
  expect(block.type).toBe("list");
  if (block.type !== "list") throw new Error("Expected list");
  return block;
}

describe("list item content", () => {
  it("keeps the gizmo slot plus literal and preserves bold formatting", () => {
    const input = "⬥ + represents an item with **multiple gizmos slots**:";
    const doc = parseGuide(input);
    expect(doc.messages[0].blocks).toHaveLength(1);
    const outer = list(doc.messages[0].blocks[0]);
    expect(outer.items).toHaveLength(1);
    expect(outer.items[0]).toMatchObject({
      marker: "⬥", raw: input,
      children: [{
        type: "paragraph", raw: input.slice(2),
        children: [
          { type: "text", value: "+ represents an item with " },
          { type: "bold", raw: "**multiple gizmos slots**", children: [{ type: "text", value: "multiple gizmos slots" }] },
          { type: "text", value: ":" },
        ],
      }],
    });
    expect(outer.items[0].children).toHaveLength(1);
    expect(doc.diagnostics).toEqual([]);
  });

  const markers = ["⬥", "•", "⬩", "●", "○", "▪", "▫", "‣", "►", "◆", "★", "→", "*", "+", "-", "1.", "12)", "a.", "Z)"];
  it.each(markers)("keeps same-line %s literal after an outer marker", marker => {
    const content = `${marker} literal **bold**`;
    const outer = list(parseGuide(`⬥ ${content}`).messages[0].blocks[0]);
    expect(outer.items).toHaveLength(1);
    expect(outer.items[0].children).toHaveLength(1);
    expect(outer.items[0].children[0]).toMatchObject({
      type: "paragraph", raw: content,
      children: [{ type: "text", value: `${marker} literal ` }, { type: "bold" }],
    });
  });

  it("recognises indented nested lists after literal markers at each depth", () => {
    const input = "⬥ + parent\n    + - child\n        1) • grandchild\n    + sibling\n⬥ next";
    const outer = list(parseGuide(input).messages[0].blocks[0]);
    expect(outer.items).toHaveLength(2);
    expect(outer.items[0].children.map(block => block.type)).toEqual(["paragraph", "list"]);
    expect(outer.items[0].children[0]).toMatchObject({ raw: "+ parent" });
    const nested = list(outer.items[0].children[1]);
    expect(nested.items.map(item => item.marker)).toEqual(["+", "+"]);
    expect(nested.items[0].children.map(block => block.type)).toEqual(["paragraph", "list"]);
    expect(nested.items[0].children[0]).toMatchObject({ raw: "- child" });
    const deepest = list(nested.items[0].children[1]);
    expect(deepest).toMatchObject({ style: "number", items: [{ marker: "1)", children: [{ type: "paragraph", raw: "• grandchild" }] }] });
  });

  it("preserves standalone plus lists, continuation lines and later nested lists", () => {
    const input = "+ + first\n  continued **bold**\n  + nested\n+ second\n  continuation";
    const doc = parseGuide(input);
    const outer = list(doc.messages[0].blocks[0]);
    expect(outer.items.map(item => item.marker)).toEqual(["+", "+"]);
    expect(outer.items[0].children.map(block => block.type)).toEqual(["paragraph", "list"]);
    expect(outer.items[0].children[0]).toMatchObject({
      raw: "+ first\n  continued **bold**",
      children: [{ type: "text", value: "+ first" }, { type: "line-break" }, { type: "text", value: "  continued " }, { type: "bold" }],
    });
    expect(list(outer.items[0].children[1]).items[0].marker).toBe("+");
    expect(outer.items[1].children).toMatchObject([{ type: "paragraph", raw: "second\n  continuation" }]);
    expect(doc.diagnostics).toEqual([]);
  });

  it.each([">", ">>>"])("preserves %s quoted lists and their nested lists", quote => {
    const doc = parseGuide(`${quote} + + literal\n>   continued\n>   - nested\n> + next`);
    const block = doc.messages[0].blocks[0];
    expect(block.type).toBe("blockquote");
    if (block.type !== "blockquote") throw new Error("Expected blockquote");
    const outer = list(block.children[0]);
    expect(outer.items.map(item => item.marker)).toEqual(["+", "+"]);
    expect(outer.items[0].children.map(child => child.type)).toEqual(["paragraph", "list"]);
    expect(outer.items[0].children[0]).toMatchObject({ type: "paragraph", children: [{ type: "text", value: "+ literal" }, { type: "line-break" }, { type: "text", value: "  continued" }] });
    expect(list(outer.items[0].children[1]).items[0].marker).toBe("-");
    expect(doc.diagnostics).toEqual([]);
  });

  it.each(["\n", "\r\n"])("preserves exact offsets and line/column ranges with %j", newline => {
    const input = ["🚀 intro", "> ⬥ + **bold**", ">     + • nested"].join(newline);
    const doc = parseGuide(input);
    const quote = doc.messages[0].blocks[1];
    if (quote.type !== "blockquote") throw new Error("Expected blockquote");
    const outer = list(quote.children[0]);
    const head = outer.items[0].children[0];
    if (head.type !== "paragraph") throw new Error("Expected paragraph");
    const position = (line: number, column: number) => ({ line, column, offset: input.split(newline).slice(0, line - 1).reduce((sum, text) => sum + text.length + newline.length, 0) + column - 1 });
    const range = (line: number, column: number, endLine: number, endColumn: number) => ({ start: position(line, column), end: position(endLine, endColumn), startLine: line, endLine });
    expect(outer.range).toEqual(range(2, 3, 3, 17));
    expect(outer.items[0].range).toEqual(range(2, 3, 3, 17));
    expect(head.range).toEqual(range(2, 5, 2, 15));
    expect(head.children[0]).toMatchObject({ raw: "+ ", range: range(2, 5, 2, 7) });
    expect(head.children[1]).toMatchObject({ type: "bold", raw: "**bold**", range: range(2, 7, 2, 15), children: [{ raw: "bold", range: range(2, 9, 2, 13) }] });
    const nested = list(outer.items[0].children[1]);
    expect(nested.range).toEqual(range(3, 3, 3, 17));
    expect(nested.items[0].children).toMatchObject([{ type: "paragraph", raw: "• nested", range: range(3, 9, 3, 17) }]);
    const checkRaw = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if ("raw" in value && "range" in value) {
        const node = value as { raw: string; range: { start: { offset: number }; end: { offset: number } } };
        expect(input.slice(node.range.start.offset, node.range.end.offset)).toBe(node.raw);
      }
      Object.values(value).forEach(checkRaw);
    };
    checkRaw(doc.messages);
  });
});
