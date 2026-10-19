/** Positions are one-based lines/columns and zero-based UTF-16 offsets. End is exclusive. */
export interface SourcePosition { line: number; column: number; offset: number }
export interface SourceRange { start: SourcePosition; end: SourcePosition; startLine: number; endLine: number }
export interface Diagnostic { severity: "error" | "warning"; code: string; message: string; range: SourceRange }
export interface Located { raw: string; range: SourceRange }
export interface TextNode extends Located { type: "text"; value: string }
export interface StyleNode extends Located { type: "bold" | "italic" | "underline" | "strikethrough" | "spoiler"; children: InlineNode[] }
export interface InlineCodeNode extends Located { type: "inline-code"; value: string }
export interface LinkNode extends Located { type: "link" | "image"; url: string; title?: string; suppressEmbed: boolean; children: InlineNode[]; destination: ReferenceNode[] }
export interface EmojiNode extends Located { type: "emoji"; name: string; id: string | null; animated: boolean }
export interface MentionNode extends Located { type: "mention"; kind: "channel" | "user" | "role" | "everyone" | "here" | "special"; target: string }
export interface ReferenceNode extends Located { type: "reference"; kind: "tag" | "data" | "data-link" | "template"; target: string }
export interface TimestampNode extends Located { type: "timestamp"; timestamp: string; style?: string }
export interface UnknownInlineNode extends Located { type: "unknown-inline" }
export interface BreakNode extends Located { type: "line-break" | "spacer" }
export type InlineNode = TextNode | StyleNode | InlineCodeNode | LinkNode | EmojiNode | MentionNode | ReferenceNode | TimestampNode | UnknownInlineNode | BreakNode;
export interface ParagraphBlock extends Located { type: "paragraph"; children: InlineNode[] }
export interface HeadingBlock extends Located { type: "heading"; id: string; level: number; text: string; children: InlineNode[] }
export interface BlankBlock extends Located { type: "blank" }
export interface CodeBlock extends Located { type: "codeblock"; value: string; language: string | null; closed: boolean; fence: string }
export interface QuoteBlock extends Located { type: "blockquote"; children: BlockNode[]; multiline: boolean }
export interface ListItem extends Located { type: "list-item"; marker: string; indent: number; children: BlockNode[] }
export interface ListBlock extends Located { type: "list"; ordered: boolean; style: "bullet" | "number" | "letter"; items: ListItem[] }
export interface SubtextBlock extends Located { type: "subtext"; children: InlineNode[] }
export interface AttachmentBlock extends Located { type: "attachment"; kind: "image" | "file"; url: string }
/** Exact JSON shape retained, including content, embed and embeds wrappers. */
export interface EmbedBlock extends Located { type: "embed"; value: unknown; valid: boolean; references: ReferenceNode[] }
export interface CommandBlock extends Located { type: "command" | "unknown-command"; name: string; parameter: string; valid: boolean }
export type BlockNode = ParagraphBlock | HeadingBlock | BlankBlock | CodeBlock | QuoteBlock | ListBlock | SubtextBlock | AttachmentBlock | EmbedBlock | CommandBlock;
export interface GuideAnchor { tag: string; heading: string | null; headingLevel: number | null; sectionId: string | null; messageIndex: number; range: SourceRange }
export interface GuideSection { id: string; heading: string; level: number; parentId: string | null; messageIndex: number; tags: string[]; range: SourceRange }
export interface GuideMessage extends Located { index: number; blocks: BlockNode[]; anchors: GuideAnchor[]; pin: string | null; reactions: string[]; explicitBlank: boolean }
export interface ParseOptions { /** Host-provided tags; no network resolution is performed. */ externalTags?: readonly string[]; /** Defaults to true. */ validateReferences?: boolean }
export interface GuideDocument {
  type: "document"; schemaVersion: 1; source: string; range: SourceRange;
  messages: GuideMessage[]; sections: GuideSection[]; tags: Record<string, GuideAnchor>;
  references: ReferenceNode[]; commands: CommandBlock[]; embeds: EmbedBlock[]; attachments: AttachmentBlock[];
  separators: SourceRange[]; diagnostics: Diagnostic[];
}
