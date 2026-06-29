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
      "dist/cli",
      "dist/cli-node",
      "packages/omo-codex/scripts/install-local.mjs",
      "packages/omo-codex/scripts/install-dist",
      "packages/omo-codex/plugin",
      "packages/omo-codex/marketplace.json"
    ]);

    const pluginPackage = await readJson<Record<string, unknown>>(join(outDir, "packages/omo-codex/plugin/package.json"));
    expect(pluginPackage.workspaces).toEqual([]);
    expect(pluginPackage.dependencies).toEqual({});
    expect(pluginPackage.scripts).toEqual({});

    const pluginManifest = await readJson<{ readonly hooks: readonly string[] }>(join(outDir, "packages/omo-codex/plugin/.codex-plugin/plugin.json"));
    expect(pluginManifest.hooks).toEqual(coreHookPaths);

    const mcpManifest = await readJson<Record<string, unknown>>(join(outDir, "packages/omo-codex/plugin/.mcp.json"));
    expect(mcpManifest).toEqual({ mcpServers: {} });

    const lockfile = await readJson<Record<string, unknown>>(join(outDir, "packages/omo-codex/plugin/package-lock.json"));
    expect(lockfile.lockfileVersion).toBe(3);

    const installer = await readFile(join(outDir, "packages/omo-codex/scripts/install-dist/install-local.mjs"), "utf8");
    expect(installer).toContain('"lazycodex-ai-lite"');
    expect(installer).toContain("removeTomlSections(nextConfig");
    expect(installer.includes('ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "context7"')).toBe(false);

    const manifest = await readJson<{ readonly strategy: string; readonly features: { readonly optional: readonly string[] } }>(join(outDir, "lazycodex-standalone.json"));
    expect(manifest.strategy).toBe("prebuilt-plugin-payload");
    expect(manifest.features.optional).toEqual([]);

    expect(await listDirNames(join(outDir, "packages/omo-codex/plugin/components"))).toEqual(["bootstrap", "ultrawork", "ulw-loop"]);
    expect(await listDirNames(join(outDir, "packages/omo-codex/plugin/skills"))).toEqual(["review-work", "ulw-loop", "ulw-plan"]);
    expect(await listFileNames(join(outDir, "packages/omo-codex/plugin/hooks"))).toEqual(coreHookPaths.map((hook) => hook.slice("./hooks/".length)).sort());

    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/dist/cli.js"))).toBe(true);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/agents/explorer.toml"))).toBe(true);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/src/index.ts"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/test/cli.test.ts"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/tsconfig.json"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/scripts/build.test.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/scripts/build.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/ultrawork/.github/workflows/ci.yml"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/teammode/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/lazycodex-executor-verify/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/skills/ulw-research/SKILL.md"))).toBe(false);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs"))).toBe(true);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/scripts/migrate-omo-sot/editor.mjs"))).toBe(true);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/scripts/auto-update.mjs"))).toBe(false);
    expect(await exists(join(outDir, "packages/git-bash-mcp/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "packages/lsp-daemon/dist/cli.js"))).toBe(false);
    expect(await exists(join(outDir, "dist/cli/index.d.ts"))).toBe(false);
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

    const pluginManifest = await readJson<{ readonly hooks: readonly string[] }>(join(outDir, "packages/omo-codex/plugin/.codex-plugin/plugin.json"));
    expect(pluginManifest.hooks).toEqual([...coreHookPaths, ...optionalHookPaths]);

    expect(await listDirNames(join(outDir, "packages/omo-codex/plugin/components"))).toEqual([
      "bootstrap",
      "lazycodex-executor-verify",
      "teammode",
      "ultrawork",
      "ulw-loop"
    ]);
    expect(await listDirNames(join(outDir, "packages/omo-codex/plugin/skills"))).toEqual([
      "review-work",
      "teammode",
      "ulw-loop",
      "ulw-plan",
      "ulw-research"
    ]);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/teammode/dist/cli.js"))).toBe(true);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/components/lazycodex-executor-verify/dist/cli.js"))).toBe(true);
    expect(await exists(join(outDir, "packages/omo-codex/plugin/skills/ulw-research/SKILL.md"))).toBe(true);

    const manifest = await readJson<{ readonly features: { readonly optional: readonly string[] } }>(join(outDir, "lazycodex-standalone.json"));
    expect(manifest.features.optional).toEqual(["ulw-research", "teammode", "lazycodex-executor-verify"]);
  });
});

async function createFakeSource(sourceRoot: string): Promise<void> {
  await writeJson(join(sourceRoot, "package.json"), { name: "oh-my-openagent", version: "1.2.3" });
  await writeText(join(sourceRoot, "dist/cli/index.js"), "console.log('omo cli');\n");
  await writeText(join(sourceRoot, "dist/cli/index.d.ts"), "export {};\n");
  await writeText(join(sourceRoot, "dist/cli-node/index.js"), "console.log('omo node cli');\n");
  await writeJson(join(sourceRoot, "packages/omo-codex/marketplace.json"), {
    name: "sisyphuslabs",
    plugins: [{ name: "omo", source: "./plugins/omo" }]
  });
  await writeText(join(sourceRoot, "packages/omo-codex/scripts/install-local.mjs"), "#!/usr/bin/env node\n");
  await writeText(
    join(sourceRoot, "packages/omo-codex/scripts/install-dist/install-local.mjs"),
    [
      'var PACKAGED_CODEX_INSTALLER_NAMES = new Set([',
      '  "lazycodex-ai",',
      '  "oh-my-openagent"',
      ']);',
      'function ensureOmoBuiltinMcpPolicies(config, input) {',
      '  let nextConfig = config;',
      '  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "context7", true);',
      '  return nextConfig;',
      '}',
      'function ensureHookTrusted(config, state) {',
      '  return config;',
      '}',
      ''
    ].join("\n")
  );
  await writeJson(join(sourceRoot, "packages/omo-codex/plugin/.codex-plugin/plugin.json"), {
    name: "omo",
    version: "1.2.3",
    hooks: [
      "./hooks/session-start-loading-project-rules.json",
      ...coreHookPaths,
      ...optionalHookPaths
    ],
    mcpServers: "./.mcp.json",
    interface: { displayName: "OMO" }
  });
  await writeJson(join(sourceRoot, "packages/omo-codex/plugin/package.json"), {
    name: "@sisyphuslabs/omo-codex-plugin",
    version: "1.2.3",
    type: "module",
    workspaces: ["components/ultrawork"],
    scripts: { build: "node build.js", "sync:skills": "node scripts/sync-skills.mjs" },
    dependencies: { "@oh-my-opencode/shared-skills": "file:../../shared-skills" }
  });
  await writeJson(join(sourceRoot, "packages/omo-codex/plugin/package-lock.json"), {
    name: "@sisyphuslabs/omo-codex-plugin",
    lockfileVersion: 3,
    packages: {}
  });
  await writeJson(join(sourceRoot, "packages/omo-codex/plugin/.mcp.json"), {
    mcpServers: {
      git_bash: { command: "node", args: ["../../git-bash-mcp/dist/cli.js", "mcp"] },
      lsp: { command: "node", args: ["../../lsp-daemon/dist/cli.js", "mcp"] }
    }
  });

  await writeText(join(sourceRoot, "packages/omo-codex/plugin/scripts/auto-update.mjs"), "export {};\n");
  await writeText(join(sourceRoot, "packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs"), "import \"./migrate-omo-sot/editor.mjs\";\n");
  await writeText(join(sourceRoot, "packages/omo-codex/plugin/scripts/migrate-omo-sot/editor.mjs"), "export {};\n");
  await writeText(join(sourceRoot, "packages/omo-codex/plugin/shared/src/index.ts"), "export {};\n");
  await writeJson(join(sourceRoot, "packages/omo-codex/plugin/model-catalog.json"), { models: [] });

  const allHookFiles = [
    "session-start-loading-project-rules.json",
    ...coreHookPaths.map((hook) => hook.slice("./hooks/".length)),
    ...optionalHookPaths.map((hook) => hook.slice("./hooks/".length))
  ];
  for (const hook of allHookFiles) {
    await writeText(join(sourceRoot, "packages/omo-codex/plugin/hooks", hook), "{}\n");
  }

  for (const component of ["bootstrap", "ultrawork", "ulw-loop", "teammode", "lazycodex-executor-verify", "lsp"]) {
    await writeComponent(sourceRoot, component);
  }
  await writeText(join(sourceRoot, "packages/omo-codex/plugin/components/ultrawork/agents/explorer.toml"), 'name = "explorer"\n');

  for (const skill of ["ulw-plan", "ulw-loop", "review-work", "ulw-research", "teammode", "ast-grep", "rules"]) {
    await writeText(join(sourceRoot, "packages/omo-codex/plugin/skills", skill, "SKILL.md"), `---\nname: ${skill}\n---\n`);
  }
  await writeText(join(sourceRoot, "packages/omo-codex/plugin/skills/ulw-plan/tests/sample.txt"), "test fixture\n");
}

async function writeComponent(sourceRoot: string, component: string): Promise<void> {
  const componentRoot = join(sourceRoot, "packages/omo-codex/plugin/components", component);
  await writeJson(join(componentRoot, "package.json"), { name: component, version: "1.2.3" });
  await writeText(join(componentRoot, "dist/cli.js"), `console.log('${component}');\n`);
  await writeText(join(componentRoot, "dist/cli.d.ts"), "export {};\n");
  await writeText(join(componentRoot, "src/index.ts"), "export {};\n");
  await writeText(join(componentRoot, "test/cli.test.ts"), "export {};\n");
  await writeText(join(componentRoot, "scripts/bootstrap.ps1"), "Write-Output component\n");
  await writeText(join(componentRoot, "scripts/build.test.mjs"), "export {};\n");
  await writeText(join(componentRoot, "scripts/build.mjs"), "export {};\n");
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
