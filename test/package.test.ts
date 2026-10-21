import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGuide } from "@pvme/guide-parser";

const cli = fileURLToPath(new URL("../module/bin/parse.js", import.meta.url));
const run = (args: string[], input?: string) => spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8" });

it("parses stdin and files through the CLI", () => {
  const input = ".embed:json";
  const stdin = run(["-"], input);
  expect(stdin.status).toBe(0);
  expect(JSON.parse(stdin.stdout)).toEqual(parseGuide(input));
  expect(stdin.stderr).toBe("");

  const fixture = fileURLToPath(new URL("./fixtures/biting.txt", import.meta.url));
  const file = run([fixture]);
  expect(file.status).toBe(0);
  expect(JSON.parse(file.stdout)).toEqual(parseGuide(readFileSync(fixture, "utf8")));
});

it.each([
  [["missing-guide.txt"], "missing-guide.txt"],
  [["one", "two"], "Usage:"],
])("reports CLI errors for %j", (args, message) => {
  const result = run(args);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(message);
});
