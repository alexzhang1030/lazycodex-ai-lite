# Extraction Plan

## Target

Create a standalone repo that carries the Codex Light runtime and a native executor:

- npm package identity inside runtime: `lazycodex-ai-lite`
- Codex marketplace: `sisyphuslabs`
- Codex plugin: `lazycodex`
- install target: `~/.codex/plugins/cache/sisyphuslabs/lazycodex/<version>/`
- executor: `bin/lazycodex-ai-lite.js` launching `dist/executor.mjs`

## Runtime Build

`src/build-standalone.ts` copies a prebuilt LazyCodex source payload into `runtime/package/`:

1. `marketplace.json` and `plugin/`
2. selected plugin components, hooks, and skills

It rewrites package metadata to remove workspace install work from the copied plugin package. The full source CLI bundles stay out of the runtime; `dist/executor.mjs` is the only outer CLI runtime.

## Executor Build

The executor build targets Node `>=25.9.0`.

`src/executor.ts` is the runtime executor. It supports:

- `install [args]`: materialize runtime, install the Codex plugin payload, then write the lightweight `lazycodex` wrapper
- `uninstall [--dry-run]`: remove managed LazyCodex files and config sections
- `status [--json]`: inspect local LazyCodex state
- `ulw-loop [args]`: dispatch to the bundled `lazycodex-ulw-loop` component CLI
- `ultrawork [args]`: dispatch to the bundled `lazycodex-ultrawork` component CLI
- `materialize --out <dir>`: copy `runtime/package` to a target directory
- `pack [args]`: materialize runtime and run `npm pack`
- `version`: print runtime package version

Build chain:

1. `tsdown` bundles `src/executor.ts` to `dist/executor.mjs`
2. `bin/lazycodex-ai-lite.js` launches the bundled executor with the active Node runtime

## Upstream Fast Path

The standalone runtime removes plugin workspace dependencies, so cache-local `npm ci --omit=dev` is reduced to a dependency-free operation. The next source-repo improvement is a packaged fast path in `installCachedPlugin()` that validates hook targets and skips cache-local npm execution for prebuilt payloads.
