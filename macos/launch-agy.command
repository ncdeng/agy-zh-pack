#!/bin/zsh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

find_node() {
  local cand=""
  if command -v node >/dev/null 2>&1; then
    cand="$(command -v node)"
  else
    for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.asdf/shims/node"; do
      if [[ -x "$p" ]]; then
        cand="$p"
        break
      fi
    done
    if [[ -z "$cand" && -d "$HOME/.nvm/versions/node" ]]; then
      cand="$(ls -1d "$HOME/.nvm/versions/node"/v*/bin/node 2>/dev/null | sort -V | tail -n 1 || true)"
    fi
  fi

  if [[ -z "$cand" || ! -x "$cand" ]]; then
    echo "[错误] 未找到 Node.js，请先安装 Node.js 22 或更高版本（https://nodejs.org/）。" >&2
    exit 1
  fi
  echo "$cand"
}

NODE_BIN="$(find_node)"
"$NODE_BIN" "$DIR/manage.mjs" launch-agy "$@"
