"""PyInstaller entry point for the packaged Sanctum sidecar binary.

The `sanctum` package is installed into the build venv before PyInstaller
runs; this file is the `--collect-all sanctum` root. At runtime the
binary dispatches to the full Click CLI so `serve` (the main use case)
plus `config` / `version` (useful for debug) are all available.

The desktop main process always invokes it as:

    sanctum-sidecar serve --port 0 --token-stdin

which mirrors the dev-mode `sanctum serve --port 0 --token-stdin` path,
so `src/main/paths.ts::resolveSidecarCommand` only has to branch on
the executable name, not the argv shape.
"""

from sanctum.cli.commands import cli


if __name__ == "__main__":
    cli()
