import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface BuildOptions {
  readonly sourceRoot: string;
  readonly outDir: string;
  readonly packageName: string;
  readonly version?: string;
  readonly optionalPacks?: readonly string[];
}

interface CopyEntry {
  readonly from: string;
  readonly to: string;
}

interface FeatureDefinition {
  readonly components: readonly string[];
  readonly hooks: readonly string[];
  readonly skills: readonly string[];
}

interface FeatureSelection {
  readonly optionalPacks: readonly OptionalPackName[];
  readonly components: ReadonlySet<string>;
  readonly hooks: ReadonlySet<string>;
  readonly skills: ReadonlySet<string>;
}

const copyEntries: readonly CopyEntry[] = [
  { from: "packages/omo-codex/marketplace.json", to: "packages/omo-codex/marketplace.json" },
  { from: "packages/omo-codex/scripts/install-local.mjs", to: "packages/omo-codex/scripts/install-local.mjs" },
  { from: "packages/omo-codex/scripts/install-dist", to: "packages/omo-codex/scripts/install-dist" },
  { from: "packages/omo-codex/plugin", to: "packages/omo-codex/plugin" }
];

const requiredFiles = [
  "packages/omo-codex/marketplace.json",
  "packages/omo-codex/scripts/install-local.mjs",
  "packages/omo-codex/scripts/install-dist/install-local.mjs",
  "packages/omo-codex/plugin/.codex-plugin/plugin.json",
  "packages/omo-codex/plugin/.mcp.json",
  "packages/omo-codex/plugin/package.json",
  "packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs",
  "packages/omo-codex/plugin/scripts/migrate-omo-sot/editor.mjs"
] as const;

const coreFeatureDefinition = {
  components: ["bootstrap", "ultrawork", "ulw-loop"],
  hooks: [
    "user-prompt-submit-checking-ultrawork-trigger.json",
    "user-prompt-submit-checking-ulw-loop-steering.json",
    "pre-tool-use-enforcing-unlimited-goal-budget.json"
  ],
  skills: ["ulw-plan", "ulw-loop", "review-work"]
} as const satisfies FeatureDefinition;

const optionalFeatureDefinitions = {
  "ulw-research": {
    components: [],
    hooks: [],
    skills: ["ulw-research"]
  },
  teammode: {
    components: ["teammode"],
    hooks: ["post-tool-use-checking-thread-title-hygiene.json"],
    skills: ["teammode"]
  },
  "lazycodex-executor-verify": {
    components: ["lazycodex-executor-verify"],
    hooks: ["subagent-stop-verifying-lazycodex-executor-evidence.json"],
    skills: []
  }
} as const satisfies Record<string, FeatureDefinition>;

type OptionalPackName = keyof typeof optionalFeatureDefinitions;

const allOptionalPackNames = Object.keys(optionalFeatureDefinitions) as OptionalPackName[];

const optionalPackAliases: Record<string, OptionalPackName | "all"> = {
  all: "all",
  "ulw-research": "ulw-research",
  ulw_research: "ulw-research",
  teammode: "teammode",
  "team-mode": "teammode",
  team_mode: "teammode",
  "lazycodex-executor-verify": "lazycodex-executor-verify",
  lazycodex_executor_verify: "lazycodex-executor-verify",
  "executor-verify": "lazycodex-executor-verify"
};

const allowedPluginRootEntries = new Set([
  ".codex-plugin",
  ".mcp.json",
  "components",
  "hooks",
  "package-lock.json",
  "package.json",
  "scripts",
  "skills"
]);

const allowedPluginScriptEntries = new Set([
  "migrate-omo-sot",
  "migrate-omo-sot.mjs"
]);

const ignoredDirectoryNames = new Set([
  ".git",
  "node_modules",
  ".ulw",
  ".claude",
  ".github",
  "test",
  "tests",
  "__tests__",
  "src"
]);

const ignoredFileNames = new Set([
  ".gitattributes",
  ".gitignore",
  ".npmignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "biome.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "vitest.config.ts",
  "bench-codex-rules.mjs",
  "build-bundled-mcp-runtimes.mjs",
  "build-components.mjs",
  "build-lsp-daemon.mjs",
  "build-lsp-tools.mjs",
  "build.mjs",
  "clean-dist.mjs",
  "generate-manifests.mjs",
  "materialize-shared-upstreams.mjs",
  "sync-hook-status-messages.mjs",
  "sync-skills.mjs",
  "sync-version.mjs",
  "sync-directive.mjs",
  "test.mjs"
]);

const ignoredFileExtensions = [".d.ts", ".ts", ".tsx"] as const;

export async function buildStandalonePackage(options: BuildOptions): Promise<void> {
  const sourceRoot = resolve(options.sourceRoot);
  const outDir = resolve(options.outDir);
  const packageName = options.packageName.trim();
  if (packageName.length === 0) throw new Error("--name requires a package name");

  const featureSelection = buildFeatureSelection(options.optionalPacks ?? []);
  await assertRequiredSourceFiles(sourceRoot);
  await assertFeatureSourceFiles(sourceRoot, featureSelection);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const entry of copyEntries) {
    await copyPath(join(sourceRoot, entry.from), join(outDir, entry.to));
  }

  const version = options.version ?? await readSourceVersion(sourceRoot);
  await filterCodexPluginPayload(join(outDir, "packages/omo-codex/plugin"), featureSelection, version);
  await writeStandalonePackageJson(outDir, { packageName, version });
  await rewritePluginPackageMetadata(outDir, version);
  const installerPath = join(outDir, "packages/omo-codex/scripts/install-dist/install-local.mjs");
  await patchInstallerPackagedNames(installerPath, packageName);
  await patchInstallerForLiteProfile(installerPath);
  await writeBuildManifest(outDir, { sourceRoot, packageName, version, featureSelection });
}

async function assertRequiredSourceFiles(sourceRoot: string): Promise<void> {
  await assertFilesExist(sourceRoot, requiredFiles, "Missing source build artifacts:");
}

async function assertFeatureSourceFiles(sourceRoot: string, selection: FeatureSelection): Promise<void> {
  const files = [
    ...[...selection.components].map((component) => `packages/omo-codex/plugin/components/${component}/dist/cli.js`),
    ...[...selection.hooks].map((hook) => `packages/omo-codex/plugin/hooks/${hook}`),
    ...[...selection.skills].map((skill) => `packages/omo-codex/plugin/skills/${skill}/SKILL.md`)
  ];
  await assertFilesExist(sourceRoot, files, "Missing selected runtime artifacts:");
}

async function assertFilesExist(sourceRoot: string, files: readonly string[], heading: string): Promise<void> {
  const missing: string[] = [];
  for (const file of files) {
    if (!await exists(join(sourceRoot, file))) missing.push(file);
  }
  if (missing.length > 0) {
    throw new Error([
      heading,
      ...missing.map((file) => `- ${file}`),
      "",
      "Run the source repo build steps from README.md, then retry."
    ].join("\n"));
  }
}

async function copyPath(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath), { recursive: true });
  await cp(fromPath, toPath, {
    recursive: true,
    filter: (path) => shouldCopyPath(path, fromPath)
  });
}

function shouldCopyPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length);
  if (relative.length === 0) return true;
  const parts = relative.split(sep);
  if (parts.some((part) => ignoredDirectoryNames.has(part))) return false;
  const fileName = parts.at(-1);
  if (fileName === undefined) return true;
  if (ignoredFileNames.has(fileName)) return false;
  if (fileName.includes(".test.") || fileName.includes(".spec.")) return false;
  return !ignoredFileExtensions.some((extension) => fileName.endsWith(extension));
}

async function filterCodexPluginPayload(pluginRoot: string, selection: FeatureSelection, version: string): Promise<void> {
  await pruneDirectoryChildren(pluginRoot, allowedPluginRootEntries);
  await pruneDirectoryChildren(join(pluginRoot, "scripts"), allowedPluginScriptEntries);
  await pruneDirectoryChildren(join(pluginRoot, "components"), selection.components);
  await pruneDirectoryChildren(join(pluginRoot, "hooks"), selection.hooks);
  await pruneDirectoryChildren(join(pluginRoot, "skills"), selection.skills);
  await writeJson(join(pluginRoot, ".mcp.json"), { mcpServers: {} });
  await rewritePluginManifest(pluginRoot, selection, version);
}

async function rewritePluginManifest(pluginRoot: string, selection: FeatureSelection, version: string): Promise<void> {
  const manifestPath = join(pluginRoot, ".codex-plugin/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const hooks = Array.isArray(manifest.hooks) ? manifest.hooks : [];
  manifest.version = version;
  manifest.description = "LazyCodex multi-agent runtime for Codex.";
  manifest.hooks = hooks
    .filter((hook): hook is string => typeof hook === "string")
    .filter((hook) => selection.hooks.has(basename(hook)));
  manifest.mcpServers = "./.mcp.json";
  manifest.interface = {
    ...(isRecord(manifest.interface) ? manifest.interface : {}),
    shortDescription: "LazyCodex multi-agent runtime",
    longDescription: "LazyCodex Lite ships Ultrawork agents, ulw-plan, ulw-loop, and review-work for Codex multi-agent workflows.",
    capabilities: ["Hooks", "Workflow", "Multi-Agent"],
    defaultPrompt: [
      "ultrawork: plan and run this change with evidence.",
      "ulw-loop: create goals and keep progress durable.",
      "review-work: audit the completed work."
    ]
  };
  await writeJson(manifestPath, manifest);
}

async function pruneDirectoryChildren(directory: string, allowedNames: ReadonlySet<string>): Promise<void> {
  if (!await exists(directory)) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (allowedNames.has(entry.name)) continue;
    await rm(join(directory, entry.name), { recursive: true, force: true });
  }
}

function buildFeatureSelection(optionalPacks: readonly string[]): FeatureSelection {
  const selectedOptionalPacks = normalizeOptionalPacks(optionalPacks);
  const components = new Set(coreFeatureDefinition.components);
  const hooks = new Set(coreFeatureDefinition.hooks);
  const skills = new Set(coreFeatureDefinition.skills);

  for (const pack of selectedOptionalPacks) {
    const feature = optionalFeatureDefinitions[pack];
    for (const component of feature.components) components.add(component);
    for (const hook of feature.hooks) hooks.add(hook);
    for (const skill of feature.skills) skills.add(skill);
  }

  return { optionalPacks: selectedOptionalPacks, components, hooks, skills };
}

function normalizeOptionalPacks(optionalPacks: readonly string[]): readonly OptionalPackName[] {
  const selected = new Set<OptionalPackName>();
  for (const rawPack of optionalPacks) {
    const pack = canonicalOptionalPack(rawPack);
    if (pack === "all") {
      for (const name of allOptionalPackNames) selected.add(name);
      continue;
    }
    selected.add(pack);
  }
  return allOptionalPackNames.filter((name) => selected.has(name));
}

function canonicalOptionalPack(rawPack: string): OptionalPackName | "all" {
  const normalized = rawPack.trim().toLowerCase();
  const pack = optionalPackAliases[normalized];
  if (pack !== undefined) return pack;
  throw new Error(`Unknown optional pack: ${rawPack}. Available optional packs: ${[...allOptionalPackNames, "all"].join(", ")}`);
}

async function readSourceVersion(sourceRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")) as { readonly version?: unknown };
  return typeof packageJson.version === "string" && packageJson.version.trim().length > 0
    ? packageJson.version.trim()
    : "0.0.0";
}

async function writeStandalonePackageJson(
  outDir: string,
  input: { readonly packageName: string; readonly version: string }
): Promise<void> {
  const packageJson = {
    name: input.packageName,
    version: input.version,
    type: "module",
    bin: {
      "lazycodex-ai-lite": "packages/omo-codex/scripts/install-local.mjs",
      "lazycodex-ai": "packages/omo-codex/scripts/install-local.mjs",
      lazycodex: "packages/omo-codex/scripts/install-local.mjs"
    },
    files: [
      "packages/omo-codex/scripts/install-local.mjs",
      "packages/omo-codex/scripts/install-dist",
      "packages/omo-codex/plugin",
      "packages/omo-codex/marketplace.json"
    ],
    scripts: {},
    dependencies: {},
    optionalDependencies: {},
    devDependencies: {}
  };
  await writeJson(join(outDir, "package.json"), packageJson);
}

async function rewritePluginPackageMetadata(outDir: string, version: string): Promise<void> {
  const pluginPackagePath = join(outDir, "packages/omo-codex/plugin/package.json");
  const pluginPackage = JSON.parse(await readFile(pluginPackagePath, "utf8")) as Record<string, unknown>;
  pluginPackage.version = version;
  pluginPackage.private = true;
  pluginPackage.workspaces = [];
  pluginPackage.scripts = {};
  pluginPackage.dependencies = {};
  pluginPackage.devDependencies = {};
  pluginPackage.optionalDependencies = {};
  await writeJson(pluginPackagePath, pluginPackage);

  const lockfile = {
    name: typeof pluginPackage.name === "string" ? pluginPackage.name : "@sisyphuslabs/omo-codex-plugin",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: typeof pluginPackage.name === "string" ? pluginPackage.name : "@sisyphuslabs/omo-codex-plugin",
        version,
        dependencies: {}
      }
    }
  };
  await writeJson(join(outDir, "packages/omo-codex/plugin/package-lock.json"), lockfile);
}

async function patchInstallerPackagedNames(installerPath: string, packageName: string): Promise<void> {
  const installer = await readFile(installerPath, "utf8");
  if (installer.includes(JSON.stringify(packageName))) return;
  const marker = '"lazycodex-ai",';
  if (!installer.includes(marker)) {
    throw new Error(`Unable to patch packaged installer names in ${installerPath}`);
  }
  await writeFile(installerPath, installer.replace(marker, `${marker}\n  ${JSON.stringify(packageName)},`));
}

async function patchInstallerForLiteProfile(installerPath: string): Promise<void> {
  const installer = await readFile(installerPath, "utf8");
  const startMarker = "function ensureOmoBuiltinMcpPolicies(config, input) {";
  const endMarker = "function ensureHookTrusted(config, state) {";
  const startIndex = installer.indexOf(startMarker);
  if (startIndex < 0) return;
  const endIndex = installer.indexOf(endMarker, startIndex);
  if (endIndex < 0) return;
  const replacement = [
    "function ensureOmoBuiltinMcpPolicies(config, input) {",
    "  if (input.marketplaceName !== \"sisyphuslabs\" || !input.pluginNames.includes(\"omo\")) return config;",
    "  let nextConfig = removeStaleContext7PlaceholderMcp(config);",
    "  nextConfig = removeTomlSections(nextConfig, (header) =>",
    "    header === 'plugins.\"omo@sisyphuslabs\".mcp_servers.context7' ||",
    "    header === 'plugins.\"omo@sisyphuslabs\".mcp_servers.codegraph' ||",
    "    header === 'plugins.\"omo@sisyphuslabs\".mcp_servers.git_bash'",
    "  );",
    "  return nextConfig;",
    "}",
    "",
    ""
  ].join("\n");
  await writeFile(installerPath, `${installer.slice(0, startIndex)}${replacement}${installer.slice(endIndex)}`);
}

async function writeBuildManifest(
  outDir: string,
  input: {
    readonly sourceRoot: string;
    readonly packageName: string;
    readonly version: string;
    readonly featureSelection: FeatureSelection;
  }
): Promise<void> {
  await writeJson(join(outDir, "lazycodex-standalone.json"), {
    packageName: input.packageName,
    version: input.version,
    sourceRoot: input.sourceRoot,
    generatedAt: new Date().toISOString(),
    strategy: "prebuilt-plugin-payload",
    features: {
      core: ["ultrawork agents", "ulw-plan", "ulw-loop", "review-work"],
      optional: input.featureSelection.optionalPacks,
      components: [...input.featureSelection.components].sort(),
      hooks: [...input.featureSelection.hooks].sort(),
      skills: [...input.featureSelection.skills].sort()
    }
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repoRootFromImportMeta(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultSourceRoot(): string {
  return resolve(repoRootFromImportMeta(), "..", "oh-my-openagent");
}

function defaultOutDir(): string {
  return join(repoRootFromImportMeta(), "runtime", "package");
}

interface ParsedArgs {
  readonly sourceRoot: string;
  readonly outDir: string;
  readonly packageName: string;
  readonly version?: string;
  readonly optionalPacks: readonly OptionalPackName[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let sourceRoot = defaultSourceRoot();
  let outDir = defaultOutDir();
  let packageName = "lazycodex-ai-lite";
  let version: string | undefined;
  const optionalPacks: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      sourceRoot = readValue(argv, index, "--source");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--source=")) {
      sourceRoot = readInlineValue(arg, "--source");
      continue;
    }
    if (arg === "--out") {
      outDir = readValue(argv, index, "--out");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--out=")) {
      outDir = readInlineValue(arg, "--out");
      continue;
    }
    if (arg === "--name") {
      packageName = readValue(argv, index, "--name");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--name=")) {
      packageName = readInlineValue(arg, "--name");
      continue;
    }
    if (arg === "--version") {
      version = readValue(argv, index, "--version");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--version=")) {
      version = readInlineValue(arg, "--version");
      continue;
    }
    if (arg === "--optional" || arg === "--with") {
      optionalPacks.push(...parseOptionalPackValue(readValue(argv, index, arg)));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--optional=")) {
      optionalPacks.push(...parseOptionalPackValue(readInlineValue(arg, "--optional")));
      continue;
    }
    if (arg?.startsWith("--with=")) {
      optionalPacks.push(...parseOptionalPackValue(readInlineValue(arg, "--with")));
      continue;
    }
    throw new Error(`Unknown option: ${String(arg)}`);
  }

  return { sourceRoot, outDir, packageName, version, optionalPacks: normalizeOptionalPacks(optionalPacks) };
}

function parseOptionalPackValue(value: string): readonly string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function readValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${option} requires a value`);
  return value;
}

function readInlineValue(arg: string, option: string): string {
  const value = arg.slice(`${option}=`.length);
  if (value.trim().length === 0) throw new Error(`${option} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await buildStandalonePackage(options);
  const outputStat = await stat(resolve(options.outDir));
  if (!outputStat.isDirectory()) throw new Error(`Output was not created: ${options.outDir}`);
  console.log(`Built standalone package at ${resolve(options.outDir)}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
