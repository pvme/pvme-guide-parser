# PVME guide parser

Turns PVME guide text into structured data that a website, guide editor or Discord bot can use.

## How it works

1. Read the original guide text from `pvme-guides`.
2. Call `parseGuide(text)` to identify headings, paragraphs, lists, formatting and guide commands.
3. Use the result to display the guide, edit it or send it through a bot.

The result includes tags, references, warnings and errors. Each node keeps its original text and source position for editor tools.

Your app handles rendering, reference resolution and publishing. The parser applies these PVME rules before Markdown:

- A `.` at the start of a line separates messages, even inside code fences.
- `..` at the start of a line escapes one dot. Indented dots stay literal.
- Content after commands starts a new message, including blank lines.
- Empty messages are kept. Exactly one final newline is ignored.

Original source text and ranges are preserved.

Use `message.content` for text with commands removed and dot escapes applied.

For Discord, `serializeDiscordMessage(message, { resolveTag })` resolves tag links, pads empty text and edge whitespace, then checks the 2000-character limit. Padding never changes the source.

```js
import { parseGuide } from "@pvme/guide-parser";

const guide = parseGuide("# My guide\n⬥ **Bring food**\n⬥ Equip your weapon");

console.log(JSON.stringify(guide, null, 2));
```

<details>
<summary>JSON response</summary>

```json
{
  "type": "document",
  "schemaVersion": 1,
  "source": "# My guide\n⬥ **Bring food**\n⬥ Equip your weapon",
  "range": {
    "start": {
      "line": 1,
      "column": 1,
      "offset": 0
    },
    "end": {
      "line": 3,
      "column": 20,
      "offset": 47
    },
    "startLine": 1,
    "endLine": 3
  },
  "messages": [
    {
      "index": 0,
      "content": "# My guide\n⬥ **Bring food**\n⬥ Equip your weapon",
      "blocks": [
        {
          "type": "heading",
          "id": "section-0",
          "level": 1,
          "text": "My guide",
          "children": [
            {
              "type": "text",
              "value": "My guide",
              "raw": "My guide",
              "range": {
                "start": {
                  "line": 1,
                  "column": 3,
                  "offset": 2
                },
                "end": {
                  "line": 1,
                  "column": 11,
                  "offset": 10
                },
                "startLine": 1,
                "endLine": 1
              }
            }
          ],
          "raw": "# My guide",
          "range": {
            "start": {
              "line": 1,
              "column": 1,
              "offset": 0
            },
            "end": {
              "line": 1,
              "column": 11,
              "offset": 10
            },
            "startLine": 1,
            "endLine": 1
          }
        },
        {
          "type": "list",
          "style": "bullet",
          "ordered": false,
          "items": [
            {
              "type": "list-item",
              "marker": "⬥",
              "indent": 0,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "bold",
                      "children": [
                        {
                          "type": "text",
                          "value": "Bring food",
                          "raw": "Bring food",
                          "range": {
                            "start": {
                              "line": 2,
                              "column": 5,
                              "offset": 15
                            },
                            "end": {
                              "line": 2,
                              "column": 15,
                              "offset": 25
                            },
                            "startLine": 2,
                            "endLine": 2
                          }
                        }
                      ],
                      "raw": "**Bring food**",
                      "range": {
                        "start": {
                          "line": 2,
                          "column": 3,
                          "offset": 13
                        },
                        "end": {
                          "line": 2,
                          "column": 17,
                          "offset": 27
                        },
                        "startLine": 2,
                        "endLine": 2
                      }
                    }
                  ],
                  "raw": "**Bring food**",
                  "range": {
                    "start": {
                      "line": 2,
                      "column": 3,
                      "offset": 13
                    },
                    "end": {
                      "line": 2,
                      "column": 17,
                      "offset": 27
                    },
                    "startLine": 2,
                    "endLine": 2
                  }
                }
              ],
              "raw": "⬥ **Bring food**",
              "range": {
                "start": {
                  "line": 2,
                  "column": 1,
                  "offset": 11
                },
                "end": {
                  "line": 2,
                  "column": 17,
                  "offset": 27
                },
                "startLine": 2,
                "endLine": 2
              }
            },
            {
              "type": "list-item",
              "marker": "⬥",
              "indent": 0,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "text",
                      "value": "Equip your weapon",
                      "raw": "Equip your weapon",
                      "range": {
                        "start": {
                          "line": 3,
                          "column": 3,
                          "offset": 30
                        },
                        "end": {
                          "line": 3,
                          "column": 20,
                          "offset": 47
                        },
                        "startLine": 3,
                        "endLine": 3
                      }
                    }
                  ],
                  "raw": "Equip your weapon",
                  "range": {
                    "start": {
                      "line": 3,
                      "column": 3,
                      "offset": 30
                    },
                    "end": {
                      "line": 3,
                      "column": 20,
                      "offset": 47
                    },
                    "startLine": 3,
                    "endLine": 3
                  }
                }
              ],
              "raw": "⬥ Equip your weapon",
              "range": {
                "start": {
                  "line": 3,
                  "column": 1,
                  "offset": 28
                },
                "end": {
                  "line": 3,
                  "column": 20,
                  "offset": 47
                },
                "startLine": 3,
                "endLine": 3
              }
            }
          ],
          "raw": "⬥ **Bring food**\n⬥ Equip your weapon",
          "range": {
            "start": {
              "line": 2,
              "column": 1,
              "offset": 11
            },
            "end": {
              "line": 3,
              "column": 20,
              "offset": 47
            },
            "startLine": 2,
            "endLine": 3
          }
        }
      ],
      "anchors": [],
      "pin": null,
      "reactions": [],
      "explicitBlank": false,
      "raw": "# My guide\n⬥ **Bring food**\n⬥ Equip your weapon",
      "range": {
        "start": {
          "line": 1,
          "column": 1,
          "offset": 0
        },
        "end": {
          "line": 3,
          "column": 20,
          "offset": 47
        },
        "startLine": 1,
        "endLine": 3
      }
    }
  ],
  "sections": [
    {
      "id": "section-0",
      "heading": "My guide",
      "level": 1,
      "parentId": null,
      "messageIndex": 0,
      "tags": [],
      "range": {
        "start": {
          "line": 1,
          "column": 1,
          "offset": 0
        },
        "end": {
          "line": 3,
          "column": 20,
          "offset": 47
        },
        "startLine": 1,
        "endLine": 3
      }
    }
  ],
  "tags": {},
  "references": [],
  "commands": [],
  "embeds": [],
  "attachments": [],
  "separators": [],
  "diagnostics": []
}
```

</details>

See the [package README](module/README.md) for API details and TypeScript types.

## Try it locally

Requires Node.js 20+ and npm 10+.

```sh
npm install
npm run dev
```

Open the URL printed in the terminal. The playground shows your guide text alongside the parsed data and any diagnostics.

After changing parser code, run `npm run build -w @pvme/guide-parser` to update the playground.

## Working on the repo

```text
module/       Parser source, public types and command-line tool
playground/   Browser playground for trying guide text
test/         Parser tests and sample guides
```

Run the tests and build both the parser and playground:

```sh
npm test
npm run build
```

To check every `.txt` guide in a local `pvme-guides` checkout:

```sh
npm run corpus -- ../pvme-guides
```

To parse a single file from the terminal after building:

```sh
node module/bin/parse.js path/to/guide.txt
```

This prints the parsed guide as JSON, so tools in other languages can use the same parser.

Real guide fixtures come from [PvM Encyclopedia](https://github.com/pvme/pvme-guides/tree/d2ff0d8ad4e9911a9c0cdc013621498b5dd6e15d) and retain their [CC BY-NC-SA 4.0 licence](test/fixtures/LICENSE). That licence covers the fixtures, not the parser source.
