#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

//#region src/executor.ts
const ignoredRuntimeDirectoryNames = /* @__PURE__ */ new Set([".git", "node_modules"]);
const managedMarketplaceName = "sisyphuslabs";
const managedPluginName = "lazycodex";
const userCliName = "lazycodex";
const liteWrapperMarker = "LAZYCODEX_AI_LITE_GENERATED_WRAPPER";
const componentWrapperMarker = "LAZYCODEX_COMPONENT_RUNTIME_WRAPPER";
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
	const options = parseInstallOptions(args.passthrough);
	if (options.dryRun) {
		console.log(`Would install LazyCodex from ${packageRoot}`);
		return 0;
	}
	const report = await installLazyCodex({
		packageRoot,
		codexHome: resolveCodexHome(),
		binDir: resolveCodexInstallerBinDir(),
		autoPermissions: options.autoPermissions
	});
	console.log(`Installed 1 plugin from ${report.marketplaceName}.`);
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
	const binName = command === "ulw-loop" ? "lazycodex-ulw-loop" : "lazycodex-ultrawork";
	const binPath = join(resolveCodexInstallerBinDir(), binName);
	if (!await isFileSystemEntry(binPath)) throw new Error(`${command} is not installed. Run: ${userCliName} install`);
	const result = spawnSync(binPath, command === "ulw-loop" ? ["ulw-loop", ...args] : [...args], {
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
function printHelp() {
	console.log([
		`Usage: ${userCliName} <command> [options]`,
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
		"The installed lazycodex wrapper is intentionally limited to LazyCodex runtime commands."
	].join("\n"));
}
async function installLiteCliEntrypoints(input) {
	const packageBinDir = join(input.packageRoot, "bin");
	const packageDistDir = join(input.packageRoot, "dist");
	const packageEntrypoint = join(packageBinDir, "lazycodex-ai-lite.js");
	const packageExecutor = join(packageDistDir, "executor.mjs");
	await mkdir(packageBinDir, { recursive: true });
	await mkdir(packageDistDir, { recursive: true });
	await copyFile(input.executorPath ?? await resolveBuiltExecutorPath(), packageExecutor);
	await writeFile(packageEntrypoint, nodeEntrypointSource());
	await chmod(packageEntrypoint, 493);
	await chmod(packageExecutor, 493);
	const binDir = resolve(input.binDir ?? resolveCodexInstallerBinDir());
	await mkdir(binDir, { recursive: true });
	if (process.platform === "win32") {
		await writeFile(join(binDir, "lazycodex.cmd"), windowsLiteWrapper(packageEntrypoint));
		await writeFile(join(binDir, "lazycodex-ai-lite.cmd"), windowsLiteWrapper(packageEntrypoint));
		return;
	}
	await writeFile(join(binDir, "lazycodex"), posixLiteWrapper(packageEntrypoint));
	await writeFile(join(binDir, "lazycodex-ai-lite"), posixLiteWrapper(packageEntrypoint));
	await chmod(join(binDir, "lazycodex"), 493);
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
function parseInstallOptions(args) {
	let dryRun = false;
	let autoPermissions = true;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "install" || arg === "setup" || arg === "--no-tui" || arg === "--skip-auth") continue;
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--codex-auto") {
			autoPermissions = true;
			continue;
		}
		if (arg === "--no-codex-auto") {
			autoPermissions = false;
			continue;
		}
		if (arg === "--platform") {
			const value = readOptionValue(args, index, "--platform");
			if (value !== "codex") throw new Error(`Unsupported platform for LazyCodex Lite: ${value}`);
			index += 1;
			continue;
		}
		if (arg?.startsWith("--platform=")) {
			const value = readInlineOptionValue(arg, "--platform");
			if (value !== "codex") throw new Error(`Unsupported platform for LazyCodex Lite: ${value}`);
			continue;
		}
		throw new Error(`Unsupported install option: ${String(arg)}`);
	}
	return {
		dryRun,
		autoPermissions
	};
}
async function installLazyCodex(input) {
	const packageRoot = resolve(input.packageRoot);
	const codexHome = resolve(input.codexHome);
	const binDir = resolve(input.binDir);
	await assertRuntimeRoot(packageRoot);
	const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	const version = typeof packageJson.version === "string" && packageJson.version.trim().length > 0 ? packageJson.version.trim() : "0.0.0";
	const marketplacePath = join(packageRoot, "packages", "lazycodex", "marketplace.json");
	const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
	const sourcePluginRoot = join(packageRoot, "packages", "lazycodex", "plugin");
	const pluginRoot = join(codexHome, "plugins", "cache", managedMarketplaceName, managedPluginName, version);
	const snapshotRoot = join(codexHome, ".tmp", "marketplaces", managedMarketplaceName);
	const snapshotPluginRoot = join(snapshotRoot, "plugins", managedPluginName);
	const agentNames = /* @__PURE__ */ new Set([...managedAgentFallbackNames, ...await discoverBundledAgentNames(sourcePluginRoot)]);
	const configPath = join(codexHome, "config.toml");
	await rm(pluginRoot, {
		recursive: true,
		force: true
	});
	await rm(snapshotRoot, {
		recursive: true,
		force: true
	});
	await mkdir(dirname(pluginRoot), { recursive: true });
	await cp(sourcePluginRoot, pluginRoot, { recursive: true });
	await cp(sourcePluginRoot, snapshotPluginRoot, { recursive: true });
	await writeJsonFile(join(codexHome, "plugins", "cache", managedMarketplaceName, ".agents", "plugins", "marketplace.json"), {
		name: managedMarketplaceName,
		plugins: [{
			name: managedPluginName,
			source: {
				source: "local",
				path: `./${managedPluginName}/${version}`
			}
		}]
	});
	await writeJsonFile(join(snapshotRoot, ".agents", "plugins", "marketplace.json"), marketplace);
	const installedAgents = await installBundledAgents({
		pluginRoot,
		codexHome
	});
	await writeInstalledAgentsManifest(pluginRoot, installedAgents);
	await writeInstalledAgentsManifest(snapshotPluginRoot, installedAgents);
	const componentBins = await installComponentBins({
		pluginRoot,
		binDir
	});
	await installLiteCliEntrypoints({
		packageRoot,
		binDir,
		executorPath: input.executorPath
	});
	const beforeConfig = await readTextIfExists(configPath) ?? "";
	let config = removeLazyCodexConfig(beforeConfig, agentNames);
	config = applyCodexInstallConfig({
		config,
		codexHome,
		agentPaths: installedAgents,
		hookTrustStates: await computeHookTrustStates(pluginRoot),
		autoPermissions: input.autoPermissions !== false
	});
	const changedConfig = config !== beforeConfig;
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(configPath, config);
	return {
		codexHome,
		binDir,
		marketplaceName: managedMarketplaceName,
		pluginName: managedPluginName,
		version,
		pluginRoot,
		installedAgents,
		componentBins,
		changedConfig
	};
}
async function discoverBundledAgentNames(pluginRoot) {
	return (await discoverBundledAgentFiles(pluginRoot)).map((path) => basename(path, ".toml"));
}
async function discoverBundledAgentFiles(pluginRoot) {
	const componentsRoot = join(pluginRoot, "components");
	if (!await isDirectory(componentsRoot)) return [];
	const components = await readdir(componentsRoot, { withFileTypes: true });
	const agentFiles = [];
	for (const component of components) {
		if (!component.isDirectory()) continue;
		const agentsRoot = join(componentsRoot, component.name, "agents");
		if (!await isDirectory(agentsRoot)) continue;
		const agents = await readdir(agentsRoot, { withFileTypes: true });
		for (const agent of agents) if (agent.isFile() && agent.name.endsWith(".toml")) agentFiles.push(join(agentsRoot, agent.name));
	}
	return agentFiles.sort();
}
async function installBundledAgents(input) {
	const agentFiles = await discoverBundledAgentFiles(input.pluginRoot);
	const targetRoot = join(input.codexHome, "agents");
	await mkdir(targetRoot, { recursive: true });
	const installed = [];
	for (const agentFile of agentFiles) {
		const target = join(targetRoot, basename(agentFile));
		await copyFile(agentFile, target);
		installed.push(target);
	}
	return unique(installed).sort();
}
async function writeInstalledAgentsManifest(pluginRoot, agents) {
	await writeJsonFile(join(pluginRoot, ".installed-agents.json"), { agents: [...agents].sort() });
}
async function installComponentBins(input) {
	const entries = [{
		binName: "lazycodex-ultrawork",
		cli: join(input.pluginRoot, "components", "ultrawork", "dist", "cli.js")
	}, {
		binName: "lazycodex-ulw-loop",
		cli: join(input.pluginRoot, "components", "ulw-loop", "dist", "cli.js")
	}];
	await mkdir(input.binDir, { recursive: true });
	const installed = [];
	for (const entry of entries) {
		if (!await isFile(entry.cli)) continue;
		await chmod(entry.cli, 493);
		if (process.platform === "win32") {
			const target = join(input.binDir, `${entry.binName}.cmd`);
			await rm(target, { force: true });
			await writeFile(target, windowsComponentWrapper(entry.cli));
			installed.push(target);
			continue;
		}
		const target = join(input.binDir, entry.binName);
		await rm(target, { force: true });
		await symlink(entry.cli, target);
		installed.push(target);
	}
	return installed;
}
function windowsComponentWrapper(entrypoint) {
	return [
		"@echo off",
		`rem ${componentWrapperMarker}`,
		`node "${entrypoint}" %*`,
		""
	].join("\r\n");
}
function applyCodexInstallConfig(input) {
	let config = input.config;
	if (input.autoPermissions) {
		config = ensureRootTomlSetting(config, "approval_policy", tomlString("never"));
		config = ensureRootTomlSetting(config, "sandbox_mode", tomlString("danger-full-access"));
		config = ensureRootTomlSetting(config, "network_access", tomlString("enabled"));
	}
	config = ensureTomlSetting(config, "features", "plugins", "true");
	config = ensureTomlSetting(config, "features", "plugin_hooks", "true");
	config = ensureTomlSetting(config, "features", "multi_agent", "true");
	config = ensureTomlSetting(config, "features", "child_agents_md", "true");
	config = ensureTomlSetting(config, "features", "unified_exec", "true");
	config = ensureTomlSetting(config, "features", "goals", "true");
	config = ensureTomlSetting(config, "agents", "max_threads", "1000");
	config = ensureTomlSetting(config, `marketplaces.${managedMarketplaceName}`, "source_type", tomlString("local"));
	config = ensureTomlSetting(config, `marketplaces.${managedMarketplaceName}`, "source", tomlString(join(input.codexHome, "plugins", "cache", managedMarketplaceName)));
	config = ensureTomlSetting(config, `marketplaces.${managedMarketplaceName}`, "last_updated", tomlString((/* @__PURE__ */ new Date()).toISOString()));
	config = ensureTomlSetting(config, `plugins."${managedPluginName}@${managedMarketplaceName}"`, "enabled", "true");
	for (const state of input.hookTrustStates) config = ensureTomlSetting(config, `hooks.state.${JSON.stringify(state.key)}`, "trusted_hash", tomlString(state.trustedHash));
	for (const agentPath of input.agentPaths) {
		const agentName = basename(agentPath, ".toml");
		config = ensureTomlSetting(config, `agents.${agentName}`, "config_file", tomlString(`./agents/${basename(agentPath)}`));
	}
	return ensureTrailingNewline(config.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n"));
}
async function computeHookTrustStates(pluginRoot) {
	const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const hookPaths = Array.isArray(manifest.hooks) ? manifest.hooks.filter((hook) => typeof hook === "string") : [];
	const states = [];
	for (const hookPath of hookPaths) {
		const normalizedHookPath = normalizePluginRelativePath(hookPath);
		const hookConfig = JSON.parse(await readFile(join(pluginRoot, normalizedHookPath), "utf8"));
		if (!isRecord(hookConfig.hooks)) continue;
		for (const [eventName, groupsValue] of Object.entries(hookConfig.hooks)) {
			if (!Array.isArray(groupsValue)) continue;
			groupsValue.forEach((groupValue, groupIndex) => {
				if (!isRecord(groupValue) || !Array.isArray(groupValue.hooks)) return;
				groupValue.hooks.forEach((handlerValue, handlerIndex) => {
					if (!isRecord(handlerValue)) return;
					if (handlerValue.async === true || handlerValue.type !== "command" || typeof handlerValue.command !== "string" || handlerValue.command.trim().length === 0) return;
					const eventLabel = codexHookEventLabel(eventName);
					const timeout = Math.max(Number(handlerValue.timeout ?? 600), 1);
					const normalizedHandler = {
						type: "command",
						command: handlerValue.command,
						timeout,
						async: false
					};
					if (typeof handlerValue.statusMessage === "string") normalizedHandler.statusMessage = handlerValue.statusMessage;
					const identity = {
						event_name: eventLabel,
						hooks: [normalizedHandler]
					};
					if (typeof groupValue.matcher === "string") identity.matcher = groupValue.matcher;
					const canonical = JSON.stringify(canonicalJson(identity));
					states.push({
						key: `${managedPluginName}@${managedMarketplaceName}:${normalizedHookPath}:${eventLabel}:${groupIndex}:${handlerIndex}`,
						trustedHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`
					});
				});
			});
		}
	}
	return states.sort((left, right) => left.key.localeCompare(right.key));
}
function normalizePluginRelativePath(path) {
	return path.replace(/^\.?[\\/]+/, "").replaceAll("\\", "/");
}
function codexHookEventLabel(eventName) {
	return {
		PreToolUse: "pre_tool_use",
		PermissionRequest: "permission_request",
		PostToolUse: "post_tool_use",
		PreCompact: "pre_compact",
		PostCompact: "post_compact",
		SessionStart: "session_start",
		UserPromptSubmit: "user_prompt_submit",
		SubagentStart: "subagent_start",
		SubagentStop: "subagent_stop",
		Stop: "stop"
	}[eventName] ?? eventName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
function canonicalJson(value) {
	if (Array.isArray(value)) return value.map((item) => canonicalJson(item));
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}
function ensureRootTomlSetting(config, key, value) {
	const lines = splitTomlLines(config);
	const firstSection = lines.findIndex((line) => parseTomlHeaderLine(line) !== null);
	const end = firstSection === -1 ? lines.length : firstSection;
	const keyPattern = tomlSettingPattern(key);
	for (let index = 0; index < end; index += 1) if (keyPattern.test(lines[index] ?? "")) {
		lines[index] = `${key} = ${value}\n`;
		return lines.join("");
	}
	lines.splice(end, 0, `${key} = ${value}\n`);
	return lines.join("");
}
function ensureTomlSetting(config, header, key, value) {
	const lines = splitTomlLines(config);
	const section = findTomlSection(lines, header);
	if (section === null) return appendTomlBlock(config, header, [`${key} = ${value}`]);
	const keyPattern = tomlSettingPattern(key);
	for (let index = section.start + 1; index < section.end; index += 1) if (keyPattern.test(lines[index] ?? "")) {
		lines[index] = `${key} = ${value}\n`;
		return lines.join("");
	}
	lines.splice(section.end, 0, `${key} = ${value}\n`);
	return lines.join("");
}
function findTomlSection(lines, header) {
	for (let index = 0; index < lines.length; index += 1) {
		if (parseTomlHeaderLine(lines[index] ?? "") !== header) continue;
		let end = index + 1;
		while (end < lines.length && parseTomlHeaderLine(lines[end] ?? "") === null) end += 1;
		return {
			start: index,
			end
		};
	}
	return null;
}
function appendTomlBlock(config, header, lines) {
	const base = config.trimEnd();
	return `${base.length > 0 ? `${base}\n\n` : ""}[${header}]\n${lines.join("\n")}\n`;
}
function splitTomlLines(config) {
	return config.match(/[^\n]*\n?|$/g)?.filter((line) => line.length > 0) ?? [];
}
function tomlSettingPattern(key) {
	return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function tomlString(value) {
	return JSON.stringify(value);
}
function ensureTrailingNewline(value) {
	return value.endsWith("\n") ? value : `${value}\n`;
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
	for (const binName of ["lazycodex-ultrawork", "lazycodex-ulw-loop"]) {
		const path = join(binDir, binName);
		if (await isFileSystemEntry(path)) componentBins.push(path);
	}
	const managedAgents = (await discoverInstalledAgentPaths(codexHome)).filter((path, index, paths) => paths.indexOf(path) === index).sort();
	const report = {
		codexHome,
		binDir,
		configEnabled: config?.includes(`[plugins."${managedPluginName}@${managedMarketplaceName}"]`) ?? false,
		runtimePackage: await isFileSystemEntry(join(codexHome, "runtime", "lazycodex-ai-lite-package")),
		pluginCache: await isFileSystemEntry(join(codexHome, "plugins", "cache", managedMarketplaceName, managedPluginName)),
		marketplaceSnapshot: await isFileSystemEntry(join(codexHome, ".tmp", "marketplaces", managedMarketplaceName)),
		lazycodexBin: await isFileSystemEntry(join(binDir, process.platform === "win32" ? "lazycodex.cmd" : "lazycodex")),
		componentBins,
		managedAgents
	};
	return {
		...report,
		installed: report.configEnabled || report.runtimePackage || report.pluginCache || report.marketplaceSnapshot || report.lazycodexBin || report.componentBins.length > 0 || report.managedAgents.length > 0
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
		"lazycodex.cmd",
		"lazycodex-ai-lite.cmd",
		"lazycodex-ultrawork.cmd",
		"lazycodex-ulw-loop.cmd"
	] : [
		"lazycodex",
		"lazycodex-ai-lite",
		"lazycodex-ultrawork",
		"lazycodex-ulw-loop"
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
	return content?.includes(liteWrapperMarker) === true || content?.includes(componentWrapperMarker) === true;
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
	console.log(`lazycodex bin: ${String(report.lazycodexBin)}`);
	console.log(`component bins: ${report.componentBins.length}`);
	console.log(`managed agents: ${report.managedAgents.length}`);
}
function unique(values) {
	return [...new Set(values)];
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readTextIfExists(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) return null;
		throw error;
	}
}
async function writeJsonFile(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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
		"packages/lazycodex/marketplace.json",
		"packages/lazycodex/plugin/.codex-plugin/plugin.json",
		"packages/lazycodex/plugin/.mcp.json"
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
export { inspectLazyCodexInstall, installLazyCodex, materializeRuntime, parseExecutorArgs, parseInstallOptions, removeLazyCodexConfig, resolveCodexHome, resolveCodexInstallerBinDir, resolveDefaultInstallOutDir, resolveRuntimeRoot, uninstallLazyCodex };