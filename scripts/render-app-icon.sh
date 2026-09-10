#!/usr/bin/env bash
# 使用项目锁定的 Tauri CLI，从单一 SVG 源生成全部桌面和移动端图标。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_DIR="${REPO_ROOT}/src-tauri/icons"
SVG="${ICON_DIR}/icon-source.svg"

if [[ ! -f "$SVG" ]]; then
  echo "错误：未找到图标源文件 $SVG" >&2
  exit 1
fi

cd "$REPO_ROOT"
corepack pnpm tauri icon "$SVG" --output "$ICON_DIR"
