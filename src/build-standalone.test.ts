import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildStandalonePackage, parseArgs } from "./build-standalone";

const coreHookPaths = [
  "./hooks/user-prompt-submit-checking-ultrawork-trigger.json",
  "./hooks/user-prompt-submit-checking-ulw-loop-steering.json",
  "./hooks/pre-tool-use-enforcing-unlimited-goal-budget.json"
] as const;

const optionalHookPaths = [
  "./hooks/post-tool-use-checking-thread-title-hygiene.json",
  "./hooks/subagent-stop-verifying-lazycodex-executor-evidence.json"
] as const;

describe("parseArgs", () => {
  test("accepts inline, split, and optional pack options", () => {
    expect(parseArgs([
      "--source=/src",
      "--out",
      "/out",
      "--name",
      "lazycodex-ai-lite",
      "--version=1.2.3",
      "--optional=teammode,lazycodex-executor-verify",
      "--with",
      "ulw-research"
    ])).toEqual({
      sourceRoot: "/src",
      outDir: "/out",
      packageName: "lazycodex-ai-lite",
      version: "1.2.3",
      optionalPacks: ["ulw-research", "teammode", "lazycodex-executor-verify"]
    });
  });

  test("rejects unknown optional packs", () => {
    expect(() => parseArgs(["--optional=unknown-pack"])).toThrow("Unknown optional pack");
  });
});

describe("buildStandalonePackage", () => {
  test("keeps the default multi-agent runtime payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazycodex-lite-test-"));
    const sourceRoot = join(root, "source");
    const outDir = join(root, "out");
    await createFakeSource(sourceRoot);

    await buildStandalonePackage({
      sourceRoot,
      outDir,
      packageName: "lazycodex-ai-lite",
      version: "9.9.9"
    });

    const packageJson = await readJson<Record<string, unknown>>(join(outDir, "package.json"));
    expect(packageJson.name).toBe("lazycodex-ai-lite");
    expect(packageJson.version).toBe("9.9.9");
    expect(packageJson.files).toEqual([
      "packages/lazycodex/plugin",
      "packages/lazycodex/marketplace.json"
    ]);
    expect(packageJson).not.toHaveProperty("bin");

    const marketplace = await readJson<{ readonly plugins: readonly { readonly name: string; readonly source: string }[] }>(join(outDir, "packages/lazycodex/marketplace.json"));
    expect(marketplace.plugins).toEqual([{ name: "lazycodex", source: "./plugins/lazycodex" }]);

    const pluginManifest = await readJson<{ readonly name: string; readonly hooks: readonly string[] }>(join(outDir, "packages/lazycodex/plugin/.codex-plugin/plugin.json"));
    expect(pluginManifest.name).toBe("lazycodex");
    expect(pluginManifest.hooks).toEqual(coreHookPaths);

    const mcpManifest = await readJson<Record<string, unknown>>(join(outDir, "packages/lazycodex/plugin/.mcp.json"));
    expect(mcpManifest).toEqual({ mcpServers: {} });

    const manifest = await readJson<{ readonly strategy: string; readonly features: { readonly optional: readonly string[] } }>(join(outDir, "lazycodex-standalone.json"));
    expect(manifest.strategy).toBe("prebuilt-plugin-payload");
    expect(manifest.features.optional).toEqual([]);

    expect(await listDirNames(join(outDir, "packages/lazycodex/plugin/components"))).toEqual(["bootstrap", "ultrawork", "ulw-loop"]);
    expect(await listDirNames(join(outDir, "packages/lazycodex/plugin/skills"))).toEqual(["review-work", "ulw-loop", "ulw-plan"]);
    expect(await listFileNames(join(outDir, "packages/lazycodex/plugin/hooks"))).toEqual(coreHookPaths.map((hook) => hook.slice("./hooks/".length)).sort());

    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/dist/cli.js"))).toBe(true);
    expect(await readFile(join(outDir, "packages/lazycodex/plugin/components/ultrawork/dist/cli.js"), "utf8")).toContain("lazycodex-ultrawork");
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/directive.md"))).toBe(true);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/agents/explorer.toml"))).toBe(true);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/src/index.ts"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/test/cli.test.ts"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/tsconfig.json"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/scripts/build.test.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/scripts/build.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/.github/workflows/ci.yml"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/README.md"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/LICENSE"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/NOTICE"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/package.json"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ultrawork/skills/ulw-plan/SKILL.md"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ulw-loop/directive.md"))).toBe(true);
    const ulwLoopCli = await readFile(join(outDir, "packages/lazycodex/plugin/components/ulw-loop/dist/cli.js"), "utf8");
    expect(ulwLoopCli).toContain("lazycodex ulw-loop");
    expect(ulwLoopCli).toContain(".lazycodex/ulw-loop");
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/ulw-loop/skills/ulw-loop/SKILL.md"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/bootstrap/scripts/node-dispatch.ps1"))).toBe(true);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/bootstrap/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/bootstrap/scripts/bootstrap.ps1"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/teammode/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/lazycodex-executor-verify/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/skills/ulw-research/SKILL.md"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/scripts/install-local.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/scripts/install-dist/install-local.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/package.json"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/package-lock.json"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/scripts/migrate-lazycodex-sot.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/scripts/migrate-lazycodex-sot/editor.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/scripts/auto-update.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/git-bash-mcp/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/lsp-daemon/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "dist/cli/index.js"))).toBe(false);
    expect(await exists(join(outDir, "dist/cli-node/index.js"))).toBe(false);
  });

  test("keeps selected optional packs", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazycodex-lite-optional-test-"));
    const sourceRoot = join(root, "source");
    const outDir = join(root, "out");
    await createFakeSource(sourceRoot);

    await buildStandalonePackage({
      sourceRoot,
      outDir,
      packageName: "lazycodex-ai-lite",
      version: "9.9.9",
      optionalPacks: ["ulw-research", "teammode", "lazycodex-executor-verify"]
    });

    const pluginManifest = await readJson<{ readonly hooks: readonly string[] }>(join(outDir, "packages/lazycodex/plugin/.codex-plugin/plugin.json"));
    expect(pluginManifest.hooks).toEqual([...coreHookPaths, ...optionalHookPaths]);

    expect(await listDirNames(join(outDir, "packages/lazycodex/plugin/components"))).toEqual([
      "bootstrap",
      "lazycodex-executor-verify",
      "teammode",
      "ultrawork",
      "ulw-loop"
    ]);
    expect(await listDirNames(join(outDir, "packages/lazycodex/plugin/skills"))).toEqual([
      "review-work",
      "teammode",
      "ulw-loop",
      "ulw-plan",
      "ulw-research"
    ]);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/teammode/dist/cli.js"))).toBe(true);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/components/lazycodex-executor-verify/dist/cli.js"))).toBe(true);
    expect(await exists(join(outDir, "packages/lazycodex/plugin/skills/ulw-research/SKILL.md"))).toBe(true);

    const manifest = await readJson<{ readonly features: { readonly optional: readonly string[] } }>(join(outDir, "lazycodex-standalone.json"));
    expect(manifest.features.optional).toEqual(["ulw-research", "teammode", "lazycodex-executor-verify"]);
  });
});

async function createFakeSource(sourceRoot: string): Promise<void> {
  await writeJson(join(sourceRoot, "package.json"), { name: "lazycodex-runtime-source", version: "1.2.3" });
  await writeJson(join(sourceRoot, "marketplace.json"), {
    name: "sisyphuslabs",
    plugins: [{ name: "lazycodex", source: "./plugins/lazycodex" }]
  });
  await writeText(join(sourceRoot, "scripts/install-local.mjs"), "#!/usr/bin/env node\n");
  await writeText(
    join(sourceRoot, "scripts/install-dist/install-local.mjs"),
    [
      'var PACKAGED_CODEX_INSTALLER_NAMES = new Set([',
      '  "lazycodex-ai",',
      '  "lazycodex-ai-lite"',
      ']);',
      'function ensureLazyCodexBuiltinMcpPolicies(config, input) {',
      '  let nextConfig = config;',
      '  nextConfig = ensurePluginMcpEnabled(nextConfig, "lazycodex@sisyphuslabs", "context7", true);',
      '  return nextConfig;',
      '}',
      'function ensureHookTrusted(config, state) {',
      '  return config;',
      '}',
      ''
    ].join("\n")
  );
  await writeJson(join(sourceRoot, "plugin/.codex-plugin/plugin.json"), {
    name: "lazycodex",
    version: "1.2.3",
    hooks: [
      "./hooks/session-start-loading-project-rules.json",
      ...coreHookPaths,
      ...optionalHookPaths
    ],
    mcpServers: "./.mcp.json",
    interface: { displayName: "LazyCodex" }
  });
  await writeJson(join(sourceRoot, "plugin/package.json"), {
    name: "@sisyphuslabs/lazycodex-plugin",
    version: "1.2.3",
    type: "module",
    workspaces: ["components/ultrawork"],
    scripts: { build: "node build.js", "sync:skills": "node scripts/sync-skills.mjs" },
    dependencies: { "@oh-my-opencode/shared-skills": "file:../../shared-skills" }
  });
  await writeJson(join(sourceRoot, "plugin/package-lock.json"), {
    name: "@sisyphuslabs/lazycodex-plugin",
    lockfileVersion: 3,
    packages: {}
  });
  await writeJson(join(sourceRoot, "plugin/.mcp.json"), {
    mcpServers: {
      git_bash: { command: "node", args: ["../../git-bash-mcp/dist/cli.js", "mcp"] },
      lsp: { command: "node", args: ["../../lsp-daemon/dist/cli.js", "mcp"] }
    }
  });

  await writeText(join(sourceRoot, "plugin/scripts/auto-update.mjs"), "export {};\n");
  await writeText(join(sourceRoot, "plugin/scripts/migrate-lazycodex-sot.mjs"), "import \"./migrate-lazycodex-sot/editor.mjs\";\n");
  await writeText(join(sourceRoot, "plugin/scripts/migrate-lazycodex-sot/editor.mjs"), "export {};\n");
  await writeText(join(sourceRoot, "plugin/shared/src/index.ts"), "export {};\n");
  await writeJson(join(sourceRoot, "plugin/model-catalog.json"), { models: [] });

  const allHookFiles = [
    "session-start-loading-project-rules.json",
    ...coreHookPaths.map((hook) => hook.slice("./hooks/".length)),
    ...optionalHookPaths.map((hook) => hook.slice("./hooks/".length))
  ];
  for (const hook of allHookFiles) {
    await writeText(join(sourceRoot, "plugin/hooks", hook), "{}\n");
  }

  for (const component of ["bootstrap", "ultrawork", "ulw-loop", "teammode", "lazycodex-executor-verify", "lsp"]) {
    await writeComponent(sourceRoot, component);
  }
  await writeText(join(sourceRoot, "plugin/components/ultrawork/agents/explorer.toml"), 'name = "explorer"\n');

  for (const skill of ["ulw-plan", "ulw-loop", "review-work", "ulw-research", "teammode", "ast-grep", "rules"]) {
    await writeText(join(sourceRoot, "plugin/skills", skill, "SKILL.md"), `---\nname: ${skill}\n---\n`);
  }
  await writeText(join(sourceRoot, "plugin/skills/ulw-plan/tests/sample.txt"), "test fixture\n");
}

async function writeComponent(sourceRoot: string, component: string): Promise<void> {
  const componentRoot = join(sourceRoot, "plugin/components", component);
  await writeJson(join(componentRoot, "package.json"), { name: component, version: "1.2.3" });
  const cliSource = component === "ulw-loop"
    ? "console.log('lazycodex ulw-loop'); console.log('[lazycodex] unknown command'); console.log('.lazycodex/ulw-loop');\n"
    : component === "ultrawork"
      ? "console.log('lazycodex-ultrawork hook user-prompt-submit');\n"
      : `console.log('${component}');\n`;
  await writeText(join(componentRoot, "dist/cli.js"), cliSource);
  await writeText(join(componentRoot, "dist/cli.d.ts"), "export {};\n");
  await writeText(join(componentRoot, "README.md"), `${component}\n`);
  await writeText(join(componentRoot, "LICENSE"), "MIT\n");
  await writeText(join(componentRoot, "NOTICE"), "notice\n");
  await writeText(join(componentRoot, "directive.md"), `# ${component} directive\n`);
  await writeText(join(componentRoot, "src/index.ts"), "export {};\n");
  await writeText(join(componentRoot, "test/cli.test.ts"), "export {};\n");
  await writeText(join(componentRoot, "scripts/bootstrap.ps1"), "Write-Output component\n");
  await writeText(join(componentRoot, "scripts/node-dispatch.ps1"), "node $args\n");
  await writeText(join(componentRoot, "scripts/build.test.mjs"), "export {};\n");
  await writeText(join(componentRoot, "scripts/build.mjs"), "export {};\n");
  await writeText(join(componentRoot, "skills/ulw-plan/SKILL.md"), "---\nname: ulw-plan\n---\n");
  await writeText(join(componentRoot, "skills/ulw-loop/SKILL.md"), "---\nname: ulw-loop\n---\n");
  await writeText(join(componentRoot, ".github/workflows/ci.yml"), "name: ci\n");
  await writeText(join(componentRoot, "tsconfig.json"), "{}\n");
}

async function listDirNames(path: string): Promise<readonly string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function listFileNames(path: string): Promise<readonly string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value);
}
