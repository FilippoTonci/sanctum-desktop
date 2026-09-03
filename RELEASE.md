# Releasing Sanctum Desktop

One deliberate release per click. Nothing is released by merging to
`main` — you decide when, and you decide the version.

## Cutting a release

1. **Actions → Release → Run workflow.**
2. Leave the branch on `main`, type a version with **no leading `v`**
   (e.g. `0.1.0-rc.1`), and click **Run workflow**.

That is the whole ritual. The workflow does the rest:

| Job                         | What it does                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare`                   | Validates the version, bumps `package.json` + `package-lock.json`, commits to `main`, tags `v<version>`, and pins the `sanctum` backend to one commit |
| `build-macos`/`build-linux` | Check out the **tag**, build the PyInstaller sidecar, then the installer                                                                              |
| `publish`                   | Attaches the artifacts and publishes the GitHub release                                                                                               |

Bad input fails in seconds, before a runner starts: a version that
isn't semver, a tag that already exists, or a dispatch from a branch
other than `main`.

## What the download site links to

Every release carries each artifact twice — once under its versioned
name, once under a name that never changes:

| Moving name                       | Resolves via                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Sanctum-Desktop-arm64.dmg`       | `https://github.com/FilippoTonci/sanctum-desktop/releases/latest/download/Sanctum-Desktop-arm64.dmg` |
| `Sanctum-Desktop-x86_64.AppImage` | …`/releases/latest/download/Sanctum-Desktop-x86_64.AppImage`                                         |
| `sanctum-desktop-amd64.deb`       | …`/releases/latest/download/sanctum-desktop-amd64.deb`                                               |

The site hardcodes those URLs and never needs editing. The versioned
originals stay attached, so older builds remain reachable.

This is why releases are published **neither as drafts nor as
pre-releases** — both are skipped by `/releases/latest/download/`, and
either would break every link on the site. The "unsigned, testers only"
warning therefore has to carry its own weight: it is prepended to the
release notes by the `publish` job.

## After the run

Three things worth checking on a release you intend to hand to anyone:

```bash
# 1. The permalink resolves for a logged-out visitor.
curl -sIL -o /dev/null -w '%{http_code}\n' \
  https://github.com/FilippoTonci/sanctum-desktop/releases/latest/download/Sanctum-Desktop-arm64.dmg

# 2. The sidecar is actually inside the app — the one failure that looks
#    exactly like success. See scripts/before-pack.cjs.
ls "release/mac-arm64/Sanctum Desktop.app/Contents/Resources/sidecar"

# 3. The version in Help → About matches the tag.
```

## Not covered here

Signing, notarization, auto-update channels, and the Windows build are
WS6 items that have not landed — see the roadmap in
[`README.md`](README.md). `build-windows` in
[`.github/workflows/release.yml`](.github/workflows/release.yml) stays
`if: false` until a signing certificate exists, and `publish` does not
wait on it.
