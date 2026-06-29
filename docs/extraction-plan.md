# Extraction Plan

## Target

Create a standalone repo that carries the Codex Light runtime and a native executor:

- npm package identity inside runtime: `lazycodex-ai-lite`
- Codex marketplace: `sisyphuslabs`
- Codex plugin: `omo`
- install target: `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`
- executor: `bin/lazycodex-ai-lite-executor`

## Runtime Build

`src/build-standalone.ts` copies a prebuilt subset from `../oh-my-openagent` into `runtime/package/`:

1. root `dist/cli` and `dist/cli-node` for the `omo` wrapper
2. `packages/omo-codex` installer scripts and plugin payload
3. `packages/git-bash-mcp/dist`
4. `packages/lsp-daemon/dist`

It rewrites package metadata to remove workspace install work from the copied plugin package and patches the generated installer bundle so `lazycodex-ai-lite` is treated as packaged layout.

## Executor Build

The executor build runs on Node `>=25.7.0` because tsdown `exe` depends on Node SEA.

`src/executor.ts` is the runtime executor. It supports:

- `materialize --out <dir>`: copy `runtime/package` to a target directory
- `install [args]`: materialize runtime and run the bundled Codex installer
- `pack [args]`: materialize runtime and run `npm pack`
- `version`: print runtime package version

Build chain:

1. `tsdown` bundles `src/executor.ts` to `dist/executor.mjs`
2. tsdown `exe` uses Node SEA to write `bin/lazycodex-ai-lite-executor` directly

## Upstream Fast Path

The standalone runtime removes plugin workspace dependencies, so cache-local `npm ci --omit=dev` is reduced to a dependency-free operation. The next source-repo improvement is a packaged fast path in `installCachedPlugin()` that validates hook targets and skips cache-local npm execution for prebuilt payloads.
