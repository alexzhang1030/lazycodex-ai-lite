import { describe, expect, test } from "bun:test";
import { mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import {
  installLazyCodex,
  inspectLazyCodexInstall,
  materializeRuntime,
  parseExecutorArgs,
  parseInstallOptions,
  removeLazyCodexConfig,
  resolveCodexInstallerBinDir,
  resolveDefaultInstallOutDir,
  uninstallLazyCodex
} from "./executor";

describe("parseExecutorArgs", () => {
  test("parses materialize options", () => {
    expect(parseExecutorArgs(["materialize", "--runtime", "/runtime", "--out=/out"])).toEqual({
      command: "materialize",
      runtimeRoot: "/runtime",
      outDir: "/out",
      keepTemp: false,
      passthrough: []
    });
  });

  test("treats unknown first argument as install passthrough", () => {
    expect(parseExecutorArgs(["--dry-run", "install", "--no-tui"])).toEqual({
      command: "install",
      runtimeRoot: undefined,
      outDir: undefined,
      keepTemp: false,
      passthrough: ["--dry-run", "install", "--no-tui"]
    });
  });

  test("parses pack passthrough after separator", () => {
    expect(parseExecutorArgs(["pack", "--", "--pack-destination", "/tmp/out"])).toEqual({
      command: "pack",
      runtimeRoot: undefined,
      outDir: undefined,
      keepTemp: false,
      passthrough: ["--pack-destination", "/tmp/out"]
    });
  });

  test("parses uninstall and status commands", () => {
    expect(parseExecutorArgs(["uninstall", "--dry-run", "--json"])).toEqual({
      command: "uninstall",
      runtimeRoot: undefined,
      outDir: undefined,
      keepTemp: false,
      passthrough: ["--dry-run", "--json"]
    });
    expect(parseExecutorArgs(["status", "--json"])).toEqual({
      command: "status",
      runtimeRoot: undefined,
      outDir: undefined,
      keepTemp: false,
      passthrough: ["--json"]
    });
  });

  test("parses LazyCodex component commands", () => {
    expect(parseExecutorArgs(["ulw-loop", "--help"])).toEqual({
      command: "ulw-loop",
      runtimeRoot: undefined,
      outDir: undefined,
      keepTemp: false,
      passthrough: ["--help"]
    });
  });
});

describe("parseInstallOptions", () => {
  test("accepts the installer-compatible Codex flags", () => {
    expect(parseInstallOptions(["install", "--no-tui", "--platform=codex", "--codex-autonomous"])).toEqual({
      dryRun: false,
      autonomousPermissions: true
    });
    expect(parseInstallOptions(["setup", "--skip-auth", "--platform", "codex", "--no-codex-autonomous", "--dry-run"])).toEqual({
      dryRun: true,
      autonomousPermissions: false
    });
  });

  test("rejects unsupported platforms", () => {
    expect(() => parseInstallOptions(["--platform=opencode"])).toThrow("Unsupported platform");
  });
});

describe("resolveDefaultInstallOutDir", () => {
  test("uses CODEX_HOME when present", () => {
    expect(resolveDefaultInstallOutDir({ env: { CODEX_HOME: "/tmp/codex-home" }, homeDir: "/home/user" })).toBe(
      "/tmp/codex-home/runtime/lazycodex-ai-lite-package"
    );
  });

  test("falls back to home .codex", () => {
    expect(resolveDefaultInstallOutDir({ env: {}, homeDir: "/home/user" })).toBe(
      "/home/user/.codex/runtime/lazycodex-ai-lite-package"
    );
  });
});

describe("resolveCodexInstallerBinDir", () => {
  test("uses local bin for the default Codex home", () => {
    expect(resolveCodexInstallerBinDir({ env: {}, codexHome: "/home/user/.codex", homeDir: "/home/user" })).toBe(
      "/home/user/.local/bin"
    );
  });

  test("uses CODEX_HOME/bin for custom Codex homes", () => {
    expect(resolveCodexInstallerBinDir({ env: {}, codexHome: "/tmp/codex-home", homeDir: "/home/user" })).toBe(
      "/tmp/codex-home/bin"
    );
  });

  test("honors CODEX_LOCAL_BIN_DIR", () => {
    expect(
      resolveCodexInstallerBinDir({
        env: { CODEX_LOCAL_BIN_DIR: "/tmp/bin" },
        codexHome: "/home/user/.codex",
        homeDir: "/home/user"
      })
    ).toBe("/tmp/bin");
  });
});

describe("removeLazyCodexConfig", () => {
  test("removes managed marketplace, plugin, hooks, agent blocks, and migration block", () => {
    const config = [
      'model = "gpt-5"',
      "",
      "[marketplaces.openai-bundled]",
      'source = "keep"',
      "",
      "# Managed by LazyCodex: multi_agent_v2 is re-disabled on every Codex session start",
      "# Opt out: LAZYCODEX_CONFIG_MIGRATION_DISABLED=1",
      "[features.multi_agent_v2]",
      "enabled = false",
      "",
      "[marketplaces.sisyphuslabs]",
      'source = "/tmp/cache"',
      "",
      '[plugins."omo@sisyphuslabs"]',
      "enabled = true",
      "",
      '[hooks.state."omo@sisyphuslabs:hooks/a.json:user_prompt_submit:0:0"]',
      'trusted_hash = "sha256:abc"',
      "",
      "[agents.plan]",
      'config_file = "./agents/plan.toml"',
      "",
      "[agents.keep]",
      'config_file = "./agents/keep.toml"',
      ""
    ].join("\n");

    const next = removeLazyCodexConfig(config, new Set(["plan"]));
    expect(next).toContain("[marketplaces.openai-bundled]");
    expect(next).toContain("[agents.keep]");
    expect(next).not.toContain("sisyphuslabs");
    expect(next).not.toContain("[agents.plan]");
    expect(next).not.toContain("Managed by LazyCodex");
    expect(next).not.toContain("[features.multi_agent_v2]");
  });
});

describe("materializeRuntime", () => {
  test("copies required runtime files and skips node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazycodex-executor-test-"));
    const runtimeRoot = join(root, "runtime");
    const outDir = join(root, "out");
    await createRuntime(runtimeRoot);

    await materializeRuntime({ runtimeRoot, outDir });

    expect(await readFile(join(outDir, "package.json"), "utf8")).toContain("lazycodex-ai-lite");
    expect(await readFile(join(outDir, "packages/lazycodex/plugin/.codex-plugin/plugin.json"), "utf8")).toContain("lazycodex");
    await expect(readFile(join(outDir, "node_modules/ignored.txt"), "utf8")).rejects.toThrow();
  });
});

describe("installLazyCodex", () => {
  test("installs the lite runtime without the upstream bundled installer", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazycodex-install-test-"));
    const packageRoot = join(root, "runtime");
    const codexHome = join(root, ".codex");
    const binDir = join(root, "bin");
    const executorPath = join(root, "fake-executor.mjs");
    await createRuntime(packageRoot);
    await writeText(executorPath, "console.log('executor');\n");

    const report = await installLazyCodex({
      packageRoot,
      codexHome,
      binDir,
      executorPath,
      autonomousPermissions: true
    });

    const pluginRoot = join(codexHome, "plugins/cache/sisyphuslabs/lazycodex/1.0.0");
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(report.pluginRoot).toBe(pluginRoot);
    expect(report.installedAgents).toEqual([join(codexHome, "agents", "plan.toml")]);
    expect(await readFile(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).toContain("lazycodex");
    expect(await readFile(join(codexHome, ".tmp/marketplaces/sisyphuslabs/plugins/lazycodex/.codex-plugin/plugin.json"), "utf8")).toContain("lazycodex");
    expect(await readFile(join(codexHome, "plugins/cache/sisyphuslabs/.agents/plugins/marketplace.json"), "utf8")).toContain("./lazycodex/1.0.0");
    expect(config).toContain('approval_policy = "never"');
    expect(config).toContain('sandbox_mode = "danger-full-access"');
    expect(config).toContain("[features]");
    expect(config).toContain('[plugins."lazycodex@sisyphuslabs"]');
    expect(config).toContain('[hooks.state."lazycodex@sisyphuslabs:hooks/user-prompt-submit.json:user_prompt_submit:0:0"]');
    expect(config).toContain("trusted_hash = \"sha256:");
    expect(config).toContain("[agents.plan]");
    expect(await readFile(join(codexHome, "agents/plan.toml"), "utf8")).toContain('name = "plan"');
    expect(await readFile(join(packageRoot, "dist/executor.mjs"), "utf8")).toContain("executor");
    expect(await readFile(join(packageRoot, "bin/lazycodex-ai-lite.js"), "utf8")).toContain("LAZYCODEX_AI_LITE_GENERATED_WRAPPER");
    expect(await readFile(join(binDir, "lazycodex"), "utf8")).toContain("LAZYCODEX_AI_LITE_GENERATED_WRAPPER");
    expect(await readFile(join(binDir, "lazycodex-ai-lite"), "utf8")).toContain("LAZYCODEX_AI_LITE_GENERATED_WRAPPER");
    if (process.platform === "win32") {
      expect(await readFile(join(binDir, "lazycodex-ulw-loop.cmd"), "utf8")).toContain("components\\ulw-loop\\dist\\cli.js");
      expect(await readFile(join(binDir, "lazycodex-ultrawork.cmd"), "utf8")).toContain("components\\ultrawork\\dist\\cli.js");
    } else {
      expect(await readlink(join(binDir, "lazycodex-ulw-loop"))).toContain("components/ulw-loop/dist/cli.js");
      expect(await readlink(join(binDir, "lazycodex-ultrawork"))).toContain("components/ultrawork/dist/cli.js");
    }
    await expect(readFile(join(packageRoot, "packages/lazycodex/scripts/install-dist/install-local.mjs"), "utf8")).rejects.toThrow();
  });
});

describe("uninstallLazyCodex", () => {
  test("removes managed files and config sections", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazycodex-uninstall-test-"));
    const codexHome = join(root, ".codex");
    const binDir = join(root, "bin");
    await writeText(
      join(codexHome, "config.toml"),
      [
        "[marketplaces.sisyphuslabs]",
        'source = "/tmp/cache"',
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
        "",
        "[agents.plan]",
        'config_file = "./agents/plan.toml"',
        ""
      ].join("\n")
    );
    await writeJson(join(codexHome, ".tmp/marketplaces/sisyphuslabs/plugins/omo/.installed-agents.json"), {
      agents: [join(codexHome, "agents", "plan.toml")]
    });
    await writeText(join(codexHome, "agents/plan.toml"), 'name = "plan"\n');
    await writeText(join(codexHome, "runtime/lazycodex-ai-lite-package/package.json"), "{}\n");
    await writeText(join(codexHome, "plugins/cache/sisyphuslabs/omo/4.14.0/package.json"), "{}\n");
    await writeText(join(binDir, "omo"), "#!/bin/sh\n# LAZYCODEX_AI_LITE_GENERATED_WRAPPER\n");
    await writeText(join(binDir, "omo-ulw-loop"), "#!/bin/sh\n# OMO_GENERATED_RUNTIME_WRAPPER\n");

    const report = await uninstallLazyCodex({ codexHome, binDir });
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(report.changedConfig).toBe(true);
    expect(config).not.toContain("sisyphuslabs");
    await expect(readFile(join(codexHome, "agents/plan.toml"), "utf8")).rejects.toThrow();
    await expect(readFile(join(codexHome, "runtime/lazycodex-ai-lite-package/package.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(binDir, "omo"), "utf8")).rejects.toThrow();
  });

  test("reports install status", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazycodex-status-test-"));
    const codexHome = join(root, ".codex");
    const binDir = join(root, "bin");
    await writeText(join(codexHome, "config.toml"), '[plugins."lazycodex@sisyphuslabs"]\nenabled = true\n');
    await writeText(join(codexHome, "runtime/lazycodex-ai-lite-package/package.json"), "{}\n");
    await writeText(join(binDir, "lazycodex"), "#!/bin/sh\n# LAZYCODEX_AI_LITE_GENERATED_WRAPPER\n");

    const status = await inspectLazyCodexInstall({ codexHome, binDir });
    expect(status.installed).toBe(true);
    expect(status.configEnabled).toBe(true);
    expect(status.runtimePackage).toBe(true);
    expect(status.lazycodexBin).toBe(true);
  });
});

async function createRuntime(runtimeRoot: string): Promise<void> {
  await writeJson(join(runtimeRoot, "package.json"), { name: "lazycodex-ai-lite", version: "1.0.0" });
  await writeJson(join(runtimeRoot, "packages/lazycodex/marketplace.json"), { name: "sisyphuslabs", plugins: [{ name: "lazycodex" }] });
  await writeJson(join(runtimeRoot, "packages/lazycodex/plugin/.codex-plugin/plugin.json"), {
    name: "lazycodex",
    hooks: ["./hooks/user-prompt-submit.json"]
  });
  await writeJson(join(runtimeRoot, "packages/lazycodex/plugin/.mcp.json"), { mcpServers: {} });
  await writeJson(join(runtimeRoot, "packages/lazycodex/plugin/hooks/user-prompt-submit.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: 'node "${PLUGIN_ROOT}/components/ultrawork/dist/cli.js" hook user-prompt-submit',
              timeout: 5,
              statusMessage: "(OmO) Checking Ultrawork Trigger"
            }
          ]
        }
      ]
    }
  });
  await writeText(join(runtimeRoot, "packages/lazycodex/plugin/components/ultrawork/dist/cli.js"), "console.log('ultrawork');\n");
  await writeText(join(runtimeRoot, "packages/lazycodex/plugin/components/ultrawork/agents/plan.toml"), 'name = "plan"\n');
  await writeText(join(runtimeRoot, "packages/lazycodex/plugin/components/ulw-loop/dist/cli.js"), "console.log('ulw-loop');\n");
  await writeText(join(runtimeRoot, "packages/lazycodex/plugin/components/bootstrap/scripts/node-dispatch.ps1"), "node $args\n");
  await writeText(join(runtimeRoot, "node_modules/ignored.txt"), "ignored\n");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value);
}
