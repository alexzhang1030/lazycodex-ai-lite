#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const releaseDir = join(root, "release");
const packageDir = join(releaseDir, "package");
const tarball = join(releaseDir, "lazycodex-ai-lite.tar.gz");
const checksum = `${tarball}.sha256`;
const includes = [
  ".github",
  "bin",
  "dist",
  "docs",
  "runtime",
  "scripts",
  "src",
  ".gitignore",
  "README.md",
  "bun.lock",
  "package.json",
  "tsconfig.json",
  "tsdown.config.ts"
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });
for (const item of includes) run("cp", ["-R", item, packageDir]);
run("tar", ["-czf", tarball, "-C", releaseDir, "package"]);
const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
await writeFile(checksum, `${digest}  lazycodex-ai-lite.tar.gz\n`);
console.log(tarball);
console.log(checksum);
