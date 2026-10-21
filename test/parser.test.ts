import { describe, expect, it } from "vitest";
import { parseGuide } from "@pvme/guide-parser";
import type { InlineNode } from "@pvme/guide-parser";

const paragraph = (s: string) => {
  const block = parseGuide(s).messages[0].blocks[0];
  if (!("children" in block)) throw new Error("Expected inline content");
  return block.children as InlineNode[];
};
const codes = (s: string) => parseGuide(s).diagnostics.map(d => d.code);
const walk = (value: any): any[] => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...Object.values(value).flatMap(walk)];

describe("messages and sections", () => {
  it("attaches tags across a separator to the preceding section and tracks hierarchy", () => {
    const doc = parseGuide("# Title\n.\n.tag:a\n## Child\n.tag:b\n### Grandchild\n# Next");
    expect(doc.tags.a.sectionId).toBe(doc.sections[0].id);
    expect(doc.sections[1].parentId).toBe(doc.sections[0].id);
    expect(doc.sections[2].parentId).toBe(doc.sections[1].id);
    expect(doc.sections[0].range.end.line).toBe(7);
  });
  it("retains unattached and duplicate tags, including prototype names", () => {
    const doc = parseGuide(".tag:__proto__\n.\n.tag:__proto__\n.\n.tag:constructor");
    expect(doc.tags.__proto__.messageIndex).toBe(0);
    expect(doc.messages.flatMap(m => m.anchors)).toHaveLength(3);
    expect(doc.diagnostics.map(d => d.code)).toContain("DUPLICATE_TAG");
    expect(JSON.parse(JSON.stringify(doc)).tags.__proto__.tag).toBe("__proto__");
  });
  it("preserves noncanonical tags without fatal style errors", () => {
    const doc = parseGuide("# Title\n.tag:weapons&gear\n$linkmsg_weapons&gear$");
    expect(doc.references[0].target).toBe("weapons&gear");
    expect(doc.diagnostics.map(d => d.code)).toEqual(["NONCANONICAL_TAG"]);
  });
});

describe("inline syntax", () => {
  it.each([["**bold**", "bold"], ["*italic*", "italic"], ["_italic_", "italic"], ["__under__", "underline"], ["~~strike~~", "strikethrough"], ["||spoiler||", "spoiler"], ["***both***", "bold"], ["___both___", "underline"]])("parses %s", (text, type) => expect(paragraph(text)[0].type).toBe(type));
  it.each(["*italic **bold***", "**bold *italic***"])("nests %s", text => {
    const nodes = walk(paragraph(text));
    expect(nodes.some(n => n.type === "bold")).toBe(true);
    expect(nodes.some(n => n.type === "italic")).toBe(true);
    expect(nodes.filter(n => n.type === "text").every(n => !/[*_]/.test(n.value))).toBe(true);
  });
  it("handles multiline emphasis and intraword underscores", () => {
    expect(paragraph("*first\nsecond*")[0].type).toBe("italic");
    expect(paragraph("word_with_underscores")[0]).toMatchObject({ type: "text", value: "word_with_underscores" });
  });
  it.each(["*italic `literal * tick` end*"])("keeps code literal inside emphasis: %s", text => {
    const nodes = paragraph(text);
    expect(nodes).toHaveLength(1);
    expect(walk(nodes).some(n => n.type === "inline-code")).toBe(true);
  });
  it("processes column-1 commands before multiline quotes", () => {
    const doc = parseGuide(">>> quote\nnext\n.tag:literal");
    expect(doc.commands.map(c => c.name)).toEqual(["tag"]);
    expect(doc.messages[0].blocks[0]).toMatchObject({ type: "blockquote", multiline: true });
  });
  it("treats code and escaped syntax as literal", () => {
    expect(parseGuide("`$linkmsg_missing$ <:bad:>`").references).toEqual([]);
    expect(codes("`<:bad:>`")).toEqual([]);
    expect(paragraph("\\*literal\\*")[0]).toMatchObject({ type: "text", value: "*literal*" });
    expect(paragraph("`` `ticks` ``")[0]).toMatchObject({ type: "inline-code", value: " `ticks` " });
  });
  it.each([
    ["[wiki](<https://x.test/Thing_(item)>)", "https://x.test/Thing_(item)", true],
    ["[wiki](https://x.test/Thing_(item))", "https://x.test/Thing_(item)", false],
    ["<https://x.test/a>", "https://x.test/a", true], ["https://x.test/a.", "https://x.test/a", false],
    ['[title](https://x.test "title")', 'https://x.test', false],
  ])("links %s", (input, url, suppressEmbed) => expect(paragraph(input)[0]).toMatchObject({ type: "link", url, suppressEmbed }));
  it("retains label formatting, images and references in destinations", () => {
    const doc = parseGuide("[**label**]($linkmsg_intro$) ![alt](https://x.test/a.png) https://x.test/?id={{channel:id}}");
    expect(doc.references.map(r => r.kind)).toEqual(["tag", "template"]);
    expect(walk(doc.messages).some(n => n.type === "image")).toBe(true);
    expect(walk(doc.messages).some(n => n.type === "bold")).toBe(true);
  });
  it("keeps Discord IDs as strings, and Unicode emoji as text", () => {
    const nodes = paragraph("<:magic:12345678901234567890> <a:wave:2> <#3> <@4> <@!5> <@&6> @here @everyone <id:guide> <t:123:R> 🚀 :wave:");
    expect(nodes[0]).toMatchObject({ type: "emoji", id: "12345678901234567890", animated: false });
    expect(nodes.filter(n => n.type === "mention")).toHaveLength(7);
    expect(nodes.some(n => n.type === "timestamp")).toBe(true);
    expect(nodes.some(n => n.type === "text" && n.value.includes("🚀"))).toBe(true);
  });
  it("recognises dynamic data and templates without resolving them", () => {
    const doc = parseGuide("$data_pvme:Perks!A1$ $data_link:123:meter$ {{channel:id}} _ _");
    expect(doc.references.map(r => [r.kind, r.target])).toEqual([["data", "Perks!A1"], ["data-link", "123:meter"], ["template", "channel:id"]]);
    expect(walk(doc.messages).some(n => n.type === "spacer")).toBe(true);
  });
});

describe("block syntax", () => {
  it("structures mixed nested lists with real PVME bullets", () => {
    const doc = parseGuide("⬥ first\n    • second\n        ⬩ third\n⬥ fourth\n\n1) number\n    a) letter\n        ⬩ bullet\n2) next");
    const lists = walk(doc.messages).filter(n => n.type === "list");
    expect(lists.map(l => l.style)).toEqual(["bullet", "bullet", "bullet", "number", "letter", "bullet"]);
    expect(lists[0].items).toHaveLength(2);
    expect(lists[3].items).toHaveLength(2);
  });
  it("supports nested blockquotes and quoted headings", () => {
    const doc = parseGuide("> ## __Warning__\n> body\n> > nested\n\n-# small print");
    expect(doc.sections[0].heading).toBe("Warning");
    expect(walk(doc.messages).filter(n => n.type === "blockquote")).toHaveLength(2);
    expect(walk(doc.messages).some(n => n.type === "subtext")).toBe(true);
  });
  it.each(["```code```", "~~~~txt\ntext\n~~~~"])("preserves code block %s", text => {
    const doc = parseGuide(text);
    expect(doc.messages).toHaveLength(1);
    expect(doc.commands).toHaveLength(0);
    expect(doc.messages[0].blocks[0]).toMatchObject({ type: "codeblock", closed: true });
    expect(doc.diagnostics).toEqual([]);
  });
  it("does not swallow ordinary brace prose", () => {
    const doc = parseGuide("{ordinary prose}\nbody\n.\n# Next");
    expect(doc.embeds).toHaveLength(0);
    expect(doc.messages).toHaveLength(2);
    expect(doc.sections[0].heading).toBe("Next");
    expect(doc.diagnostics).toEqual([]);
  });
  it.each([{ title: "direct" }, { embed: { title: "wrapped" } }])("keeps complete embed envelope %j", value => {
    const doc = parseGuide(`${JSON.stringify(value, null, 2)}\n.embed:json`);
    expect(doc.embeds[0]).toMatchObject({ value, valid: true });
    expect(doc.diagnostics).toEqual([]);
  });
  it("keeps invalid embeds and unclosed fences in the AST", () => {
    const bad = parseGuide('{"bad":}\n.embed:json\n.\n```js\nstill here');
    expect(bad.embeds[0]).toMatchObject({ valid: false, raw: '{"bad":}\n.embed:json' });
    expect(bad.messages[1].blocks[0]).toMatchObject({ type: "codeblock", closed: false, value: "still here" });
    expect(bad.diagnostics.map(d => d.code)).toEqual(["INVALID_EMBED_JSON", "UNCLOSED_CODE_FENCE"]);
  });
  it("records attachments, reactions and pin metadata", () => {
    const doc = parseGuide(".img:https://x.test/a.png\n.react:✅\n.pin:delete\n.\n.file:<https://x.test/a.zip>");
    expect(doc.attachments.map(a => a.kind)).toEqual(["image", "file"]);
    expect(doc.messages[0]).toMatchObject({ reactions: ["✅"], pin: "delete" });
  });
});

describe("diagnostics and positions", () => {
  it.each([".tag", ".file:no-url", ".embed:yaml"])("reports malformed %s", s => expect(codes(s)).toContain("MALFORMED_COMMAND"));
  it.each([["<:name:bad>", "MALFORMED_EMOJI"], ["<#bad>", "MALFORMED_MENTION"], ["$linkmsg_$", "MALFORMED_REFERENCE"], ["<Boss>", "UNKNOWN_SYNTAX"], [".future:value", "UNKNOWN_COMMAND"]])("reports and preserves %s", (s, code) => {
    const doc = parseGuide(s);
    expect(doc.diagnostics.map(d => d.code)).toContain(code);
    expect(doc.source).toBe(s);
    expect(walk(doc.messages).some(n => n.raw === s)).toBe(true);
  });
  it("validates forward references after all tags and supports external tags", () => {
    expect(codes("$linkmsg_later$\n# Title\n.tag:later")).toEqual([]);
    expect(parseGuide("$linkmsg_external$", { externalTags: ["external"] }).diagnostics).toEqual([]);
    expect(parseGuide("$linkmsg_missing$", { validateReferences: false }).diagnostics).toEqual([]);
    expect(parseGuide("text\n$linkmsg_missing$").diagnostics[0].range.start.line).toBe(2);
  });
  it("maps CRLF, Unicode, quote/list offsets and escaped JSON references exactly", () => {
    const text = '# 🚀\r\n> **bold**\r\n⬥ item\r\n    • <:magic:123>\r\n.\r\n{ "description": "\\u0024linkmsg_missing$" }\r\n.embed:json';
    const doc = parseGuide(text);
    const bold = walk(doc.messages).find(n => n.type === "bold");
    expect(bold.range.start).toEqual({ line: 2, column: 3, offset: text.indexOf("**") });
    expect(doc.references[0].range.start.line).toBe(6);
    expect(doc.references[0].range.start.offset).toBe(text.indexOf("\\u0024"));
    for (const node of walk(doc.messages)) if (node.raw !== undefined && node.range) expect(text.slice(node.range.start.offset, node.range.end.offset)).toBe(node.raw);
    expect(JSON.parse(JSON.stringify(doc)).source).toBe(text);
  });
});
