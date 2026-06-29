import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import {
  inspectLazyCodexInstall,
  materializeRuntime,
  parseExecutorArgs,
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
    expect(await readFile(join(outDir, "packages/omo-codex/scripts/install-local.mjs"), "utf8")).toContain("installer");
    await expect(readFile(join(outDir, "node_modules/ignored.txt"), "utf8")).rejects.toThrow();
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
    await writeText(join(codexHome, "config.toml"), '[plugins."omo@sisyphuslabs"]\nenabled = true\n');
    await writeText(join(codexHome, "runtime/lazycodex-ai-lite-package/package.json"), "{}\n");
    await writeText(join(binDir, "omo"), "#!/bin/sh\n# LAZYCODEX_AI_LITE_GENERATED_WRAPPER\n");

    const status = await inspectLazyCodexInstall({ codexHome, binDir });
    expect(status.installed).toBe(true);
    expect(status.configEnabled).toBe(true);
    expect(status.runtimePackage).toBe(true);
    expect(status.omoBin).toBe(true);
  });
});

async function createRuntime(runtimeRoot: string): Promise<void> {
  await writeJson(join(runtimeRoot, "package.json"), { name: "lazycodex-ai-lite", version: "1.0.0" });
  await writeText(join(runtimeRoot, "packages/omo-codex/scripts/install-local.mjs"), "console.log('installer');\n");
  await writeText(join(runtimeRoot, "packages/omo-codex/scripts/install-dist/install-local.mjs"), "console.log('generated installer');\n");
  await writeJson(join(runtimeRoot, "packages/omo-codex/plugin/.codex-plugin/plugin.json"), { name: "omo" });
  await writeText(join(runtimeRoot, "node_modules/ignored.txt"), "ignored\n");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value);
}
