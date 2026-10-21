import type { GuideMessage } from "./types.js";

export interface DiscordSerializationOptions {
  /** Resolve every legacy $linkmsg_tag$ occurrence, including inside code. */
  resolveTag: (tag: string) => string;
}

/** Serialize semantic content; raw/source and the AST remain untouched.
 * Throws RangeError when substituted, padded text exceeds 2000 UTF-16 units.
 */
export function serializeDiscordMessage(message: Pick<GuideMessage, "content">, options?: DiscordSerializationOptions): string {
  let text = message.content.replace(/\$linkmsg_(.*?)\$/g, (_match, tag: string) => {
    if (!options) throw new Error(`No tag resolver supplied for ${tag}`);
    return options.resolveTag(tag);
  });
  if (/^[ \n]/.test(text)) text = "\u200b" + text;
  if (/\n$/.test(text)) text += "\u200b";
  if (!text) text = "\u200b";
  if (text.length > 2000) throw new RangeError(`Message text exceeds 2000 characters (${text.length})`);
  return text;
}
