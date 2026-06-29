#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const executorPath = join(binDir, "..", "dist", "executor.mjs");
const result = spawnSync(process.execPath, [executorPath, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
