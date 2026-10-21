# @pvme/guide-parser

Parse PVME guide text into a structured, JSON-serialisable document for websites, editors and bots. The package includes a JavaScript API, TypeScript declarations and a command-line tool.

- Requires Node.js 20+ for Node and CLI use.
- Uses ESM imports. Browser apps can use an ESM bundler.
- Has no runtime dependencies and makes no network requests.
- Leaves rendering, reference resolution and Discord API calls to your app.

## Contents

- [Installation and quick start](#installation-and-quick-start)
- [API and options](#api-and-options)
- [Reading the result](#reading-the-result)
- [Supported syntax](#supported-syntax)
- [Commands and metadata](#commands-and-metadata)
- [Discord text serialization](#discord-text-serialization)
- [Source positions](#source-positions)
- [Diagnostics](#diagnostics)
- [Complete TypeScript types](#complete-typescript-types)
- [Command-line tool](#command-line-tool)
- [Development and compatibility](#development-and-compatibility)

## Installation and quick start

Install from npm when the package is available in your registry:

```sh
npm install @pvme/guide-parser
```

To use a local checkout before publication, run `npm install` and `npm run build` inside `module/`, then `npm pack`. Install the resulting `.tgz` in your consuming project with `npm install /path/to/package.tgz`.

```ts
import { parseGuide, type GuideDocument, type ParseOptions } from '@pvme/guide-parser';

const source = [
  '# __Equipment__',
  '⬥ **Bring food**',
  '⬥ Equip your weapon',
  '.tag:equipment',
  '.',
  'See $linkmsg_equipment$.',
].join('\n');

const options: ParseOptions = { validateReferences: true };
const guide: GuideDocument = parseGuide(source, options);

console.log(guide.messages.length);          // 2
console.log(guide.tags.equipment.heading);   // Equipment
console.log(guide.references[0].target);     // equipment
console.log(guide.diagnostics);              // []
```

## API and options

Import `parseGuide`, `serializeDiscordMessage` and the public types from `@pvme/guide-parser`. Internal helpers have no public subpath exports.

```ts
import type { GuideDocument, ParseOptions } from '@pvme/guide-parser';

declare function parseGuide(text: string, options?: ParseOptions): GuideDocument;
```

`parseGuide` is synchronous and deterministic. Pass the complete guide as a string; your app handles files and network requests.

Malformed syntax is usually kept in the result with diagnostics.

| Option | Default | Behavior |
| --- | --- | --- |
| `validateReferences` | `true` | Reports `MISSING_TAG` for tag references absent from both this guide and `externalTags`. Checks run after parsing, so forward references work. |
| `externalTags` | `[]` | Names of tags provided by your app. Suppresses missing-tag warnings for those names; does not create anchors or resolve references. |

Setting `validateReferences: false` disables only missing-tag checks. Other syntax diagnostics still apply. References remain in the document with either setting.

## Reading the result

The result is a tree of messages, blocks and inline nodes, plus indexes for common lookups. It can be passed to `JSON.stringify` without conversion.

| `GuideDocument` field | Meaning |
| --- | --- |
| `type`, `schemaVersion` | Currently `"document"` and `1`. |
| `source`, `range` | Complete original input and its source range. |
| `messages` | Source segments in order, each containing ordered `blocks`. |
| `sections` | Headings with hierarchy, tags and section extents. |
| `tags` | Tag name to its first defined anchor. This is a null-prototype object; use `Object.hasOwn` to check keys. |
| `references` | All discovered references, including those in link destinations and embed JSON strings. Includes references to tags that exist. |
| `commands` | Recognised and unknown command blocks. Check `valid` before applying metadata. |
| `embeds`, `attachments` | Embed and attachment blocks indexed from the content. |
| `separators` | Ranges of message separator lines. |
| `diagnostics` | Warnings and errors sorted by source offset, then diagnostic code. |

Render `messages[].blocks` in order. The document indexes point to the same content, so rendering both would duplicate it.

For `.img:` and `.file:`, render the attachment block as media and treat the command block as metadata.

Blocks and inline nodes use a `type` field to identify their shape. Lists contain `items`, whose `children` are blocks. Quotes also contain blocks. Paragraphs, headings and subtext contain inline nodes. Styles and links can contain more inline nodes.

This example walks blocks and collects paragraph inline nodes, including paragraphs in lists and quotes:

```ts
import { parseGuide, type BlockNode, type InlineNode } from '@pvme/guide-parser';

function paragraphContent(blocks: BlockNode[]): InlineNode[][] {
  const result: InlineNode[][] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        result.push(block.children);
        break;
      case 'list':
        for (const item of block.items) result.push(...paragraphContent(item.children));
        break;
      case 'blockquote':
        result.push(...paragraphContent(block.children));
        break;
    }
  }
  return result;
}

const guide = parseGuide('⬥ **Food**\n    + Potion');
const paragraphs = guide.messages.flatMap(message => paragraphContent(message.blocks));
console.log(paragraphs.length); // 2
```

### Messages, sections and tags

The PVME scanner runs before Markdown. A column-1 dot followed only by whitespace separates messages, even inside code fences or multiline quotes. A column-1 `..` escapes exactly one dot, including inside fences. Indented dots remain literal.

Once commands begin, the next content line starts a new message. Blank lines and escaped-dot lines count as content.

The scanner also:

- Keeps empty segments before, between and after separators.
- Removes CR characters and ignores exactly one final LF from semantic text.
- Preserves the original input in `source`, `raw` and ranges.

`message.content` keeps the Markdown text, with commands removed, dot escapes applied and line endings normalized. Exactly one final file newline is ignored.

For JSON embeds, it holds the envelope's string `content`, or empty text. Use this field for publication; `message.raw` is the original source slice.

A `GuideMessage` describes a source segment, not the number of Discord API sends. Your bot may need to split a segment for platform limits or text/image ordering. `index` and `messageIndex` are zero-based.

Headings produce sections:

- `parentId` identifies the enclosing heading with a lower level.
- A section ends at the next heading of the same or lower level, or at the document end. It can span messages.
- IDs use `section-<source offset>` and can change after edits.

A `.tag:` belongs to its message and links to the latest preceding section, even across separators. Without a heading, its heading and section fields are null.

Only one tag is allowed per message. Duplicate names across messages produce an error; `guide.tags` keeps the first definition. Tag matching is case-sensitive.

Valid commands populate message metadata:

- `pin`: the last pin parameter.
- `reactions`: the reaction parameters.
- `explicitBlank`: always false; retained for API compatibility. `.blank:` is not legacy syntax.

Metadata does not execute actions.

## Supported syntax

This is a PVME/Discord-oriented parser, not a general CommonMark implementation.

| Syntax | Result |
| --- | --- |
| `# Heading` through `###### Heading` | Heading blocks with inline formatting. |
| Plain text, blank lines | Paragraphs and blank blocks; paragraph newlines become `line-break` nodes. |
| `> quote`, `>>> multiline quote` | Blockquotes; `>>>` consumes the remaining lines in the source message. Nested quotes and quoted lists are supported. |
| `-# small print` | Subtext block. |
| Bullet, number and letter markers | List blocks with nested block content; see below. |
| Fences of three or more backticks or tildes | Code blocks after PVME scanning, including same-line fences. An optional language is retained. |
| `**bold**`, `*italic*`, `_italic_`, `__underline__`, `~~strike~~` | Style nodes, including nested formatting. |
| `\|\|spoiler\|\|` | Spoiler style node. |
| Backtick-delimited inline code | Literal `inline-code` node. |
| `[label](url)`, `![alt](url)` | Links/images with formatted labels and optional quoted titles. Balanced parentheses in destinations are supported. |
| Bare HTTP(S) URLs, `<https://example.com>` | Links; angle brackets set `suppressEmbed: true`. This also works in explicit link destinations. |
| `<:name:123>`, `<a:name:123>`, `:name:` | Emoji nodes. Named emoji have `id: null`; Unicode emoji stay text. |
| `<@123>`, `<@!123>`, `<@&123>`, `<#123>`, `@here`, `@everyone` | Mention nodes. |
| `<id:guide>`, `<id:customize>` | Special mentions; other special names are retained with a warning. |
| `<t:123>`, `<t:123:R>` | Timestamp nodes. |
| `$linkmsg_name$` | Tag reference with target `name`. |
| `$data_pvme:Perks!A1$`, `$data_link:123:meter$` | Data/data-link references; target excludes the syntax prefix. |
| `{{channel:id}}` | Template reference; other template names are retained with a warning. |
| `_ _` | Spacer node. |
| Backslash before punctuation | Literal escaped character. |
| `..tag:literal` at column 1 | Escapes one leading dot, producing literal `.tag:literal` text. |

Discord IDs and timestamp values remain strings to avoid numeric precision loss. Links retain their URLs as supplied; your app must decide how to resolve or display them. The parser does not sanitise HTML or URLs for rendering.

### Lists

Supported bullet markers are `⬥ • ⬩ ● ○ ▪ ▫ ‣ ► ◆ ★ → * + -`. Number markers use digits followed by `.` or `)`; letter markers use one ASCII letter followed by `.` or `)`. A marker must be followed by whitespace.

More-indented subsequent lines can form nested lists or continuation text. `indent` is the count of leading whitespace characters, not a visual tab width. Number and letter lists have `ordered: true`; the original marker is retained in each item.

A marker at the start of an item's text on the same line is literal. For example, `⬥ + represents **multiple slots**` produces one item with marker `⬥` and paragraph text starting with `+ `. A standalone `+ item` still starts a list.

## Commands and metadata

Commands start at column 1 and are processed before Markdown, including code fences.

- Names are case-sensitive and require a colon.
- Spaces immediately after the colon belong to the parameter.
- Trailing command whitespace is removed from the parameter but kept in `raw`.

| Command | Behavior |
| --- | --- |
| `.tag:name` | One tag per message; empty names are accepted by the reference. Noncanonical names are retained with a warning. No heading is required. |
| `.img:https://example.com/image.png` | Image attachment; one attachment total across `.img:` and `.file:` per message. Uses the checker's permissive HTTP(S) substring validation. |
| `.file:https://example.com/file.txt` | File attachment, sharing the same limit. Angle-bracket URL wrappers are removed from the attachment URL. |
| `.pin:` / `.pin:delete` | Only empty and `delete` parameters are valid. |
| `.react:emoji` | Collects the parameter literally, including an empty value. |
| `.embed:` | Accepted legacy marker; leaves text unchanged. |
| `.embed:json` | Parses the entire preceding message content as JSON. |

`.blank:` and differently cased names such as `.TAG:` are unknown commands. Unknown and malformed commands are preserved with `valid: false` and error diagnostics. Extra tags/attachments remain as invalid command nodes; they do not create extra anchors/attachments.

### JSON embeds

Place the JSON before its marker:

```text
{"title":"Equipment","description":"See $linkmsg_equipment$"}
.embed:json
```

The parser keeps the full JSON value, including `content`, `embed` and `embeds` wrappers. It does not validate Discord's embed schema.

Invalid JSON produces `valid: false`, `value: null` and an `INVALID_EMBED_JSON` diagnostic. The marker also becomes a command block.

References in JSON strings are indexed without replacing their values. Their positions map to the original JSON source, including escape sequences.

## Discord text serialization

```ts
import { parseGuide, serializeDiscordMessage } from '@pvme/guide-parser';

const doc = parseGuide('Hello\n$linkmsg_intro$');
const text = serializeDiscordMessage(doc.messages[0], {
  resolveTag: tag => `https://discord.com/channels/1/2/${tag === 'intro' ? '3' : '4'}`,
});
```

`serializeDiscordMessage(message, options?)` returns text ready for Discord. It replaces `$linkmsg_tag$` everywhere, including code, using `options.resolveTag(tag)`.

Supply a resolver when links occur, and have it reject unresolved tags. The editor's AST reference index still excludes code.

After substitution, the serializer adds zero-width spaces (`\u200B`):

- Empty text becomes `\u200B`.
- An initial space or LF gets a leading `\u200B`.
- A final LF gets a trailing `\u200B`.

Other whitespace stays unchanged. Text over 2000 UTF-16 code units throws `RangeError`. Apply other substitutions before this final check.

Serialization leaves source, ranges, AST and `message.content` unchanged. Your app sends attachments and embeds.

The options type is exported as `DiscordSerializationOptions`:

```ts
interface DiscordSerializationOptions {
  resolveTag: (tag: string) => string;
}
declare function serializeDiscordMessage(
  message: Pick<GuideMessage, 'content'>,
  options?: DiscordSerializationOptions,
): string;
```

## Source positions

All content nodes extend `Located`, with `raw` and `range`. `source` is never normalised. LF, CRLF, Unicode and stripped quote/list prefixes retain positions in the original input.

- `line` and `column` are one-based.
- `offset` is a zero-based JavaScript UTF-16 code-unit offset, not a byte or Unicode code-point index.
- `range.end` is exclusive.
- `startLine` and `endLine` repeat the endpoint line numbers for convenience.

Every located node satisfies `source.slice(range.start.offset, range.end.offset) === raw`.

Use `value` or `children` for interpreted content. `raw` may include delimiters, prefixes and indentation. Parent and child ranges can overlap.

Section ranges cover whole sections; heading ranges cover only the heading.

```ts
import { parseGuide } from '@pvme/guide-parser';

const source = '> **bold**';
const guide = parseGuide(source);
const quote = guide.messages[0].blocks[0];
if (quote.type === 'blockquote') {
  const block = quote.children[0];
  if (block.type === 'paragraph') {
    const bold = block.children[0];
    console.log(bold.range.start); // { line: 1, column: 3, offset: 2 }
    console.log(source.slice(bold.range.start.offset, bold.range.end.offset)); // **bold**
  }
}
```

## Diagnostics

Each diagnostic includes a `code`, `message`, `severity` and source `range`. Use codes and severities in program logic; your app decides which diagnostics block saving or publishing.

Some unrecognised punctuation remains ordinary text without a diagnostic.

| Code | Severity | Meaning |
| --- | --- | --- |
| `MULTIPLE_MESSAGE_TAGS` | error | More than one tag in a message. |
| `MULTIPLE_MESSAGE_ATTACHMENTS` | error | More than one image/file attachment in a message. |
| `DUPLICATE_TAG` | error | A tag was defined more than once; the first lookup entry is retained. |
| `INVALID_EMBED_JSON` | error | Embed payload cannot be parsed as JSON. |
| `MALFORMED_COMMAND` | error | A known command has missing/invalid parameters or an embed marker lacks its payload. |
| `UNCLOSED_CODE_FENCE` | error | A fenced code block has no closing fence. |
| `MISSING_TAG` | warning | A tag reference is absent from this guide and `externalTags`. |
| `NONCANONICAL_TAG` | warning | A legacy tag name uses noncanonical characters. |
| `UNKNOWN_COMMAND` | error | A command name is not recognised. |
| `MALFORMED_REFERENCE` | warning | Recognised reference syntax is malformed. |
| `MALFORMED_EMOJI` | warning | Recognised custom emoji syntax is malformed. |
| `MALFORMED_MENTION` | warning | Recognised mention/timestamp syntax is malformed. |
| `UNKNOWN_TEMPLATE` | warning | A template other than `channel:id` was encountered. |
| `UNKNOWN_SPECIAL_MENTION` | warning | A special mention other than `guide` or `customize` was encountered. |
| `UNKNOWN_SYNTAX` | warning | An unrecognised angle token is preserved. |
| `FENCE_TRAILING_TEXT` | warning | Text after a closing code fence is retained in `raw`. |
| `NESTING_LIMIT` | warning | Block nesting exceeded 64 levels; remaining content is preserved as text. |

Inline style/link-label parsing also limits recursion to 64 levels; it does not emit `NESTING_LIMIT`. Inspect `raw` when handling content at extreme nesting depths.

```ts
import { parseGuide } from '@pvme/guide-parser';

const guide = parseGuide('$linkmsg_missing$');
for (const diagnostic of guide.diagnostics) {
  const { line, column } = diagnostic.range.start;
  console.log(`${line}:${column} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
}
const hasErrors = guide.diagnostics.some(diagnostic => diagnostic.severity === 'error');
console.log(hasErrors); // false: a missing tag is a warning
```

## Complete TypeScript types

These are the complete public type declarations. Import them using `import type { ... } from '@pvme/guide-parser'`. They have no runtime constructors. `BlockNode` and `InlineNode` are unions; narrow on `type` before accessing variant-specific fields.

```ts
/** Positions are one-based lines/columns and zero-based UTF-16 offsets. End is exclusive. */
export interface SourcePosition {
    line: number;
    column: number;
    offset: number;
}
export interface SourceRange {
    start: SourcePosition;
    end: SourcePosition;
    startLine: number;
    endLine: number;
}
export interface Diagnostic {
    severity: "error" | "warning";
    code: string;
    message: string;
    range: SourceRange;
}
export interface Located {
    raw: string;
    range: SourceRange;
}
export interface TextNode extends Located {
    type: "text";
    value: string;
}
export interface StyleNode extends Located {
    type: "bold" | "italic" | "underline" | "strikethrough" | "spoiler";
    children: InlineNode[];
}
export interface InlineCodeNode extends Located {
    type: "inline-code";
    value: string;
}
export interface LinkNode extends Located {
    type: "link" | "image";
    url: string;
    title?: string;
    suppressEmbed: boolean;
    children: InlineNode[];
    destination: ReferenceNode[];
}
export interface EmojiNode extends Located {
    type: "emoji";
    name: string;
    id: string | null;
    animated: boolean;
}
export interface MentionNode extends Located {
    type: "mention";
    kind: "channel" | "user" | "role" | "everyone" | "here" | "special";
    target: string;
}
export interface ReferenceNode extends Located {
    type: "reference";
    kind: "tag" | "data" | "data-link" | "template";
    target: string;
}
export interface TimestampNode extends Located {
    type: "timestamp";
    timestamp: string;
    style?: string;
}
export interface UnknownInlineNode extends Located {
    type: "unknown-inline";
}
export interface BreakNode extends Located {
    type: "line-break" | "spacer";
}
export type InlineNode = TextNode | StyleNode | InlineCodeNode | LinkNode | EmojiNode | MentionNode | ReferenceNode | TimestampNode | UnknownInlineNode | BreakNode;
export interface ParagraphBlock extends Located {
    type: "paragraph";
    children: InlineNode[];
}
export interface HeadingBlock extends Located {
    type: "heading";
    id: string;
    level: number;
    text: string;
    children: InlineNode[];
}
export interface BlankBlock extends Located {
    type: "blank";
}
export interface CodeBlock extends Located {
    type: "codeblock";
    value: string;
    language: string | null;
    closed: boolean;
    fence: string;
}
export interface QuoteBlock extends Located {
    type: "blockquote";
    children: BlockNode[];
    multiline: boolean;
}
export interface ListItem extends Located {
    type: "list-item";
    marker: string;
    indent: number;
    children: BlockNode[];
}
export interface ListBlock extends Located {
    type: "list";
    ordered: boolean;
    style: "bullet" | "number" | "letter";
    items: ListItem[];
}
export interface SubtextBlock extends Located {
    type: "subtext";
    children: InlineNode[];
}
export interface AttachmentBlock extends Located {
    type: "attachment";
    kind: "image" | "file";
    url: string;
}
/** Exact JSON shape retained, including content, embed and embeds wrappers. */
export interface EmbedBlock extends Located {
    type: "embed";
    value: unknown;
    valid: boolean;
    references: ReferenceNode[];
}
export interface CommandBlock extends Located {
    type: "command" | "unknown-command";
    name: string;
    parameter: string;
    valid: boolean;
}
export type BlockNode = ParagraphBlock | HeadingBlock | BlankBlock | CodeBlock | QuoteBlock | ListBlock | SubtextBlock | AttachmentBlock | EmbedBlock | CommandBlock;
export interface GuideAnchor {
    tag: string;
    heading: string | null;
    headingLevel: number | null;
    sectionId: string | null;
    messageIndex: number;
    range: SourceRange;
}
export interface GuideSection {
    id: string;
    heading: string;
    level: number;
    parentId: string | null;
    messageIndex: number;
    tags: string[];
    range: SourceRange;
}
export interface GuideMessage extends Located {
    content: string;
    index: number;
    blocks: BlockNode[];
    anchors: GuideAnchor[];
    pin: string | null;
    reactions: string[];
    explicitBlank: boolean;
}
export interface ParseOptions {
    externalTags?: readonly string[]; /** Defaults to true. */
    validateReferences?: boolean;
}
export interface GuideDocument {
    type: "document";
    schemaVersion: 1;
    source: string;
    range: SourceRange;
    messages: GuideMessage[];
    sections: GuideSection[];
    tags: Record<string, GuideAnchor>;
    references: ReferenceNode[];
    commands: CommandBlock[];
    embeds: EmbedBlock[];
    attachments: AttachmentBlock[];
    separators: SourceRange[];
    diagnostics: Diagnostic[];
}
```

## Command-line tool

After installing the package, the `pvme-guide-parse` executable is available in your project's `node_modules/.bin`. Use it through an npm script, `npm exec -- pvme-guide-parse`, or directly when that directory is on your `PATH`:

```sh
npm exec -- pvme-guide-parse guide.txt
```

The executable accepts one optional file argument. With no argument, or with `-`, it reads standard input:

```sh
pvme-guide-parse guide.txt
cat guide.txt | pvme-guide-parse
pvme-guide-parse - < guide.txt
```

The pipe/redirection examples above use POSIX shell syntax. From the repository, after building, you can also run `node module/bin/parse.js guide.txt` without installing the executable.

Files and stdin are read as UTF-8. Stdout contains one JSON document followed by a newline, with exactly the same structure as `parseGuide` returns. There are no CLI flags for `ParseOptions`.

A completed parse exits with status `0`, even when the JSON includes error diagnostics. I/O and usage failures write a message to stderr and exit with status `1`. For a CI validation step, inspect `diagnostics` yourself and choose your failure policy.

## Development and compatibility

From the repository root:

```sh
npm install
npm test
npm run build
npm run dev
npm run corpus -- ../pvme-guides
```

The playground shows parsed data and diagnostics. After editing parser source, run `npm run build -w @pvme/guide-parser` to refresh the linked package. Use `npm run corpus -- <local-guide-checkout>` to check the full corpus.

The package also builds independently with `npm install` and `npm run build` inside `module/`. `npm pack` runs the build through `prepack`. The package contains `dist/`, the CLI, this README and package metadata; import through the public package entry.

Releases follow semantic versioning. Breaking public API changes require a major package version; breaking AST changes also increment `schemaVersion`.

Package and schema versions are separate. Reparse after edits: source offsets and section IDs can change.

### Intentional differences from the legacy syntax checker

- JSON embed envelopes and all embeds remain intact; string `content` is not truncated by the checker's unconditional `.slice(1)`. The broken array-to-number multiple-embed check is not copied. No Discord embed schema validation is implied.
- Rich Markdown AST nodes, source ranges and additional diagnostics remain. Code fences split by PVME syntax may produce `UNCLOSED_CODE_FENCE`; they never prevent message segmentation.
- A second tag/attachment is invalid and creates no second anchor/attachment, rather than exposing contradictory metadata on erroneous input. Even an empty first tag consumes the one-tag slot.
- Missing references and noncanonical tags can emit additional diagnostics. Code references stay literal in the editor AST, while Discord text serialization performs the legacy global link substitution.
- Length checks and padding run through the shared serializer, after real link resolution, rather than mutating parser input or assuming placeholder URLs.

`test/legacy.test.ts` checks message counts for five real-guide fixtures. Its optional reference test compares command/tag ownership and serialized text directly.

Set `PVME_SYNTAX_CHECKER_PATH` to a local `syntax.js`, or use the detected path `../pvme/syntax-checker/syntax.js`.

The synthetic `syntax.txt` includes invalid legacy syntax and remains a playground sample.
