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
  "packages/lazycodex/marketplace.json",
  "packages/lazycodex/plugin/.codex-plugin/plugin.json",
  "packages/lazycodex/plugin/.mcp.json",
  "packages/lazycodex/plugin/components/bootstrap/scripts/node-dispatch.ps1",
  "packages/lazycodex/plugin/components/ultrawork/dist/cli.js",
  "packages/lazycodex/plugin/components/ultrawork/directive.md",
  "packages/lazycodex/plugin/components/ulw-loop/dist/cli.js",
  "packages/lazycodex/plugin/components/ulw-loop/directive.md",
  "packages/lazycodex/plugin/skills/review-work/SKILL.md",
  "packages/lazycodex/plugin/skills/ulw-plan/SKILL.md",
  "packages/lazycodex/plugin/skills/ulw-loop/SKILL.md"
];

const forbiddenFiles = [
  "packages/lazycodex/scripts/install-local.mjs",
  "packages/lazycodex/scripts/install-dist/install-local.mjs",
  "packages/lazycodex/plugin/package.json",
  "packages/lazycodex/plugin/package-lock.json",
  "packages/lazycodex/plugin/scripts/migrate-omo-sot.mjs",
  "packages/lazycodex/plugin/components/bootstrap/dist/cli.js",
  "packages/lazycodex/plugin/components/bootstrap/scripts/bootstrap.ps1",
  "packages/lazycodex/plugin/components/ultrawork/README.md",
  "packages/lazycodex/plugin/components/ultrawork/LICENSE",
  "packages/lazycodex/plugin/components/ultrawork/NOTICE",
  "packages/lazycodex/plugin/components/ultrawork/package.json",
  "packages/lazycodex/plugin/components/ultrawork/skills/ulw-plan/SKILL.md",
  "packages/lazycodex/plugin/components/ulw-loop/README.md",
  "packages/lazycodex/plugin/components/ulw-loop/LICENSE",
  "packages/lazycodex/plugin/components/ulw-loop/NOTICE",
  "packages/lazycodex/plugin/components/ulw-loop/package.json",
  "packages/lazycodex/plugin/components/ulw-loop/skills/ulw-loop/SKILL.md"
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

assertEqual(await listNames(new URL("packages/lazycodex/plugin/components/", runtimeRoot)), expectedComponents, "components");
assertEqual(await listNames(new URL("packages/lazycodex/plugin/skills/", runtimeRoot)), expectedSkills, "skills");
assertEqual(await listNames(new URL("packages/lazycodex/plugin/hooks/", runtimeRoot)), expectedHooks, "hooks");

const mcp = JSON.parse(await readFile(new URL("packages/lazycodex/plugin/.mcp.json", runtimeRoot), "utf8"));
if (JSON.stringify(mcp) !== JSON.stringify({ mcpServers: {} })) {
  throw new Error(`Unexpected MCP manifest: ${JSON.stringify(mcp)}`);
}

const marketplace = JSON.parse(await readFile(new URL("packages/lazycodex/marketplace.json", runtimeRoot), "utf8"));
if (JSON.stringify(marketplace.plugins) !== JSON.stringify([{ name: "lazycodex", source: "./plugins/lazycodex" }])) {
  throw new Error(`Unexpected marketplace plugins: ${JSON.stringify(marketplace.plugins)}`);
}

const plugin = JSON.parse(await readFile(new URL("packages/lazycodex/plugin/.codex-plugin/plugin.json", runtimeRoot), "utf8"));
if (plugin.name !== "lazycodex") {
  throw new Error(`Unexpected plugin name: ${JSON.stringify(plugin.name)}`);
}
if (plugin.interface?.displayName !== "LazyCodex") {
  throw new Error(`Unexpected plugin display name: ${JSON.stringify(plugin.interface?.displayName)}`);
}

console.log("Runtime payload validated.");
