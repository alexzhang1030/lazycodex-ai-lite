#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

//#region src/executor.ts
const ignoredRuntimeDirectoryNames = /* @__PURE__ */ new Set([".git", "node_modules"]);
function parseExecutorArgs(argv) {
	const args = [...argv];
	let command = "help";
	let runtimeRoot;
	let outDir;
	let keepTemp = false;
	const passthrough = [];
	if (args.length === 0) return {
		command,
		runtimeRoot,
		outDir,
		keepTemp,
		passthrough
	};
	const first = args.shift();
	if (first === "materialize" || first === "install" || first === "pack" || first === "help" || first === "version") command = first;
	else if (first === "--help" || first === "-h") command = "help";
	else if (first === "--version" || first === "-v") command = "version";
	else if (first !== void 0) {
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
	return {
		command,
		runtimeRoot,
		outDir,
		keepTemp,
		passthrough
	};
}
async function materializeRuntime(input) {
	const runtimeRoot = await resolveRuntimeRoot(input.runtimeRoot);
	const outDir = resolve(input.outDir);
	await assertRuntimeRoot(runtimeRoot);
	await rm(outDir, {
		recursive: true,
		force: true
	});
	await mkdir(dirname(outDir), { recursive: true });
	await cp(runtimeRoot, outDir, {
		recursive: true,
		filter: (path) => shouldCopyRuntimePath(path, runtimeRoot)
	});
	return outDir;
}
async function resolveRuntimeRoot(explicitRuntimeRoot) {
	const candidates = [
		explicitRuntimeRoot,
		process.env.LAZYCODEX_AI_LITE_RUNTIME,
		join(process.cwd(), "runtime", "package"),
		join(executorDirectory(), "..", "runtime", "package"),
		join(dirname(process.execPath), "..", "runtime", "package"),
		join(dirname(process.execPath), "runtime", "package")
	].filter((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
	for (const candidate of candidates) {
		const resolved = resolve(candidate);
		if (await isDirectory(resolved)) return resolved;
	}
	throw new Error("Unable to locate runtime package. Set LAZYCODEX_AI_LITE_RUNTIME or pass --runtime <path>.");
}
async function runInstall(args) {
	const packageRoot = await materializeRuntime({
		runtimeRoot: args.runtimeRoot,
		outDir: args.outDir ?? resolveDefaultInstallOutDir()
	});
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
	if (result.error !== void 0) throw result.error;
	return result.status ?? 1;
}
function resolveDefaultInstallOutDir(input) {
	return join((input?.env ?? process.env).CODEX_HOME?.trim() || join(input?.homeDir ?? homedir(), ".codex"), "runtime", "lazycodex-ai-lite-package");
}
async function runPack(args) {
	const packageRoot = args.outDir ? await materializeRuntime({
		runtimeRoot: args.runtimeRoot,
		outDir: args.outDir
	}) : await materializeTempRuntime(args.runtimeRoot);
	const result = spawnSync("npm", ["pack", ...args.passthrough.length > 0 ? [...args.passthrough] : []], {
		cwd: packageRoot,
		stdio: "inherit"
	});
	if (result.error !== void 0) throw result.error;
	if (!args.keepTemp && args.outDir === void 0) await rm(packageRoot, {
		recursive: true,
		force: true
	});
	return result.status ?? 1;
}
async function materializeTempRuntime(runtimeRoot) {
	return materializeRuntime({
		runtimeRoot,
		outDir: join(await mkdtemp(join(tmpdir(), "lazycodex-ai-lite-")), "package")
	});
}
async function printVersion(runtimeRoot) {
	const resolvedRuntime = await resolveRuntimeRoot(runtimeRoot);
	const packageJson = JSON.parse(await readFile(join(resolvedRuntime, "package.json"), "utf8"));
	console.log(typeof packageJson.version === "string" ? packageJson.version : "unknown");
}
function resolveNodeCommand() {
	return process.env.LAZYCODEX_AI_LITE_NODE?.trim() || "node";
}
function printHelp() {
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
		"  --out <dir>                   Materialized package directory; install defaults to CODEX_HOME/runtime/lazycodex-ai-lite-package",
		"  --keep-temp                   Keep temporary materialized package"
	].join("\n"));
}
function shouldCopyRuntimePath(path, root) {
	const relative = path === root ? "" : path.slice(root.length + sep.length);
	if (relative.length === 0) return true;
	return !relative.split(sep).some((part) => ignoredRuntimeDirectoryNames.has(part));
}
async function assertRuntimeRoot(runtimeRoot) {
	const required = [
		"package.json",
		"packages/omo-codex/scripts/install-local.mjs",
		"packages/omo-codex/scripts/install-dist/install-local.mjs",
		"packages/omo-codex/plugin/.codex-plugin/plugin.json"
	];
	const missing = [];
	for (const file of required) if (!await isFile(join(runtimeRoot, file))) missing.push(file);
	if (missing.length > 0) throw new Error(`Runtime package is incomplete: ${missing.join(", ")}`);
}
function executorDirectory() {
	return dirname(fileURLToPath(import.meta.url));
}
async function isDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if (error instanceof Error) return false;
		return false;
	}
}
async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (error instanceof Error) return false;
		return false;
	}
}
function readOptionValue(args, index, option) {
	const value = args[index + 1];
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${option} requires a value`);
	return value;
}
function readInlineOptionValue(arg, option) {
	const value = arg.slice(`${option}=`.length);
	if (value.trim().length === 0) throw new Error(`${option} requires a value`);
	return value;
}
async function main() {
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
		if (args.outDir === void 0) throw new Error("materialize requires --out <dir>");
		const outDir = await materializeRuntime({
			runtimeRoot: args.runtimeRoot,
			outDir: args.outDir
		});
		console.log(outDir);
		return 0;
	}
	if (args.command === "pack") return runPack(args);
	return runInstall(args);
}
if (process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((exitCode) => {
	process.exitCode = exitCode;
}).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

//#endregion
export { materializeRuntime, parseExecutorArgs, resolveDefaultInstallOutDir, resolveRuntimeRoot };