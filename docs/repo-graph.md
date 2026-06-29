# Repo Graph

This repo is a small distribution shell around a prebuilt LazyCodex runtime.

## File Graph

```text
lazycodex-ai-lite/
+-- bin/lazycodex-ai-lite.js
|   +-- Node entrypoint that launches dist/executor.mjs
+-- dist/executor.mjs
|   +-- tsdown bundle built from src/executor.ts
+-- src/
|   +-- executor.ts
|   |   +-- install: materialize runtime, copy Codex plugin payload, write Codex config, link CLIs
|   |   +-- uninstall: remove managed LazyCodex Codex artifacts
|   |   +-- status: inspect managed LazyCodex Codex artifacts
|   |   +-- ulw-loop / ultrawork: dispatch to component CLIs
|   |   +-- materialize: copy runtime/package
|   |   +-- pack: run npm pack against a materialized runtime
|   +-- executor.test.ts
|   +-- build-standalone.ts
|   +-- build-standalone.test.ts
+-- runtime/package/
|   +-- lazycodex-standalone.json
|   +-- package.json
|   +-- packages/lazycodex/
|       +-- marketplace.json
|       +-- plugin/
|           +-- .codex-plugin/plugin.json
|           +-- .mcp.json
|           +-- hooks/
|           +-- components/
|           |   +-- bootstrap/
|           |   |   +-- scripts/node-dispatch.ps1
|           |   +-- ultrawork/
|           |   |   +-- agents/
|           |   |   +-- dist/
|           |   |   +-- directive.md
|           |   +-- ulw-loop/
|           |       +-- dist/
|           |       +-- directive.md
|           +-- skills/
|               +-- review-work/
|               +-- ulw-plan/
|               +-- ulw-loop/
+-- scripts/
|   +-- install.sh
|   +-- validate-runtime.mjs
|   +-- package-release.mjs
+-- .github/workflows/
    +-- ci.yml
    +-- release.yml
```

## Install Flow

```text
scripts/install.sh
  +-- downloads lazycodex-ai-lite.tar.gz from GitHub Releases
      +-- node package/bin/lazycodex-ai-lite.js install
          +-- dist/executor.mjs
              +-- copy runtime/package to CODEX_HOME/runtime/lazycodex-ai-lite-package
              +-- install plugin cache at CODEX_HOME/plugins/cache/sisyphuslabs/lazycodex/<version>
              +-- write marketplace snapshot at CODEX_HOME/.tmp/marketplaces/sisyphuslabs
              +-- enable plugins."lazycodex@sisyphuslabs" in CODEX_HOME/config.toml
              +-- trust the bundled hook state in CODEX_HOME/config.toml
              +-- copy managed agents into CODEX_HOME/agents
              +-- link component CLIs into the local bin dir
              +-- write lazycodex in the local bin dir as the lightweight LazyCodex CLI
```

The local bin dir is `CODEX_LOCAL_BIN_DIR` when set. With the default `CODEX_HOME=~/.codex`, it is `~/.local/bin`. With a custom `CODEX_HOME`, it is `CODEX_HOME/bin`.

## Uninstall Flow

```text
lazycodex uninstall
  +-- dist/executor.mjs
      +-- removes CODEX_HOME/runtime/lazycodex-ai-lite-package
      +-- removes CODEX_HOME/plugins/cache/sisyphuslabs
      +-- removes CODEX_HOME/.tmp/marketplaces/sisyphuslabs
      +-- removes managed LazyCodex agent TOML files from CODEX_HOME/agents
      +-- removes managed local bin entries: lazycodex, lazycodex-ai-lite, lazycodex-ultrawork, lazycodex-ulw-loop
      +-- removes LazyCodex-managed config sections from CODEX_HOME/config.toml
```

Config cleanup targets these sections:

- `[marketplaces.sisyphuslabs]`
- `[plugins."lazycodex@sisyphuslabs"]`
- `[hooks.state."lazycodex@sisyphuslabs:..."]`
- `[agents.<managed LazyCodex agent>]`
- `[features.multi_agent_v2]` with the LazyCodex migration comment block

## Runtime Components

| Component | Role | Entry |
|-----------|------|-------|
| `bootstrap` | Windows command dispatcher used by selected hooks. | `plugin/components/bootstrap/scripts/node-dispatch.ps1`. |
| `ultrawork` | Agent bundle and prompt trigger for Ultrawork planning/execution. | Agents under `plugin/components/ultrawork/agents/`; CLI linked as `lazycodex-ultrawork`. |
| `ulw-loop` | Goal/loop runtime and steering hook. | CLI linked as `lazycodex-ulw-loop`; exposed through `lazycodex ulw-loop`. |
| `review-work` | Review skill for completed work. | Skill under `plugin/skills/review-work/`. |
| `ulw-plan` | Durable planning skill. | Skill under `plugin/skills/ulw-plan/`. |

## Release Flow

```text
push to main / PR
  +-- CI: bun install, bun test, tsdown build, runtime validation, executor smoke, release package build

tag v*
  +-- Release: same gate, then upload lazycodex-ai-lite.tar.gz and lazycodex-ai-lite.tar.gz.sha256
```

Distribution stays on GitHub Releases.
