import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { materializeRuntime, parseExecutorArgs, resolveDefaultInstallOutDir } from "./executor";

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
