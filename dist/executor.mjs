#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

//#region src/executor.ts
const ignoredRuntimeDirectoryNames = /* @__PURE__ */ new Set([".git", "node_modules"]);
const managedMarketplaceName = "sisyphuslabs";
const managedPluginName = "omo";
const liteWrapperMarker = "LAZYCODEX_AI_LITE_GENERATED_WRAPPER";
const upstreamRuntimeWrapperMarker = "OMO_GENERATED_RUNTIME_WRAPPER";
const managedAgentFallbackNames = [
	"explorer",
	"lazycodex-clone-fidelity-reviewer",
	"lazycodex-code-reviewer",
	"lazycodex-executor",
	"lazycodex-gate-reviewer",
	"lazycodex-qa-executor",
	"librarian",
	"metis",
	"momus",
	"plan"
];
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
	if (first === "materialize" || first === "install" || first === "uninstall" || first === "status" || first === "pack" || first === "help" || first === "version" || first === "ulw-loop" || first === "ultrawork") command = first;
	else if (first === "--help" || first === "-h") command = "help";
	else if (first === "--version" || first === "-v") command = "version";
	else if (first !== void 0 && first.startsWith("-")) {
		command = "install";
		passthrough.push(first);
	} else if (first !== void 0) {
		command = "help";
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
	const status = result.status ?? 1;
	if (status !== 0) return status;
	await installLiteCliEntrypoints({ packageRoot });
	return 0;
}
function resolveDefaultInstallOutDir(input) {
	return join((input?.env ?? process.env).CODEX_HOME?.trim() || join(input?.homeDir ?? homedir(), ".codex"), "runtime", "lazycodex-ai-lite-package");
}
function resolveCodexHome(input) {
	return resolve((input?.env ?? process.env).CODEX_HOME?.trim() || join(input?.homeDir ?? homedir(), ".codex"));
}
function resolveCodexInstallerBinDir(input) {
	const env = input?.env ?? process.env;
	const explicitBinDir = env.CODEX_LOCAL_BIN_DIR?.trim();
	if (explicitBinDir) return resolve(explicitBinDir);
	const homeDir = input?.homeDir ?? homedir();
	const codexHome = resolve(input?.codexHome ?? resolveCodexHome({
		env,
		homeDir
	}));
	return codexHome === resolve(homeDir, ".codex") ? resolve(homeDir, ".local", "bin") : join(codexHome, "bin");
}
async function runUninstall(args) {
	const options = parseUninstallOptions(args.passthrough);
	printUninstallReport(await uninstallLazyCodex({
		codexHome: resolveCodexHome(),
		binDir: resolveCodexInstallerBinDir(),
		dryRun: options.dryRun
	}), options.json);
	return 0;
}
async function runStatus(args) {
	const options = parseStatusOptions(args.passthrough);
	const report = await inspectLazyCodexInstall({
		codexHome: resolveCodexHome(),
		binDir: resolveCodexInstallerBinDir()
	});
	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
		return 0;
	}
	printStatusReport(report);
	return 0;
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
async function runComponentCommand(command, args) {
	const binName = command === "ulw-loop" ? "omo-ulw-loop" : "omo-ultrawork";
	const binPath = join(resolveCodexInstallerBinDir(), binName);
	if (!await isFileSystemEntry(binPath)) throw new Error(`${command} is not installed. Run: omo install`);
	const result = spawnSync(binPath, [...args], {
		cwd: process.cwd(),
		stdio: "inherit",
		env: process.env
	});
	if (result.error !== void 0) throw result.error;
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
		"Usage: omo <command> [options]",
		"",
		"Commands:",
		"  install [installer args]      Install the bundled LazyCodex runtime for Codex",
		"  uninstall [--dry-run]         Remove managed LazyCodex files from CODEX_HOME",
		"  status [--json]               Inspect the local LazyCodex install",
		"  ulw-loop [args]               Run the bundled ulw-loop CLI",
		"  ultrawork [args]              Run the bundled ultrawork CLI",
		"  materialize --out <dir>       Copy the runtime package to a directory",
		"  pack [npm pack args]          Create an npm tarball from the runtime package",
		"  version                      Print the runtime package version",
		"",
		"Options:",
		"  --runtime <dir>               Runtime package directory",
		"  --out <dir>                   Materialized package directory; install defaults to CODEX_HOME/runtime/lazycodex-ai-lite-package",
		"  --keep-temp                   Keep temporary materialized package",
		"",
		"The installed omo wrapper is intentionally limited to LazyCodex runtime commands."
	].join("\n"));
}
async function installLiteCliEntrypoints(input) {
	const packageBinDir = join(input.packageRoot, "bin");
	const packageDistDir = join(input.packageRoot, "dist");
	const packageEntrypoint = join(packageBinDir, "lazycodex-ai-lite.js");
	const packageExecutor = join(packageDistDir, "executor.mjs");
	await mkdir(packageBinDir, { recursive: true });
	await mkdir(packageDistDir, { recursive: true });
	await copyFile(await resolveBuiltExecutorPath(), packageExecutor);
	await writeFile(packageEntrypoint, nodeEntrypointSource());
	await chmod(packageEntrypoint, 493);
	await chmod(packageExecutor, 493);
	const binDir = resolveCodexInstallerBinDir();
	await mkdir(binDir, { recursive: true });
	if (process.platform === "win32") {
		await writeFile(join(binDir, "omo.cmd"), windowsLiteWrapper(packageEntrypoint));
		await writeFile(join(binDir, "lazycodex-ai-lite.cmd"), windowsLiteWrapper(packageEntrypoint));
		return;
	}
	await writeFile(join(binDir, "omo"), posixLiteWrapper(packageEntrypoint));
	await writeFile(join(binDir, "lazycodex-ai-lite"), posixLiteWrapper(packageEntrypoint));
	await chmod(join(binDir, "omo"), 493);
	await chmod(join(binDir, "lazycodex-ai-lite"), 493);
}
async function resolveBuiltExecutorPath() {
	const current = fileURLToPath(import.meta.url);
	const candidates = [
		basename(current) === "executor.mjs" ? current : "",
		join(executorDirectory(), "executor.mjs"),
		join(executorDirectory(), "..", "dist", "executor.mjs"),
		join(process.cwd(), "dist", "executor.mjs")
	].filter((candidate) => candidate.length > 0);
	for (const candidate of candidates) {
		const resolved = resolve(candidate);
		if (await isFile(resolved)) return resolved;
	}
	throw new Error("Unable to locate built executor. Run: bun run build:executor");
}
function nodeEntrypointSource() {
	return [
		"#!/usr/bin/env node",
		`// ${liteWrapperMarker}`,
		"import { spawnSync } from \"node:child_process\";",
		"import { dirname, join } from \"node:path\";",
		"import { fileURLToPath } from \"node:url\";",
		"",
		"const binDir = dirname(fileURLToPath(import.meta.url));",
		"const executorPath = join(binDir, \"..\", \"dist\", \"executor.mjs\");",
		"const result = spawnSync(process.execPath, [executorPath, ...process.argv.slice(2)], { stdio: \"inherit\" });",
		"if (result.error !== undefined) throw result.error;",
		"process.exitCode = result.status ?? 1;",
		""
	].join("\n");
}
function posixLiteWrapper(entrypoint) {
	const escaped = entrypoint.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("$", "\\$").replaceAll("`", "\\`");
	return [
		"#!/bin/sh",
		`# ${liteWrapperMarker}`,
		`exec node "${escaped}" "$@"`,
		""
	].join("\n");
}
function windowsLiteWrapper(entrypoint) {
	return [
		"@echo off",
		`rem ${liteWrapperMarker}`,
		`node "${entrypoint}" %*`,
		""
	].join("\r\n");
}
async function uninstallLazyCodex(input) {
	const codexHome = resolve(input.codexHome);
	const binDir = resolve(input.binDir);
	const dryRun = input.dryRun === true;
	const removed = [];
	const agentPaths = await discoverInstalledAgentPaths(codexHome);
	const agentNames = /* @__PURE__ */ new Set([...managedAgentFallbackNames, ...agentPaths.map((agentPath) => basename(agentPath, ".toml"))]);
	const changedConfig = await removeLazyCodexConfigSections({
		configPath: join(codexHome, "config.toml"),
		agentNames,
		dryRun
	});
	const paths = [
		join(codexHome, "runtime", "lazycodex-ai-lite-package"),
		join(codexHome, "plugins", "cache", managedMarketplaceName),
		join(codexHome, ".tmp", "marketplaces", managedMarketplaceName),
		...agentPaths,
		...managedAgentFallbackNames.map((agentName) => join(codexHome, "agents", `${agentName}.toml`))
	];
	for (const path of unique(paths)) if (await removePathIfExists(path, dryRun)) removed.push(path);
	for (const path of await managedBinPaths(binDir)) if (await removePathIfExists(path, dryRun)) removed.push(path);
	return {
		codexHome,
		binDir,
		dryRun,
		removed: removed.sort(),
		changedConfig
	};
}
async function inspectLazyCodexInstall(input) {
	const codexHome = resolve(input.codexHome);
	const binDir = resolve(input.binDir);
	const config = await readTextIfExists(join(codexHome, "config.toml"));
	const componentBins = [];
	for (const binName of ["omo-ultrawork", "omo-ulw-loop"]) {
		const path = join(binDir, binName);
		if (await isFileSystemEntry(path)) componentBins.push(path);
	}
	const managedAgents = (await discoverInstalledAgentPaths(codexHome)).filter((path, index, paths) => paths.indexOf(path) === index).sort();
	const report = {
		codexHome,
		binDir,
		configEnabled: config?.includes("[plugins.\"omo@sisyphuslabs\"]") ?? false,
		runtimePackage: await isFileSystemEntry(join(codexHome, "runtime", "lazycodex-ai-lite-package")),
		pluginCache: await isFileSystemEntry(join(codexHome, "plugins", "cache", managedMarketplaceName, managedPluginName)),
		marketplaceSnapshot: await isFileSystemEntry(join(codexHome, ".tmp", "marketplaces", managedMarketplaceName)),
		omoBin: await isFileSystemEntry(join(binDir, process.platform === "win32" ? "omo.cmd" : "omo")),
		componentBins,
		managedAgents
	};
	return {
		...report,
		installed: report.configEnabled || report.runtimePackage || report.pluginCache || report.marketplaceSnapshot || report.omoBin || report.componentBins.length > 0 || report.managedAgents.length > 0
	};
}
function removeLazyCodexConfig(config, agentNames) {
	return removeTomlSections(config, (header) => {
		if (header === `marketplaces.${managedMarketplaceName}`) return true;
		if (header === `plugins."${managedPluginName}@${managedMarketplaceName}"`) return true;
		if (header.startsWith(`hooks.state."${managedPluginName}@${managedMarketplaceName}:`)) return true;
		if (header === "features.multi_agent_v2") return true;
		if (!header.startsWith("agents.")) return false;
		return agentNames.has(parseTomlHeaderTail(header.slice(7)));
	}).replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n");
}
async function removeLazyCodexConfigSections(input) {
	const current = await readTextIfExists(input.configPath);
	if (current === null) return false;
	const next = removeLazyCodexConfig(current, input.agentNames);
	if (next === current) return false;
	if (!input.dryRun) await writeFile(input.configPath, next);
	return true;
}
function removeTomlSections(config, shouldRemove) {
	const lines = config.match(/[^\n]*\n?|$/g)?.filter((line) => line.length > 0) ?? [];
	const removeLine = new Array(lines.length).fill(false);
	for (let index = 0; index < lines.length; index += 1) {
		const header = parseTomlHeaderLine(lines[index] ?? "");
		if (header === null || !shouldRemove(header)) continue;
		let start = index;
		if (header === "features.multi_agent_v2") start = includeLeadingLazyCodexComments(lines, start);
		let end = index + 1;
		while (end < lines.length && parseTomlHeaderLine(lines[end] ?? "") === null) end += 1;
		for (let removeIndex = start; removeIndex < end; removeIndex += 1) removeLine[removeIndex] = true;
	}
	return lines.filter((_line, index) => !removeLine[index]).join("");
}
function parseTomlHeaderLine(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
	return trimmed.replace(/^\[+/, "").replace(/\]+$/, "");
}
function parseTomlHeaderTail(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}
function includeLeadingLazyCodexComments(lines, start) {
	let cursor = start - 1;
	let candidate = start;
	let sawLazyCodexComment = false;
	while (cursor >= 0) {
		const trimmed = (lines[cursor] ?? "").trim();
		if (trimmed === "") {
			candidate = cursor;
			cursor -= 1;
			continue;
		}
		if (trimmed.startsWith("#")) {
			candidate = cursor;
			if (trimmed.includes("LazyCodex")) sawLazyCodexComment = true;
			cursor -= 1;
			continue;
		}
		break;
	}
	return sawLazyCodexComment ? candidate : start;
}
async function discoverInstalledAgentPaths(codexHome) {
	const manifests = [join(codexHome, ".tmp", "marketplaces", managedMarketplaceName, "plugins", managedPluginName, ".installed-agents.json"), ...await findFiles(join(codexHome, "plugins", "cache", managedMarketplaceName, managedPluginName), ".installed-agents.json", 3)];
	const paths = [];
	for (const manifest of manifests) {
		const content = await readTextIfExists(manifest);
		if (content === null) continue;
		try {
			const parsed = JSON.parse(content);
			if (!Array.isArray(parsed.agents)) continue;
			for (const agentPath of parsed.agents) if (typeof agentPath === "string" && agentPath.startsWith(codexHome)) paths.push(agentPath);
		} catch {
			continue;
		}
	}
	return unique(paths);
}
async function findFiles(root, fileName, maxDepth) {
	if (maxDepth < 0 || !await isDirectory(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const paths = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isFile() && entry.name === fileName) paths.push(path);
		if (entry.isDirectory()) paths.push(...await findFiles(path, fileName, maxDepth - 1));
	}
	return paths;
}
async function managedBinPaths(binDir) {
	const names = process.platform === "win32" ? [
		"omo.cmd",
		"lazycodex-ai-lite.cmd",
		"omo-ultrawork.cmd",
		"omo-ulw-loop.cmd"
	] : [
		"omo",
		"lazycodex-ai-lite",
		"omo-ultrawork",
		"omo-ulw-loop"
	];
	const paths = [];
	for (const name of names) {
		const path = join(binDir, name);
		if (await isManagedBinPath(path)) paths.push(path);
	}
	return paths;
}
async function isManagedBinPath(path) {
	const entry = await lstatIfExists(path);
	if (entry === null) return false;
	if (entry.isSymbolicLink()) {
		const target = await readlink(path).catch(() => "");
		return target.includes(`${sep}plugins${sep}cache${sep}${managedMarketplaceName}${sep}`) || target.includes("/plugins/cache/sisyphuslabs/");
	}
	if (!entry.isFile()) return false;
	const content = await readTextIfExists(path);
	return content?.includes(liteWrapperMarker) === true || content?.includes(upstreamRuntimeWrapperMarker) === true;
}
async function removePathIfExists(path, dryRun) {
	if (!await isFileSystemEntry(path)) return false;
	if (!dryRun) await rm(path, {
		recursive: true,
		force: true
	});
	return true;
}
function parseUninstallOptions(args) {
	let dryRun = false;
	let json = false;
	for (const arg of args) {
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		throw new Error(`Unsupported uninstall option: ${arg}`);
	}
	return {
		dryRun,
		json
	};
}
function parseStatusOptions(args) {
	let json = false;
	for (const arg of args) {
		if (arg === "--json") {
			json = true;
			continue;
		}
		throw new Error(`Unsupported status option: ${arg}`);
	}
	return { json };
}
function printUninstallReport(report, json) {
	if (json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	const action = report.dryRun ? "Would remove" : "Removed";
	console.log(`${action} ${report.removed.length} LazyCodex artifact(s).`);
	if (report.changedConfig) console.log(report.dryRun ? "Would update Codex config." : "Updated Codex config.");
	for (const path of report.removed) console.log(`- ${path}`);
}
function printStatusReport(report) {
	console.log(report.installed ? "LazyCodex is installed." : "LazyCodex is not installed.");
	console.log(`CODEX_HOME: ${report.codexHome}`);
	console.log(`bin dir: ${report.binDir}`);
	console.log(`config enabled: ${String(report.configEnabled)}`);
	console.log(`runtime package: ${String(report.runtimePackage)}`);
	console.log(`plugin cache: ${String(report.pluginCache)}`);
	console.log(`marketplace snapshot: ${String(report.marketplaceSnapshot)}`);
	console.log(`omo bin: ${String(report.omoBin)}`);
	console.log(`component bins: ${report.componentBins.length}`);
	console.log(`managed agents: ${report.managedAgents.length}`);
}
function unique(values) {
	return [...new Set(values)];
}
async function readTextIfExists(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) return null;
		throw error;
	}
}
async function lstatIfExists(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) return null;
		throw error;
	}
}
async function isFileSystemEntry(path) {
	return await lstatIfExists(path) !== null;
}
function isNodeErrorWithCode(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
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
	if (args.command === "uninstall") return runUninstall(args);
	if (args.command === "status") return runStatus(args);
	if (args.command === "ulw-loop" || args.command === "ultrawork") return runComponentCommand(args.command, args.passthrough);
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
export { inspectLazyCodexInstall, materializeRuntime, parseExecutorArgs, removeLazyCodexConfig, resolveCodexHome, resolveCodexInstallerBinDir, resolveDefaultInstallOutDir, resolveRuntimeRoot, uninstallLazyCodex };