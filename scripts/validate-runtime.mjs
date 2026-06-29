#!/usr/bin/env node
import { access, readFile, readdir } from "node:fs/promises";

const runtimeRoot = new URL("../runtime/package/", import.meta.url);

const expectedComponents = ["bootstrap", "ultrawork", "ulw-loop"];
const expectedSkills = ["review-work", "ulw-loop", "ulw-plan"];
const expectedHooks = [
  "pre-tool-use-enforcing-unlimited-goal-budget.json",
  "user-prompt-submit-checking-ultrawork-trigger.json",
  "user-prompt-submit-checking-ulw-loop-steering.json"
];

const requiredFiles = [
  "package.json",
  "packages/omo-codex/marketplace.json",
  "packages/omo-codex/plugin/.codex-plugin/plugin.json",
  "packages/omo-codex/plugin/.mcp.json",
  "packages/omo-codex/plugin/components/bootstrap/scripts/node-dispatch.ps1",
  "packages/omo-codex/plugin/components/ultrawork/dist/cli.js",
  "packages/omo-codex/plugin/components/ultrawork/directive.md",
  "packages/omo-codex/plugin/components/ulw-loop/dist/cli.js",
  "packages/omo-codex/plugin/components/ulw-loop/directive.md",
  "packages/omo-codex/plugin/skills/review-work/SKILL.md",
  "packages/omo-codex/plugin/skills/ulw-plan/SKILL.md",
  "packages/omo-codex/plugin/skills/ulw-loop/SKILL.md"
];

const forbiddenFiles = [
  "packages/omo-codex/scripts/install-local.mjs",
  "packages/omo-codex/scripts/install-dist/install-local.mjs",
  "packages/omo-codex/plugin/package.json",
  "packages/omo-codex/plugin/package-lock.json",
  "packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs",
  "packages/omo-codex/plugin/components/bootstrap/dist/cli.js",
  "packages/omo-codex/plugin/components/bootstrap/scripts/bootstrap.ps1",
  "packages/omo-codex/plugin/components/ultrawork/README.md",
  "packages/omo-codex/plugin/components/ultrawork/LICENSE",
  "packages/omo-codex/plugin/components/ultrawork/NOTICE",
  "packages/omo-codex/plugin/components/ultrawork/package.json",
  "packages/omo-codex/plugin/components/ultrawork/skills/ulw-plan/SKILL.md",
  "packages/omo-codex/plugin/components/ulw-loop/README.md",
  "packages/omo-codex/plugin/components/ulw-loop/LICENSE",
  "packages/omo-codex/plugin/components/ulw-loop/NOTICE",
  "packages/omo-codex/plugin/components/ulw-loop/package.json",
  "packages/omo-codex/plugin/components/ulw-loop/skills/ulw-loop/SKILL.md"
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listNames(path) {
  return (await readdir(path, { withFileTypes: true })).map((entry) => entry.name).sort();
}

function assertEqual(actual, expected, label) {
  const actualText = JSON.stringify([...actual].sort());
  const expectedText = JSON.stringify([...expected].sort());
  if (actualText !== expectedText) {
    throw new Error(`${label} mismatch: expected ${expectedText}, got ${actualText}`);
  }
}

const missing = [];
for (const file of requiredFiles) {
  if (!(await exists(new URL(file, runtimeRoot)))) missing.push(file);
}
if (missing.length > 0) throw new Error(`Runtime is incomplete: ${missing.join(", ")}`);

const forbidden = [];
for (const file of forbiddenFiles) {
  if (await exists(new URL(file, runtimeRoot))) forbidden.push(file);
}
if (forbidden.length > 0) throw new Error(`Runtime contains trimmed files: ${forbidden.join(", ")}`);

assertEqual(await listNames(new URL("packages/omo-codex/plugin/components/", runtimeRoot)), expectedComponents, "components");
assertEqual(await listNames(new URL("packages/omo-codex/plugin/skills/", runtimeRoot)), expectedSkills, "skills");
assertEqual(await listNames(new URL("packages/omo-codex/plugin/hooks/", runtimeRoot)), expectedHooks, "hooks");

const mcp = JSON.parse(await readFile(new URL("packages/omo-codex/plugin/.mcp.json", runtimeRoot), "utf8"));
if (JSON.stringify(mcp) !== JSON.stringify({ mcpServers: {} })) {
  throw new Error(`Unexpected MCP manifest: ${JSON.stringify(mcp)}`);
}

console.log("Runtime payload validated.");
