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
|   |   +-- install: materialize runtime, run bundled Codex installer, write lightweight omo wrapper
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
|   +-- packages/omo-codex/
|       +-- marketplace.json
|       +-- scripts/install-local.mjs
|       +-- plugin/
|           +-- .codex-plugin/plugin.json
|           +-- .mcp.json
|           +-- hooks/
|           +-- components/
|           |   +-- bootstrap/
|           |   +-- ultrawork/
|           |   +-- ulw-loop/
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
              +-- copies runtime/package to CODEX_HOME/runtime/lazycodex-ai-lite-package
              +-- runs packages/omo-codex/scripts/install-local.mjs
              |   +-- installs plugin cache at CODEX_HOME/plugins/cache/sisyphuslabs/omo/<version>
              |   +-- writes marketplace snapshot at CODEX_HOME/.tmp/marketplaces/sisyphuslabs
              |   +-- enables plugins."omo@sisyphuslabs" in CODEX_HOME/config.toml
              |   +-- trusts the bundled hook state in CODEX_HOME/config.toml
              |   +-- copies managed agents into CODEX_HOME/agents
              |   +-- links component CLIs into the local bin dir
              +-- rewrites omo in the local bin dir as the lightweight LazyCodex CLI
```

The local bin dir is `CODEX_LOCAL_BIN_DIR` when set. With the default `CODEX_HOME=~/.codex`, it is `~/.local/bin`. With a custom `CODEX_HOME`, it is `CODEX_HOME/bin`.

## Uninstall Flow

```text
omo uninstall
  +-- dist/executor.mjs
      +-- removes CODEX_HOME/runtime/lazycodex-ai-lite-package
      +-- removes CODEX_HOME/plugins/cache/sisyphuslabs
      +-- removes CODEX_HOME/.tmp/marketplaces/sisyphuslabs
      +-- removes managed LazyCodex agent TOML files from CODEX_HOME/agents
      +-- removes managed local bin entries: omo, lazycodex-ai-lite, omo-ultrawork, omo-ulw-loop
      +-- removes LazyCodex-managed config sections from CODEX_HOME/config.toml
```

Config cleanup targets these sections:

- `[marketplaces.sisyphuslabs]`
- `[plugins."omo@sisyphuslabs"]`
- `[hooks.state."omo@sisyphuslabs:..."]`
- `[agents.<managed LazyCodex agent>]`
- `[features.multi_agent_v2]` with the LazyCodex migration comment block

## Runtime Components

| Component | Role | Entry |
|-----------|------|-------|
| `bootstrap` | Codex bootstrap component used by the plugin runtime. | Hook component under `plugin/components/bootstrap/`. |
| `ultrawork` | Agent bundle and prompt trigger for Ultrawork planning/execution. | Agents under `plugin/components/ultrawork/agents/`; CLI linked as `omo-ultrawork`. |
| `ulw-loop` | Goal/loop runtime and steering hook. | CLI linked as `omo-ulw-loop`; exposed through `omo ulw-loop`. |
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
