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
  '.tag:equipment',
  '⬥ **Bring food**',
  '⬥ Equip your weapon',
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

`parseGuide` is the only runtime export. All types listed below are available as named type exports from `@pvme/guide-parser`. Internal block/inline parsing helpers are not part of the public API; there are no public subpath exports.

```ts
import type { GuideDocument, ParseOptions } from '@pvme/guide-parser';

declare function parseGuide(text: string, options?: ParseOptions): GuideDocument;
```

The function is synchronous and deterministic. Pass the complete guide as a string; read files or fetch content in your app before calling it. Malformed guide syntax is normally preserved in the result with diagnostics rather than rejected.

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

Render `messages[].blocks` in order. The document-level indexes refer to content already in the tree: rendering them again duplicates content. In particular, a valid `.img:` or `.file:` produces both a command block and an attachment block; render the attachment as media and treat the command as metadata.

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

A line whose trimmed text is exactly `.` separates messages, except inside a fenced code block. Headings, tags and attachments do not create message boundaries. Empty segments between adjacent separators do not create messages; separator ranges are still retained.

A `GuideMessage` describes a source segment, not the number of Discord API sends. Your bot may need to split a segment for platform limits or text/image ordering. `index` and `messageIndex` are zero-based.

Headings produce sections. `parentId` points to the preceding enclosing heading with a lower level. A section extends until the next heading of the same or lower level, or the end of the document, and may span messages. IDs currently use `section-<source offset>`; they can change after edits.

A `.tag:` attaches to the latest preceding section, even across message separators. With no preceding heading it still creates an anchor for the current message, with null heading/section fields and a warning. Duplicate tags remain in message anchors, but `guide.tags` keeps the first definition and reports an error. Tag matching is case-sensitive.

Message metadata comes from valid commands: `pin` holds the last pin parameter, `reactions` collects reaction parameters, and `explicitBlank` records `.blank:`. No metadata executes an action on its own.

## Supported syntax

This is a PVME/Discord-oriented parser, not a general CommonMark implementation.

| Syntax | Result |
| --- | --- |
| `# Heading` through `###### Heading` | Heading blocks with inline formatting. |
| Plain text, blank lines | Paragraphs and blank blocks; paragraph newlines become `line-break` nodes. |
| `> quote`, `>>> multiline quote` | Blockquotes; `>>>` consumes the remaining lines in the source message. Nested quotes and quoted lists are supported. |
| `-# small print` | Subtext block. |
| Bullet, number and letter markers | List blocks with nested block content; see below. |
| Fences of three or more backticks or tildes | Literal code blocks, including same-line fences. An optional language is retained. |
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
| `..tag:literal` at block level | Escapes one leading dot, producing literal `.tag:literal` text. |

Discord IDs and timestamp values remain strings to avoid numeric precision loss. Links retain their URLs as supplied; your app must decide how to resolve or display them. The parser does not sanitise HTML or URLs for rendering.

### Lists

Supported bullet markers are `⬥ • ⬩ ● ○ ▪ ▫ ‣ ► ◆ ★ → * + -`. Number markers use digits followed by `.` or `)`; letter markers use one ASCII letter followed by `.` or `)`. A marker must be followed by whitespace.

More-indented subsequent lines can form nested lists or continuation text. `indent` is the count of leading whitespace characters, not a visual tab width. Number and letter lists have `ordered: true`; the original marker is retained in each item.

A marker at the start of an item's text on the same line is literal. For example, `⬥ + represents **multiple slots**` produces one item with marker `⬥` and paragraph text starting with `+ `. A standalone `+ item` still starts a list.

## Commands and metadata

Commands are recognised at the top block level of a message. Recursive parsing of list and quote content does not handle commands; fenced and inline code is literal. An indented command line can end a top-level list and be handled as a top-level command. Command names are lowercased and parameters trimmed. The colon is required, including for empty parameters.

| Command | Behavior |
| --- | --- |
| `.tag:name` | Creates an anchor; requires a nonempty name. Names outside letters, digits, `_` and `-` are retained with a warning. |
| `.img:https://example.com/image.png` | Creates an image attachment; requires a whitespace-free HTTP(S) URL. Angle-bracket URLs are also accepted. |
| `.file:https://example.com/file.txt` | Creates a file attachment with the same URL rules. |
| `.pin:` | Stores an empty pin parameter; your consumer decides the action. |
| `.pin:delete` | Stores `"delete"`. Other values are preserved with `LEGACY_PIN_VALUE`. |
| `.react:emoji` | Collects a nonempty reaction parameter as supplied. |
| `.blank:` | Sets `explicitBlank: true`; its parameter must be empty. |
| `.embed:json` | Closes a preceding JSON payload; without one, reports a malformed command. |

Unknown commands produce `unknown-command` blocks with `valid: false`. Known malformed commands remain `command` blocks with `valid: false`.

### JSON embeds

Place the JSON before its marker:

```text
{"title":"Equipment","description":"See $linkmsg_equipment$"}
.embed:json
```

The parser preserves the complete parsed JSON value, including any `content`, `embed` or `embeds` wrapper. It does not validate Discord's embed schema. Invalid JSON produces an embed with `valid: false`, `value: null` and an `INVALID_EMBED_JSON` diagnostic. The marker also becomes a command block.

References in JSON strings are indexed without replacing their values. Their positions map to the original JSON source, including escape sequences.

## Source positions

All content nodes extend `Located`, with `raw` and `range`. `source` is never normalised. LF, CRLF, Unicode and stripped quote/list prefixes retain positions in the original input.

- `line` and `column` are one-based.
- `offset` is a zero-based JavaScript UTF-16 code-unit offset, not a byte or Unicode code-point index.
- `range.end` is exclusive.
- `startLine` and `endLine` repeat the endpoint line numbers for convenience.

For a located node, `source.slice(range.start.offset, range.end.offset) === raw`. Use `value` or `children` for interpreted content: `raw` includes delimiters and may include intervening prefixes/indentation in multiline nodes. Parent and child ranges may overlap. Section ranges describe whole section extents, while heading block ranges cover the heading itself.

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

Each diagnostic has a string `code`, human-readable `message`, `severity` and source `range`. Prefer codes and severities for program logic. Your app decides whether warnings or errors block saving or publishing. Not every unrecognised or unmatched punctuation sequence emits a diagnostic; some remain ordinary text.

| Code | Severity | Meaning |
| --- | --- | --- |
| `DUPLICATE_TAG` | error | A tag was defined more than once; the first lookup entry is retained. |
| `INVALID_EMBED_JSON` | error | Embed payload cannot be parsed as JSON. |
| `MALFORMED_COMMAND` | error | A known command has missing/invalid parameters or an embed marker lacks its payload. |
| `UNCLOSED_CODE_FENCE` | error | A fenced code block has no closing fence. |
| `MISSING_TAG` | warning | A tag reference is absent from this guide and `externalTags`. |
| `TAG_WITHOUT_HEADING` | warning | An anchor has no preceding section. |
| `NONCANONICAL_TAG` | warning | A legacy tag name uses noncanonical characters. |
| `LEGACY_PIN_VALUE` | warning | Pin parameter is neither empty nor `delete`. |
| `UNKNOWN_COMMAND` | warning | A command name is not recognised. |
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

The playground shows parsed data and diagnostics. After editing parser source, run `npm run build -w @pvme/guide-parser` to refresh the linked package. Set `PVME_GUIDES_PATH` to a local guide checkout to include the full corpus in `npm test`.

The package also builds independently with `npm install` and `npm run build` inside `module/`. `npm pack` runs the build through `prepack`. The package contains `dist/`, the CLI, this README and package metadata; import through the public package entry.

Releases follow semantic versioning. Breaking public API changes require a major package version; breaking AST changes also increment `schemaVersion`. Package version and schema version are separate. Source offsets and derived section IDs can change whenever source text changes, so reparse after editing rather than treating old ranges as live anchors.
