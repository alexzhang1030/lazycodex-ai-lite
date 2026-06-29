# LazyCodex AI Lite

Lightweight LazyCodex runtime for OpenAI Codex.

This repo packages the LazyCodex runtime pieces needed for Codex multi-agent work into a compact GitHub Releases distribution. It ships a prebuilt Codex plugin payload plus a small Node executor built from `src/executor.ts`.

Distribution lives in GitHub Releases. The npm package registry is kept out of the release path.

## Features

- Installs the `lazycodex` Codex plugin from the bundled `sisyphuslabs` marketplace payload.
- Adds Ultrawork agents for planning, execution, review, QA, and research-style lanes.
- Adds `ulw-plan`, `ulw-loop`, and `review-work` skills to Codex.
- Links local CLI entrypoints for `lazycodex`, `lazycodex-ai-lite`, `lazycodex-ultrawork`, and `lazycodex-ulw-loop`.
- Provides install, uninstall, status, materialize, pack, and component dispatch commands.

## Requirements

- Node.js `>=25.9.0`
- `curl` and `tar`
- Codex with plugin support available in config

For development:

- Bun
- Node.js `>=25.9.0`

## Quick Start

Install the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh
```

Install a pinned release:

```bash
LAZYCODEX_AI_LITE_VERSION=v0.1.0 \
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh
```

Check local state:

```bash
lazycodex status
```

Use the installed runtime in Codex:

```text
ultrawork: implement this change with a plan, evidence, and review.
```

Uninstall managed LazyCodex files:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh -s -- uninstall
```

## Installer Options

The installer downloads `lazycodex-ai-lite.tar.gz` from GitHub Releases, verifies `lazycodex-ai-lite.tar.gz.sha256` when `shasum` is available, extracts the package, and runs the bundled executor.

Environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `LAZYCODEX_AI_LITE_REPO` | GitHub repo used by `scripts/install.sh`. | `alexzhang1030/lazycodex-ai-lite` |
| `LAZYCODEX_AI_LITE_VERSION` | Release tag to install. Use `latest` for the latest release asset. | `latest` |
| `CODEX_HOME` | Codex home written by the installer. | `~/.codex` |
| `CODEX_LOCAL_BIN_DIR` | Directory for local CLI wrappers. | `~/.local/bin` for default `CODEX_HOME`; `CODEX_HOME/bin` for custom `CODEX_HOME` |
| `LAZYCODEX_AI_LITE_RUNTIME` | Runtime package path used by local executor commands. | auto-detected |

Default install command executed by `scripts/install.sh`:

```bash
node package/bin/lazycodex-ai-lite.js install -- install --no-tui --codex-auto
```

`--codex-auto` writes Codex automation settings:

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
network_access = "enabled"
```

Use `--no-codex-auto` to keep approval, sandbox, and network settings managed outside this installer:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | \
  sh -s -- install -- install --no-tui --no-codex-auto
```

Dry run:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | \
  sh -s -- install --dry-run
```

## Install Layout

Default install writes these managed paths:

```text
CODEX_HOME/
+-- config.toml
+-- agents/
+-- runtime/lazycodex-ai-lite-package/
+-- plugins/cache/sisyphuslabs/lazycodex/<version>/
+-- plugins/cache/sisyphuslabs/.agents/plugins/marketplace.json
+-- .tmp/marketplaces/sisyphuslabs/
```

Local bin layout:

```text
~/.local/bin/lazycodex
~/.local/bin/lazycodex-ai-lite
~/.local/bin/lazycodex-ultrawork
~/.local/bin/lazycodex-ulw-loop
```

For an isolated install:

```bash
CODEX_HOME=/tmp/codex-home \
CODEX_LOCAL_BIN_DIR=/tmp/codex-bin \
bin/lazycodex-ai-lite.js install -- install --no-tui --codex-auto
```

The installer enables these Codex config sections and settings:

- `[features]` entries for plugins, plugin hooks, multi-agent support, child `AGENTS.md`, unified exec, and goals
- `[marketplaces.sisyphuslabs]`
- `[plugins."lazycodex@sisyphuslabs"]`
- `[hooks.state."lazycodex@sisyphuslabs:..."]`
- `[agents.<bundled-agent>]`

## What You Get

| Item | Purpose | Location or command |
|------|---------|---------------------|
| `lazycodex` | Codex plugin name from the bundled plugin manifest. | `CODEX_HOME/plugins/cache/sisyphuslabs/lazycodex/<version>/` |
| `sisyphuslabs` | Local Codex marketplace name used by the installer. | `CODEX_HOME/plugins/cache/sisyphuslabs/` |
| `[plugins."lazycodex@sisyphuslabs"]` | Codex config key that enables the installed plugin. | `CODEX_HOME/config.toml` |
| `lazycodex` CLI | Lightweight local CLI for LazyCodex runtime commands. | `lazycodex status`, `lazycodex uninstall`, `lazycodex ulw-loop --help` |
| `ultrawork agents` | Codex subagent TOML bundle for planning, execution, review, and QA lanes. | `CODEX_HOME/agents/*.toml` |
| `ulw-plan` | Planning skill for durable Ultrawork plans. | Prompt Codex with `ulw-plan ...` |
| `ulw-loop` | Goal/loop runtime and steering hook. | `lazycodex ulw-loop --help` |
| `review-work` | Review skill for completed work. | Prompt Codex with `review-work ...` |

The installer also links component CLIs:

```bash
lazycodex-ultrawork
lazycodex-ulw-loop
```

## Commands

```bash
# install bundled runtime into CODEX_HOME
bin/lazycodex-ai-lite.js install -- install --no-tui --codex-auto

# inspect install state
bin/lazycodex-ai-lite.js status
bin/lazycodex-ai-lite.js status --json

# remove managed LazyCodex files and config entries
bin/lazycodex-ai-lite.js uninstall
bin/lazycodex-ai-lite.js uninstall --dry-run
bin/lazycodex-ai-lite.js uninstall --dry-run --json

# dispatch to bundled component CLIs after install
lazycodex ulw-loop --help
lazycodex ultrawork --help

# print runtime package version
bin/lazycodex-ai-lite.js version

# copy runtime payload to a directory
bin/lazycodex-ai-lite.js materialize --out /tmp/lazycodex-runtime

# create an npm tarball from the runtime payload
bin/lazycodex-ai-lite.js pack -- --pack-destination /tmp
```

Global executor options:

| Option | Purpose |
|--------|---------|
| `--runtime <dir>` | Runtime package directory. |
| `--out <dir>` | Materialized package directory. Install defaults to `CODEX_HOME/runtime/lazycodex-ai-lite-package`. |
| `--keep-temp` | Preserve the temporary materialized runtime used by `pack`. |

## Runtime Profile

Default payload:

- `components/bootstrap/scripts/node-dispatch.ps1`
- `components/ultrawork/dist`
- `components/ultrawork/agents`
- `components/ultrawork/directive.md`
- `components/ulw-loop/dist`
- `components/ulw-loop/directive.md`
- top-level skills: `ulw-plan`, `ulw-loop`, `review-work`
- top-level hooks:
  - `user-prompt-submit-checking-ultrawork-trigger.json`
  - `user-prompt-submit-checking-ulw-loop-steering.json`
  - `pre-tool-use-enforcing-unlimited-goal-budget.json`

Current default build size:

| Artifact | Size |
|----------|------|
| `runtime/package` | about 572 KB |
| `runtime/package/packages/lazycodex/plugin` | about 560 KB |
| `dist/executor.mjs` | about 37 KB |
| `release/lazycodex-ai-lite.tar.gz` | about 161 KB |

Optional packs supported by the extractor:

- `ulw-research`
- `teammode`
- `lazycodex-executor-verify`

## Development

Install locked dev dependencies:

```bash
bun install --frozen-lockfile
```

Build the runtime from a LazyCodex source payload at `runtime/source/lazycodex`:

```bash
bun run build:runtime
```

Build all optional packs:

```bash
bun run build:runtime:all
```

Build selected optional packs:

```bash
bun run src/build-standalone.ts \
  --source /path/to/lazycodex-source \
  --out runtime/package \
  --name lazycodex-ai-lite \
  --optional=ulw-research,teammode,lazycodex-executor-verify
```

The source payload root must contain `marketplace.json` and `plugin/`.

Build the executor:

```bash
bun run build:executor
```

Run local CI:

```bash
bun run ci
```

## Release

Build local release artifacts:

```bash
bun run package:release
```

This writes:

```text
release/lazycodex-ai-lite.tar.gz
release/lazycodex-ai-lite.tar.gz.sha256
```

Publish through GitHub Actions:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow runs tests, builds the executor, validates the runtime payload, builds the release tarball, and uploads the tarball plus checksum.

## Repo Graph

Install flow and file graph live in [docs/repo-graph.md](docs/repo-graph.md).

## Credits

This project credits the original LazyCodex runtime work in `oh-my-openagent`, then reduces it to the minimal runtime surface listed above.
