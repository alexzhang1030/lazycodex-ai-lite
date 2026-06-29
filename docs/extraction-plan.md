# Extraction Plan

## Target

Create a standalone repo that carries the Codex Light runtime and a native executor:

- npm package identity inside runtime: `lazycodex-ai-lite`
- Codex marketplace: `sisyphuslabs`
- Codex plugin: `omo`
- install target: `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`
- executor: `bin/lazycodex-ai-lite.js` launching `dist/executor.mjs`

## Runtime Build

`src/build-standalone.ts` copies a prebuilt subset from `../oh-my-openagent` into `runtime/package/`:

1. root `dist/cli` and `dist/cli-node` for the `omo` wrapper
2. `packages/omo-codex` installer scripts and plugin payload
3. `packages/git-bash-mcp/dist`
4. `packages/lsp-daemon/dist`

It rewrites package metadata to remove workspace install work from the copied plugin package and patches the generated installer bundle so `lazycodex-ai-lite` is treated as packaged layout.

## Executor Build

The executor build targets Node `>=25.9.0`.

`src/executor.ts` is the runtime executor. It supports:

- `install [args]`: materialize runtime, run the bundled Codex installer, then write the lightweight `omo` wrapper
- `uninstall [--dry-run]`: remove managed LazyCodex files and config sections
- `status [--json]`: inspect local LazyCodex state
- `ulw-loop [args]`: dispatch to the bundled `omo-ulw-loop` component CLI
- `ultrawork [args]`: dispatch to the bundled `omo-ultrawork` component CLI
- `materialize --out <dir>`: copy `runtime/package` to a target directory
- `pack [args]`: materialize runtime and run `npm pack`
- `version`: print runtime package version

Build chain:

1. `tsdown` bundles `src/executor.ts` to `dist/executor.mjs`
2. `bin/lazycodex-ai-lite.js` launches the bundled executor with the active Node runtime

## Upstream Fast Path

The standalone runtime removes plugin workspace dependencies, so cache-local `npm ci --omit=dev` is reduced to a dependency-free operation. The next source-repo improvement is a packaged fast path in `installCachedPlugin()` that validates hook targets and skips cache-local npm execution for prebuilt payloads.
