#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseGuide } from "../dist/index.js";

try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: pvme-guide-parse [guide.txt|-]");
  const source = readFileSync(
    !args[0] || args[0] === "-" ? 0 : args[0],
    "utf8",
  );
  process.stdout.write(JSON.stringify(parseGuide(source)) + "\n");
} catch (error) {
  console.error(
    `pvme-guide-parse: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
