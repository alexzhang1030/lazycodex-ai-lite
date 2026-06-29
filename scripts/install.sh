#!/usr/bin/env sh
set -eu

REPO="${LAZYCODEX_AI_LITE_REPO:-alexzhang1030/lazycodex-ai-lite}"
VERSION="${LAZYCODEX_AI_LITE_VERSION:-latest}"
ASSET="lazycodex-ai-lite.tar.gz"
TMP_DIR="${TMPDIR:-/tmp}/lazycodex-ai-lite-install-$$"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "lazycodex-ai-lite installer requires $1" >&2
    exit 127
  }
}

need curl
need tar
need node
mkdir -p "$TMP_DIR"

if [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/$REPO/releases/latest/download"
else
  BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
fi

curl -fsSL "$BASE_URL/$ASSET" -o "$TMP_DIR/$ASSET"
if command -v shasum >/dev/null 2>&1; then
  if curl -fsSL "$BASE_URL/$ASSET.sha256" -o "$TMP_DIR/$ASSET.sha256"; then
    (cd "$TMP_DIR" && shasum -a 256 -c "$ASSET.sha256")
  fi
fi

tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"
if [ "$#" -eq 0 ]; then
  node "$TMP_DIR/package/bin/lazycodex-ai-lite.js" install -- install --no-tui --codex-auto
else
  node "$TMP_DIR/package/bin/lazycodex-ai-lite.js" "$@"
fi
