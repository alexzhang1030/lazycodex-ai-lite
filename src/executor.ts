#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type ExecutorCommand = "materialize" | "install" | "pack" | "help" | "version";

export interface ExecutorArgs {
  readonly command: ExecutorCommand;
  readonly runtimeRoot?: string;
  readonly outDir?: string;
  readonly keepTemp: boolean;
  readonly passthrough: readonly string[];
}

const ignoredRuntimeDirectoryNames = new Set([".git", "node_modules"]);

export function parseExecutorArgs(argv: readonly string[]): ExecutorArgs {
  const args = [...argv];
  let command: ExecutorCommand = "help";
  let runtimeRoot: string | undefined;
  let outDir: string | undefined;
  let keepTemp = false;
  const passthrough: string[] = [];

  if (args.length === 0) return { command, runtimeRoot, outDir, keepTemp, passthrough };
  const first = args.shift();
  if (first === "materialize" || first === "install" || first === "pack" || first === "help" || first === "version") {
    command = first;
  } else if (first === "--help" || first === "-h") {
    command = "help";
  } else if (first === "--version" || first === "-v") {
    command = "version";
  } else if (first !== undefined) {
    command = "install";
    passthrough.push(first);
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      passthrough.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--runtime") {
      runtimeRoot = readOptionValue(args, index, "--runtime");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--runtime=")) {
      runtimeRoot = readInlineOptionValue(arg, "--runtime");
      continue;
    }
    if (arg === "--out") {
      outDir = readOptionValue(args, index, "--out");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--out=")) {
      outDir = readInlineOptionValue(arg, "--out");
      continue;
    }
    if (arg === "--keep-temp") {
      keepTemp = true;
      continue;
    }
    passthrough.push(arg);
  }

  return { command, runtimeRoot, outDir, keepTemp, passthrough };
}

export async function materializeRuntime(input: { readonly runtimeRoot?: string; readonly outDir: string }): Promise<string> {
  const runtimeRoot = await resolveRuntimeRoot(input.runtimeRoot);
  const outDir = resolve(input.outDir);
  await assertRuntimeRoot(runtimeRoot);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(dirname(outDir), { recursive: true });
  await cp(runtimeRoot, outDir, {
    recursive: true,
    filter: (path) => shouldCopyRuntimePath(path, runtimeRoot)
  });
  return outDir;
}

export async function resolveRuntimeRoot(explicitRuntimeRoot?: string): Promise<string> {
  const candidates = [
    explicitRuntimeRoot,
    process.env.LAZYCODEX_AI_LITE_RUNTIME,
    join(process.cwd(), "runtime", "package"),
    join(executorDirectory(), "..", "runtime", "package"),
    join(dirname(process.execPath), "..", "runtime", "package"),
    join(dirname(process.execPath), "runtime", "package")
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (await isDirectory(resolved)) return resolved;
  }

  throw new Error("Unable to locate runtime package. Set LAZYCODEX_AI_LITE_RUNTIME or pass --runtime <path>.");
}

async function runInstall(args: ExecutorArgs): Promise<number> {
  const packageRoot = args.outDir
    ? await materializeRuntime({ runtimeRoot: args.runtimeRoot, outDir: args.outDir })
    : await materializeTempRuntime(args.runtimeRoot);
  const installerPath = join(packageRoot, "packages", "omo-codex", "scripts", "install-local.mjs");
  const installArgs = args.passthrough.length > 0 ? [...args.passthrough] : ["install"];
  const result = spawnSync(resolveNodeCommand(), [installerPath, ...installArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      OMO_WRAPPER_PACKAGE_ROOT: packageRoot
    }
  });
  if (result.error !== undefined) throw result.error;
  if (!args.keepTemp && args.outDir === undefined) await rm(packageRoot, { recursive: true, force: true });
  return result.status ?? 1;
}

async function runPack(args: ExecutorArgs): Promise<number> {
  const packageRoot = args.outDir
    ? await materializeRuntime({ runtimeRoot: args.runtimeRoot, outDir: args.outDir })
    : await materializeTempRuntime(args.runtimeRoot);
  const packArgs = args.passthrough.length > 0 ? [...args.passthrough] : [];
  const result = spawnSync("npm", ["pack", ...packArgs], { cwd: packageRoot, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (!args.keepTemp && args.outDir === undefined) await rm(packageRoot, { recursive: true, force: true });
  return result.status ?? 1;
}

async function materializeTempRuntime(runtimeRoot?: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "lazycodex-ai-lite-"));
  return materializeRuntime({ runtimeRoot, outDir: join(tempRoot, "package") });
}

async function printVersion(runtimeRoot?: string): Promise<void> {
  const resolvedRuntime = await resolveRuntimeRoot(runtimeRoot);
  const packageJson = JSON.parse(await readFile(join(resolvedRuntime, "package.json"), "utf8")) as { readonly version?: unknown };
  console.log(typeof packageJson.version === "string" ? packageJson.version : "unknown");
}

function resolveNodeCommand(): string {
  return process.env.LAZYCODEX_AI_LITE_NODE?.trim() || "node";
}

function printHelp(): void {
  console.log([
    "Usage: lazycodex-ai-lite <command> [options] [-- passthrough]",
    "",
    "Commands:",
    "  materialize --out <dir>       Copy runtime package to a directory",
    "  install [installer args]      Run the bundled LazyCodex installer",
    "  pack [npm pack args]          Create an npm tarball from the runtime package",
    "  version                      Print runtime package version",
    "",
    "Options:",
    "  --runtime <dir>               Runtime package directory",
    "  --out <dir>                   Materialized package directory",
    "  --keep-temp                   Keep temporary materialized package"
  ].join("\n"));
}

function shouldCopyRuntimePath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length);
  if (relative.length === 0) return true;
  return !relative.split(sep).some((part) => ignoredRuntimeDirectoryNames.has(part));
}

async function assertRuntimeRoot(runtimeRoot: string): Promise<void> {
  const required = [
    "package.json",
    "packages/omo-codex/scripts/install-local.mjs",
    "packages/omo-codex/scripts/install-dist/install-local.mjs",
    "packages/omo-codex/plugin/.codex-plugin/plugin.json"
  ];
  const missing: string[] = [];
  for (const file of required) {
    if (!await isFile(join(runtimeRoot, file))) missing.push(file);
  }
  if (missing.length > 0) throw new Error(`Runtime package is incomplete: ${missing.join(", ")}`);
}

function executorDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error) return false;
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error) return false;
    return false;
  }
}

function readOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${option} requires a value`);
  return value;
}

function readInlineOptionValue(arg: string, option: string): string {
  const value = arg.slice(`${option}=`.length);
  if (value.trim().length === 0) throw new Error(`${option} requires a value`);
  return value;
}

async function main(): Promise<number> {
  const args = parseExecutorArgs(process.argv.slice(2));
  if (args.command === "help") {
    printHelp();
    return 0;
  }
  if (args.command === "version") {
    await printVersion(args.runtimeRoot);
    return 0;
  }
  if (args.command === "materialize") {
    if (args.outDir === undefined) throw new Error("materialize requires --out <dir>");
    const outDir = await materializeRuntime({ runtimeRoot: args.runtimeRoot, outDir: args.outDir });
    console.log(outDir);
    return 0;
  }
  if (args.command === "pack") return runPack(args);
  return runInstall(args);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
