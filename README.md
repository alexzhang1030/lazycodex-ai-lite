# LazyCodex AI Lite

Lightweight LazyCodex runtime for OpenAI Codex.

This repository packages the useful LazyCodex pieces extracted from the upstream Codex Light runtime into a small GitHub Releases distribution. It ships a prebuilt Codex plugin payload plus a small Node executor built with `tsdown`.

Distribution happens through GitHub Releases. The package registry stays unused.

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

Uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/lazycodex-ai-lite/main/scripts/install.sh | sh -s -- uninstall
```

## Requirements

- Node.js `>=25.9.0`
- `curl` and `tar`
- Codex with plugin support enabled by config

The installer writes Codex config entries for plugin loading, plugin hooks, multi-agent support, child `AGENTS.md`, unified exec, and goals.

## What You Get

| Item | Purpose | Location or command |
|------|---------|---------------------|
| `lazycodex@sisyphuslabs` | Codex marketplace plugin id loaded by Codex. | `CODEX_HOME/plugins/cache/sisyphuslabs/lazycodex/<version>/` |
| `lazycodex` | Lightweight local CLI for LazyCodex runtime commands. | `lazycodex status`, `lazycodex uninstall`, `lazycodex ulw-loop --help` |
| `ultrawork agents` | Codex subagent TOML bundle for planning, execution, review, and QA lanes. | `CODEX_HOME/agents/*.toml` |
| `ulw-plan` | Planning skill for durable Ultrawork plans. | Prompt Codex with `ulw-plan ...` |
| `ulw-loop` | Goal/loop runtime and steering hook. | `lazycodex ulw-loop --help` |
| `review-work` | Review skill for completed work. | Prompt Codex with `review-work ...` |

Use it in Codex by prompting with:

```text
ultrawork: implement this change with a plan, evidence, and review.
```

The installer also links component CLIs:

```bash
lazycodex-ultrawork
lazycodex-ulw-loop
```

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

## Install Layout

Default install writes:

```text
CODEX_HOME/
+-- config.toml
+-- agents/
+-- runtime/lazycodex-ai-lite-package/
+-- plugins/cache/sisyphuslabs/lazycodex/<version>/
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
bin/lazycodex-ai-lite.js install -- install --no-tui --codex-autonomous
```

## Commands

```bash
# install bundled runtime into CODEX_HOME
bin/lazycodex-ai-lite.js install -- install --no-tui --codex-autonomous

# inspect install state
bin/lazycodex-ai-lite.js status --json

# remove managed LazyCodex files and config entries
bin/lazycodex-ai-lite.js uninstall

# run the bundled ulw-loop CLI
lazycodex ulw-loop --help

# copy runtime payload to a directory
bin/lazycodex-ai-lite.js materialize --out /tmp/lazycodex-runtime

# create a package tarball from the runtime payload
bin/lazycodex-ai-lite.js pack -- --pack-destination /tmp
```

## Development

Install locked dev dependencies:

```bash
bun install --frozen-lockfile
```

Build the runtime from the sibling upstream source checkout:

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
  --source ../oh-my-openagent \
  --out runtime/package \
  --name lazycodex-ai-lite \
  --optional=ulw-research,teammode,lazycodex-executor-verify
```

The upstream source checkout needs generated Codex artifacts first:

```bash
cd /Users/alex/code/contribution/oh-my-openagent
bun run build:codex-install
bun run build:codex-plugin
```

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
