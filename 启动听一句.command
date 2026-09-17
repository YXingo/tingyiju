#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
RUNTIME_DIR="$HOME/Library/Caches/tingyiju"
VENV_DIR="$RUNTIME_DIR/venv"
REQUIREMENTS="$PROJECT_DIR/requirements.txt"

find_python() {
  local candidate
  for candidate in /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(not ((3, 10) <= sys.version_info[:2] <= (3, 12)))' 2>/dev/null; then
        command -v "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

PYTHON_BIN="$(find_python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "未找到 Python 3.10–3.12。请先安装 Python 3.11，再重新双击启动。"
  read -k 1 "?按任意键关闭…"
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "首次启动：正在创建本地语音环境…"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

REQ_HASH="$(shasum -a 256 "$REQUIREMENTS" | awk '{print $1}')"
INSTALLED_HASH="$(cat "$VENV_DIR/.requirements-hash" 2>/dev/null || true)"
if [[ "$REQ_HASH" != "$INSTALLED_HASH" ]]; then
  echo "首次启动：正在安装 Kokoro，所需时间取决于网络速度…"
  "$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -r "$REQUIREMENTS"
  printf '%s' "$REQ_HASH" > "$VENV_DIR/.requirements-hash"
fi

export HF_HUB_DISABLE_XET=1
export PYTHONUNBUFFERED=1
exec "$VENV_DIR/bin/python" "$PROJECT_DIR/server.py"
