import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { parseGuide, serializeDiscordMessage } from "@pvme/guide-parser";

const contents = (text: string) => parseGuide(text).messages.map(m => m.content);
it.each([
  ["separator", "A\n.\nB", ["A", "B"]],
  ["empty segments", ".\nA\n.\n.\nB\n.", ["", "A", "", "B", ""]],
  ["empty input", "", [""]],
  ["final newline", "A\n.\n", ["A", ""]],
  ["one ignored newline", "A\r\n\r\n", ["A\n"]],
  ["one-dot escape", "..tag:x\n...", [".tag:x\n.."]],
  ["escaped code", "```\n..tag:x\n```", ["```\n.tag:x\n```"]],
  ["separator inside code", "```\n.\n```", ["```", "```"]],
  ["indented dots", " .\n ..tag:x\n .tag:x", [" .\n ..tag:x\n .tag:x"]],
  ["command to content", "A\n.tag:x\nB", ["A", "B"]],
  ["blank after command", "A\n.tag:x\n\nB", ["A", "\nB"]],
])("scans %s", (_rule, input, expected) => expect(contents(input as string)).toEqual(expected));

it("unescapes code values and preserves every original raw slice", () => {
  const text = "```\r\n..tag:x\r\n```\r\n";
  const doc = parseGuide(text);
  expect(doc.source).toBe(text);
  expect(doc.messages[0].raw).toBe(text);
  expect(doc.messages[0].blocks[0]).toMatchObject({ type: "codeblock", value: ".tag:x" });
  function check(value: any) {
    if (!value || typeof value !== "object") return;
    if (value.raw !== undefined && value.range) expect(text.slice(value.range.start.offset, value.range.end.offset)).toBe(value.raw);
    Object.values(value).forEach(check);
  }
  check(doc);
});

it("preserves parameter spaces and enforces case-sensitive legacy commands", () => {
  const doc = parseGuide("A\n.tag: name\n.react: ✅\n.pin: delete\n.TAG:x\n.blank:");
  expect(doc.commands.map(c => [c.name, c.parameter, c.valid])).toEqual([
    ["tag", " name", true], ["react", " ✅", true], ["pin", " delete", false], ["TAG", "x", false], ["blank", "", false],
  ]);
  expect(doc.tags[" name"].messageIndex).toBe(0);
  expect(parseGuide(".tag:\n.react:\n.pin:\n.embed:").commands.every(c => c.valid)).toBe(true);
});

it("allows one tag and one attachment per message", () => {
  const doc = parseGuide("A\n.tag:a\n.tag:b\n.img:https://x/a\n.file:https://x/b");
  expect(doc.commands.map(c => c.valid)).toEqual([true, false, true, false]);
  expect(doc.messages[0].anchors.map(a => a.tag)).toEqual(["a"]);
  expect(doc.attachments).toHaveLength(1);
  expect(doc.diagnostics.map(d => d.code)).toEqual(["MULTIPLE_MESSAGE_TAGS", "MULTIPLE_MESSAGE_ATTACHMENTS"]);
});

it.each([["", "\u200b"], [" Hello", "\u200b Hello"], ["\nHello", "\u200b\nHello"], ["Hello\n", "Hello\n\u200b"]])(
  "serializes edge whitespace %j", (content, expected) => {
    const message = { content };
    expect(serializeDiscordMessage(message)).toBe(expected);
    expect(message.content).toBe(content);
  },
);

it("checks 2000 characters after global link substitution and padding", () => {
  const resolveTag = () => "x".repeat(1999);
  expect(serializeDiscordMessage({ content: "$linkmsg_a$" }, { resolveTag })).toHaveLength(1999);
  expect(serializeDiscordMessage({ content: " $linkmsg_a$" }, { resolveTag: () => "x".repeat(1998) })).toHaveLength(2000);
  expect(() => serializeDiscordMessage({ content: " $linkmsg_a$" }, { resolveTag })).toThrow(RangeError);
  expect(() => serializeDiscordMessage({ content: "x".repeat(2000) + "\n" })).toThrow(RangeError);
  expect(serializeDiscordMessage({ content: "```\n$linkmsg_a$\n```" }, { resolveTag: () => "url" })).toBe("```\nurl\n```");
  expect(() => serializeDiscordMessage({ content: "$linkmsg_a$" })).toThrow("No tag resolver");
});

it("retains complete JSON envelopes and content without the reference's truncation bug", () => {
  const value = { content: "Hello", embeds: [{ title: "One" }, { title: "Two" }] };
  const doc = parseGuide(JSON.stringify(value) + "\n.embed:json");
  expect(doc.embeds[0].value).toEqual(value);
  expect(serializeDiscordMessage(doc.messages[0])).toBe("Hello");
  expect(doc.diagnostics).toEqual([]);
});

const fixtures = { "afk-arch-glacor.txt": 24, "alt1.txt": 29, "biting.txt": 1, "style-guide.txt": 37, "telos_basic_test.txt": 32 };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
it("keeps reference message counts for real guides", () => {
  for (const [name, count] of Object.entries(fixtures)) {
    const doc = parseGuide(fixture(name));
    expect(doc.messages, name).toHaveLength(count);
    expect(doc.diagnostics, name).toEqual([]);
  }
});

const referencePath = process.env.PVME_SYNTAX_CHECKER_PATH ?? resolve("../pvme/syntax-checker/syntax.js");
it.skipIf(!existsSync(referencePath))("matches local reference ownership and serialized text", async () => {
  // Expose messages and record command lines without changing reference behavior.
  const code = readFileSync(referencePath, "utf8").replace("return results;", "return { results, messages };")
    .replace('if (line[0] !== ".") {', 'if (line[0] !== ".") { (message.commands ??= []).push(i + 1);');
  const context = { require: createRequire(import.meta.url), module: { exports: {} as any } };
  runInNewContext(code, context);
  const resolveTag = () => "https://discordapp.com/channels/00000000000000000000/00000000000000000000/00000000000000000000";
  for (const name of Object.keys(fixtures)) {
    const text = fixture(name), doc = parseGuide(text);
    const ref = await context.module.exports.checkFile(name, Buffer.from(text));
    const owners = doc.messages.map(m => ({ tag: m.anchors[0]?.tag ?? null, commands: doc.commands
      .filter(c => c.range.start.offset >= m.range.start.offset && c.range.end.offset <= m.range.end.offset)
      .map(c => c.range.start.line) }));
    expect(owners, name).toEqual(ref.messages.map((m: any) => ({ tag: m.tag ?? null, commands: m.commands ?? [] })));
    expect(doc.messages.map(m => serializeDiscordMessage(m, { resolveTag })), name).toEqual(ref.messages.map((m: any) => m.text));
  }
});
