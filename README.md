# PVME guide parser

Turns PVME guide text into structured data that a website, guide editor or Discord bot can use.

## How it works

1. Read the original guide text from `pvme-guides`.
2. Call `parseGuide(text)` to identify headings, paragraphs, lists, formatting and guide commands.
3. Use the result to display the guide, edit it or send it through a bot.

The result also includes tags, references and diagnostics (warnings and errors). Each content node keeps its original text and source position so an editor can point back to the right place.

The app using the parser decides how to render content, resolve references and publish messages. A line containing only `.` separates source messages; a bot can split them further when sending to Discord.

```js
import { parseGuide } from '@pvme/guide-parser';

const guide = parseGuide('# My guide\n⬥ **Bring food**\n⬥ Equip your weapon');

console.log(guide.messages[0].blocks); // Heading and list, with inline formatting
console.log(guide.diagnostics);       // Warnings and errors
```

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
