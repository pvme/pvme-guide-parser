import { expect, it } from "vitest";
import { parseGuide } from "@pvme/guide-parser";

it("keeps a same-line marker literal while parsing continuation and nested lists", () => {
  const doc = parseGuide("⬥ + **parent**\n    continued\n    + - child\n⬥ next");
  expect(doc.messages[0].blocks).toMatchObject([{
    type: "list", items: [
      { marker: "⬥", children: [
        { type: "paragraph", children: [
          { type: "text", value: "+ " }, { type: "bold" },
          { type: "line-break" }, { type: "text", value: "    continued" },
        ] },
        { type: "list", items: [{ marker: "+", children: [{ type: "paragraph", children: [{ type: "text", value: "- child" }] }] }] },
      ] },
      { marker: "⬥", children: [{ type: "paragraph" }] },
    ],
  }]);
});
