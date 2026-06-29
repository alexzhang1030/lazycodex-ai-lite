# LazyCodex AI Lite

Standalone repo for extracting and executing the LazyCodex multi-agent runtime for Codex.

It produces two artifacts:

- `runtime/package/`: npm-style runtime payload for `omo@sisyphuslabs`
- `dist/executor.mjs` + `bin/lazycodex-ai-lite.js`: small Node-only executor built by tsdown

Distribution is through GitHub Releases. The installer downloads the release tarball and runs the bundled executor locally.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh
```

Pin a release tag:

```bash
LAZYCODEX_AI_LITE_VERSION=v0.1.0 \
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh
```

Uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh -s -- uninstall
```

Check local state:

```bash
omo status
```

## What This Installs

| Item | What it is | How to use it |
|------|------------|---------------|
| `omo@sisyphuslabs` | Codex marketplace plugin id. Codex loads hooks, skills, and bundled agents from this plugin. | Installed into `CODEX_HOME/plugins/cache/sisyphuslabs/omo/<version>/`. |
| `omo` | Lightweight local CLI wrapper written by this repo. It only exposes LazyCodex runtime commands. | `omo install`, `omo uninstall`, `omo status`, `omo ulw-loop --help`. |
| `runtime/package/` | Prebuilt LazyCodex plugin payload extracted from OMO Codex Light. | Materialized into `CODEX_HOME/runtime/lazycodex-ai-lite-package`. |
| `ultrawork agents` | Codex subagent TOML files copied into `CODEX_HOME/agents/`. | Prompt Codex with `ultrawork ...`; Codex can route work to these agents. |
| `ulw-plan` | Planning skill for durable Ultrawork plans. | Prompt `ulw-plan ...` or use it through Ultrawork-triggered flows. |
| `ulw-loop` | Loop/goal runtime and CLI. | `omo ulw-loop --help`. |
| `review-work` | Review skill for completed work. | Prompt `review-work ...`. |

Repo layout and install flow are documented in [docs/repo-graph.md](docs/repo-graph.md).

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
```

## Build Executor

Node `>=25.9.0` is the local target.

```bash
bun run build:executor
```

## Use Executor

Install:

```bash
bin/lazycodex-ai-lite.js install -- install --no-tui --codex-autonomous
```

Uninstall:

```bash
bin/lazycodex-ai-lite.js uninstall
```

Status:

```bash
bin/lazycodex-ai-lite.js status
```

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

## CI And Release

Local CI:

```bash
bun run ci
```

Release package:

```bash
bun run package:release
```

GitHub Actions:

- `.github/workflows/ci.yml` runs tests, rebuilds the executor, validates the runtime payload, smokes the executor, and builds the release package.
- `.github/workflows/release.yml` runs the same gate on `v*` tags or manual dispatch, then uploads `lazycodex-ai-lite.tar.gz` and `lazycodex-ai-lite.tar.gz.sha256`.

## Runtime Contents

The extractor keeps this runtime surface:

- `packages/omo-codex/marketplace.json`
- `packages/omo-codex/plugin/`
  - `.codex-plugin/plugin.json`
  - `.mcp.json`
  - top-level selected hooks
  - `components/bootstrap/scripts/node-dispatch.ps1`
  - `components/ultrawork/{dist,agents,directive.md}`
  - `components/ulw-loop/{dist,directive.md}`
  - top-level selected skills

The lite executor performs install/uninstall directly: it copies the plugin cache, writes the local marketplace snapshot, trusts the selected hooks, installs bundled agents, and links `omo-ultrawork` / `omo-ulw-loop`.

The default runtime payload is about 572 KB on the current build. The extractor records the selected feature set in `lazycodex-standalone.json`.

## Credits

This project is extracted from `omo-lazycodex` / OMO Codex Light runtime work in `oh-my-openagent`, then reduced to the minimal LazyCodex runtime surface listed above.
