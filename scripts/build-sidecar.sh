#!/usr/bin/env bash
# Build the Python sidecar binary via PyInstaller in onedir mode.
#
# Output: sidecar-build/<os>-<arch>/ — matching the ${os}-${arch} path
# that electron-builder's extraResources consumes. `${os}` is one of
# `mac` / `linux` / `win` per electron-builder's convention;
# `${arch}` is `x64` / `arm64`.
#
# Usage:
#   SANCTUM_REPO=../sanctum ./scripts/build-sidecar.sh
#
# Environment:
#   SANCTUM_REPO   Path to a local sanctum checkout. Required.
#                  Will be `pip install`'d into the build venv as a
#                  regular (non-editable) install — PyInstaller's
#                  module analyzer doesn't freeze the source for
#                  `pip install -e` checkouts; the resulting binary
#                  hits `ModuleNotFoundError: sanctum` at startup.
#                  (Release workflow pins this to a specific commit via
#                  a worktree checkout; local builds point at the dev
#                  sibling repo.)
#   MODEL_TIER     `standard` bundles `en_core_web_sm` (~15 MB).
#                  `none` bundles no NLP model — the desktop app must
#                  download one before analysis. Default: standard.
#                  The Professional tier (`en_core_web_lg` + GLiNER,
#                  ~1.4 GB) is always downloaded at first launch via
#                  `src/main/models.ts` — never bundled.
#   BUILD_ROOT     Output directory. Default: ./sidecar-build
#   PYTHON         Python interpreter to use. Default: python3
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="${BUILD_ROOT:-$REPO_ROOT/sidecar-build}"
SANCTUM_REPO="${SANCTUM_REPO:-$REPO_ROOT/../sanctum}"
MODEL_TIER="${MODEL_TIER:-standard}"
PYTHON="${PYTHON:-python3}"

case "$(uname -s)" in
  Linux*)   OS=linux ;;
  Darwin*)  OS=mac ;;
  MINGW*|MSYS*|CYGWIN*) OS=win ;;
  *) echo "ERROR: unsupported OS: $(uname -s)" >&2; exit 2 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "ERROR: unsupported arch: $(uname -m)" >&2; exit 2 ;;
esac

OUT_DIR="$BUILD_ROOT/$OS-$ARCH"
VENV="$BUILD_ROOT/venv-$OS-$ARCH"

echo "[build-sidecar] os=$OS arch=$ARCH tier=$MODEL_TIER"
echo "[build-sidecar] sanctum repo: $SANCTUM_REPO"
echo "[build-sidecar] output:       $OUT_DIR"

if [ ! -d "$SANCTUM_REPO" ]; then
  echo "ERROR: SANCTUM_REPO=$SANCTUM_REPO does not exist" >&2
  exit 1
fi

# The venv below is created from $PYTHON, so its interpreter version is
# what every later pip install and the PyInstaller freeze inherit.
# sanctum declares requires-python = ">=3.10". macOS still ships 3.9 as
# /usr/bin/python3, which is what bare `python3` resolves to there — and
# the resulting failure surfaces deep inside a pip resolver backtrack
# with no mention of Python versions. Check up front instead.
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "ERROR: PYTHON=$PYTHON not found on PATH" >&2
  exit 2
fi

PY_VERSION="$("$PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "ERROR: $PYTHON is Python $PY_VERSION; sanctum requires >= 3.10." >&2
  echo "       Set PYTHON to a newer interpreter and re-run, e.g.:" >&2
  for candidate in python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "         PYTHON=$candidate SANCTUM_REPO=$SANCTUM_REPO $0" >&2
      exit 2
    fi
  done
  echo "         PYTHON=/path/to/python3.12 SANCTUM_REPO=$SANCTUM_REPO $0" >&2
  echo "       No python3.10+ found on PATH; install one first." >&2
  exit 2
fi

echo "[build-sidecar] python:       $PYTHON ($PY_VERSION)"

if [ ! -d "$VENV" ]; then
  "$PYTHON" -m venv "$VENV"
fi
# shellcheck source=/dev/null
if [ "$OS" = "win" ]; then
  source "$VENV/Scripts/activate"
else
  source "$VENV/bin/activate"
fi

pip install --upgrade pip wheel
pip install pyinstaller
# Force-reinstall in case a prior editable install of sanctum is
# present in this venv — pip won't replace an editable install with
# a non-editable one without the explicit reinstall flag.
pip install --force-reinstall --no-deps "$SANCTUM_REPO"
pip install "$SANCTUM_REPO[security,api,documents]"

if [ "$MODEL_TIER" = "standard" ]; then
  python -m spacy download en_core_web_sm
fi

# PyInstaller collectors:
#   --collect-all sanctum          — the entry-point package itself; the
#                                    analyzer doesn't follow the import
#                                    from `sidecar_entry.py` reliably.
#   --collect-all spacy            — bundles spaCy data files that the
#                                    default collector misses.
#   --collect-all en_core_web_sm   — bundles the Standard-tier model.
#   --collect-all presidio_analyzer
#   --collect-all presidio_anonymizer
#                                  — Presidio dynamically discovers
#                                    recognizers AND ships YAML config
#                                    under `conf/` that the engine reads
#                                    at __init__; --collect-submodules
#                                    alone leaves those data files out.
#   --name sanctum-sidecar         — deliberately NOT `sanctum.exe`, to
#                                    reduce Windows AV false-positive
#                                    collisions.
#   --onedir                       — onefile re-extracts on every launch;
#                                    unacceptable when payload reaches
#                                    hundreds of megabytes with models.

PYINSTALLER_ARGS=(
  --onedir
  --name sanctum-sidecar
  --distpath "$BUILD_ROOT/dist-$OS-$ARCH"
  --workpath "$BUILD_ROOT/work-$OS-$ARCH"
  --specpath "$BUILD_ROOT/spec-$OS-$ARCH"
  --collect-all sanctum
  --collect-all spacy
  --collect-all presidio_analyzer
  --collect-all presidio_anonymizer
  --noconfirm
)

if [ "$MODEL_TIER" = "standard" ]; then
  PYINSTALLER_ARGS+=(--collect-all en_core_web_sm)
fi

pyinstaller "${PYINSTALLER_ARGS[@]}" "$REPO_ROOT/scripts/sidecar_entry.py"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$BUILD_ROOT/dist-$OS-$ARCH/sanctum-sidecar/." "$OUT_DIR/"

echo "[build-sidecar] done: $OUT_DIR"
echo "[build-sidecar] binary: $OUT_DIR/sanctum-sidecar$([ "$OS" = "win" ] && echo .exe || true)"
