# LazyCodex AI Lite

Standalone repo for extracting and executing the LazyCodex multi-agent runtime for Codex.

It produces two artifacts:

- `runtime/package/`: npm-style runtime payload for `omo@sisyphuslabs`
- `dist/executor.mjs` + `bin/lazycodex-ai-lite.js`: small Node executor built by tsdown

## Runtime Profile

Default payload:

- Ultrawork bundled agents from `components/ultrawork/agents/`
- `ulw-plan`
- `ulw-loop`
- `review-work`

Optional packs:

- `ulw-research`
- `teammode`
- `lazycodex-executor-verify`

The lite MCP manifest is written as an empty `.mcp.json`.

## Build Runtime

Run from this repo:

```bash
bun run build:runtime
```

Build with all optional packs:

```bash
bun run build:runtime:all
```

Build with selected optional packs:

```bash
bun run src/build-standalone.ts \
  --source ../oh-my-openagent \
  --out runtime/package \
  --name lazycodex-ai-lite \
  --optional=ulw-research,teammode,lazycodex-executor-verify
```

The source repo needs generated Codex artifacts first:

```bash
cd /Users/alex/code/contribution/oh-my-openagent
bun run build:codex-install
bun run build:codex-plugin
bun build packages/omo-opencode/src/cli/index.ts --outdir dist/cli --target bun --format esm
bun run build:cli-node
```

## Build Executor

Node `>=25.9.0` is the local target.

```bash
bun run build:executor
```

## Use Executor

Copy runtime to a directory:

```bash
bin/lazycodex-ai-lite.js materialize --out /tmp/lazycodex-runtime
```

Install into an isolated Codex home:

```bash
CODEX_HOME=/tmp/codex-home \
CODEX_LOCAL_BIN_DIR=/tmp/codex-bin \
bin/lazycodex-ai-lite.js install -- install --no-tui --codex-autonomous
```

Pack the runtime payload:

```bash
bin/lazycodex-ai-lite.js pack -- --pack-destination /tmp
```

## Runtime Contents

The extractor keeps this runtime surface:

- `packages/omo-codex/scripts/install-local.mjs`
- `packages/omo-codex/scripts/install-dist/`
- `packages/omo-codex/marketplace.json`
- `packages/omo-codex/plugin/`
- `dist/cli/`
- `dist/cli-node/`

The extractor rewrites package metadata and records the selected feature set in `lazycodex-standalone.json`.
