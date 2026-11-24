# Contributing to Moggtify

Thanks for helping make Moggtify better. This page covers setup, the preview tooling, tests, code style and the few product rules that keep the project focused.

## Safety first

Moggtify patches a real application, so please be careful while developing.

- **Never test against your real Spotify without a backup.** A loader built from source (`go run .` or `.\build.ps1`) is the real thing: Install, Repair and Delete act on your actual Spotify and Spicetify setup.
- Prefer the safe tools: the [UI previews](#working-on-the-loader-ui) mock the Go bridge, the [unit tests](#tests) use throwaway folders, and the [sandbox tests](#sandbox-integration-tests) work on a copy of Spotify.
- For end-to-end runs, use Windows Sandbox or a VM, or back up first. Close Spotify, then:

  ```powershell
  New-Item -ItemType Directory -Force "$HOME\mogg-backup" | Out-Null
  Copy-Item "$env:APPDATA\Spotify" "$HOME\mogg-backup\Spotify" -Recurse
  Copy-Item "$env:APPDATA\spicetify" "$HOME\mogg-backup\spicetify" -Recurse   # if it exists
  ```

## Setup

You need Windows 10 or 11, Git, [Go](https://go.dev/dl/) (version in [`go.mod`](go.mod)) and PowerShell 5.1 or later. For UI work, also Node.js 18+ and Microsoft Edge.

```powershell
git clone https://github.com/caedesdev/moggtify
cd moggtify
go test ./...
.\build.ps1          # → dist\Moggtify.exe
```

The [project layout](README.md#project-layout) is in the README. Two contracts tie the pieces together:

- **Loader ↔ Go bridge.** Documented at the top of [`app.go`](app.go): `mogg_state`, `mogg_install`, `mogg_repair`, `mogg_uninstall`, `mogg_open`, `mogg_quit`, plus the `progress`, `done` and `error` events delivered through `window.__mogg`. [`tools/preview/mock-bridge.js`](tools/preview/mock-bridge.js) implements the same contract for previews; keep the two in sync.
- **In-Spotify bundle.** `buildExtras` in [`catalog.go`](catalog.go) concatenates `window.__MOGG_CONFIG`, `window.__MOGG_THEMES` (`runtime/themes.json`), `window.__MOGG_EXTENSIONS` (`runtime/extensions.json`), `runtime/moggtify.js` and every `runtime/extensions/<id>.js` into the single Spicetify extension `moggtify.js`.

## Product rules

- The loader has exactly three actions: **Install**, **Repair** and **Delete Moggtify**. Settings, toggles and new features belong in the Hub inside Spotify.
- UI copy is English: short, plain, confident.
- Moggtify is not affiliated with Spotify. Never use Spotify's logo; a stylized Spotify window mock-up is fine.
- Error messages reach users verbatim (the loader shows the engine's message). Write them as complete sentences that say what to do next.

## Working on the loader UI

`ui/index.html` is one self-contained file: inline CSS, JS and SVG, no external requests, no web fonts, no frameworks. It is embedded into the exe at build time.

Build a preview with the mocked bridge, then open it in any browser:

```powershell
node tools/preview/build.mjs ui/index.html dist/preview/index.html
```

Steer the mock with query parameters, for example `dist/preview/index.html?state=outdated&click=repair&hold=patch`:

| Parameter | Values |
|---|---|
| `state` | `fresh` (default), `installed`, `outdated`, `inactive`, `nospotify`, `store` |
| `mode` | `uninstall` (as if opened from Windows Settings) |
| `click` | e.g. `install` or `uninstall,confirm`: clicks `[data-action]` / `[data-confirm]` after load |
| `hold` | step id where the running operation pauses, e.g. `patch` |
| `fail` | step id where the operation fails |
| `speed` | milliseconds per step (default 450) |

Render the key states to PNG with headless Edge (it uses a throwaway profile, so your own Edge is not touched):

```powershell
powershell -NoProfile -File tools/preview/screenshot.ps1 -Html ui/index.html -Out dist/shots
```

That produces `fresh`, `installed`, `outdated`, `nospotify`, `running`, `success`, `error` and `uninstall`. Useful options: `-Width` and `-Height` (default 1040×680; also check the 900×600 minimum and 1400×900), `-Shots "name=querystring"` for custom states, and `-NoMock` to capture a page as it is.

Keep these hooks, the preview tooling relies on them:

- action buttons carry `data-action="install"`, `"repair"` or `"uninstall"`
- the confirm button of the delete confirmation carries `data-confirm`
- the page calls `mogg_state()` once it has loaded

Motion: few, purposeful animations on `transform` and `opacity`, at most one continuous ambient animation, and respect `prefers-reduced-motion`.

## Working on the in-Spotify runtime

`runtime/` is everything that runs inside Spotify:

- `moggtify.js`: the top-bar button and the Hub
- `themes.json`: the designs
- `extensions.json` and `extensions/<id>.js`: the extras, one entry and one file each

To see the exact file Install writes into Spicetify:

```powershell
go run . --dump-extension dist/moggtify.js
```

- Prefer Spicetify's stable class names (`.main-topBar-…`, `.main-actionButtons`) and `data-testid` attributes over Spotify's hashed class names.
- Colors flow through Spicetify's `--spice-*` variables; a design sets those, exactly like a Spicetify theme.
- `node tools/check-designs.mjs` validates `runtime/themes.json`: schema and WCAG contrast for every design. CI runs it; add `--strict` to fail on advisory warnings too.
- The bundler wraps each extra in `try/catch`, so one broken extra can't take down the others. Keep extras self-contained anyway.

## Tests

```powershell
go vet ./...
go test ./...
```

Unit tests point `%APPDATA%` and `%LOCALAPPDATA%` at a temp folder and never start or stop Spotify. If Node.js is on `PATH`, the generated bundle is also checked with `node --check`.

### Sandbox integration tests

Two opt-in tests in [`sandbox_test.go`](sandbox_test.go) run the real Spicetify engine against a copy of Spotify. They never start or kill processes and download nothing.

- `TestSandboxPatch` (`MOGG_SANDBOX=1`) writes the config, runs backup and apply, re-applies, then restores and expects a clean client.
- `TestSandboxSpotifyUpdate` (`MOGG_SANDBOX=update`) simulates a Spotify update by dropping a fresh `xpui.spa` next to the patched client, re-applies the way Repair and the update helper do, then restores.

You need:

1. **Spicetify CLI**, installed in `%LOCALAPPDATA%\spicetify` or on `PATH`.
2. **A copy of an un-modded Spotify folder** (`Apps\xpui.spa` present). Close Spotify before copying `%APPDATA%\Spotify`. For the update test, keep a spare copy of that `xpui.spa` as well.
3. **A sandbox Spicetify config folder** whose `config-xpui.ini` points at the copy. Create it **before** the first run; if it's missing, Spicetify generates one with your **real** Spotify paths.

   ```ini
   [Setting]
   spotify_path = D:\mogg-sandbox\Spotify
   prefs_path   = D:\mogg-sandbox\Spotify\prefs
   ```

4. **The Marketplace** in that folder (`CustomApps\marketplace`, for example copied from `%APPDATA%\spicetify`). The patch test checks that it gets injected into the client.
5. **A state folder** for Spicetify's backups (`SPICETIFY_STATE`). It can start empty.

Run them in a terminal of their own: the unit tests read the same variables, so a later `go test ./...` in that shell would work on your copy.

```powershell
$env:MOGG_SPOTIFY_DIR = "D:\mogg-sandbox\Spotify"
$env:SPICETIFY_CONFIG = "D:\mogg-sandbox\spicetify"
$env:SPICETIFY_STATE  = "D:\mogg-sandbox\state"

$env:MOGG_SANDBOX = "1"
go test -run SandboxPatch -v

$env:MOGG_SANDBOX   = "update"
$env:MOGG_FRESH_SPA = "D:\mogg-sandbox\xpui.spa"   # the spare, un-modded xpui.spa
go test -run SandboxSpotifyUpdate -v
```

## Code style

- **Go:** `gofmt` (CI fails on unformatted files) and a clean `go vet`. Keep dependencies minimal: the only direct ones are `go-webview2` and `golang.org/x/sys`. Comments explain *why*, not *what*.
- **PowerShell:** scripts must run on Windows PowerShell 5.1. They are checked out with CRLF.
- **HTML and JavaScript:** plain modern JS, no build step, no frameworks, 2-space indent.
- **Whitespace:** [`.editorconfig`](.editorconfig) and [`.gitattributes`](.gitattributes) keep LF everywhere except PowerShell scripts.

## Pull requests

- One topic per pull request, with a short description of the user-visible change.
- For UI changes, attach before/after screenshots from `screenshot.ps1`.
- CI (gofmt, vet, tests, design check, build) must be green. Every CI run attaches the built `Moggtify.exe` as an artifact, so reviewers can try it.

## Reporting bugs

Use the [bug report form](https://github.com/caedesdev/moggtify/issues/new/choose). The error text from the loader (the **Copy** button on the error screen) plus your Windows and Spotify versions usually say it all. Problems that also happen with plain Spicetify belong to [spicetify/cli](https://github.com/spicetify/cli/issues).

## Releases (maintainers)

1. Bump `AppVersion` in [`paths.go`](paths.go) and the version fields in [`winres/winres.json`](winres/winres.json).
2. Commit, then tag and push:

   ```powershell
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. The **Release** workflow checks that the tag matches `AppVersion`, runs the tests, builds `Moggtify.exe` and publishes it with `Moggtify.exe.sha256` and generated release notes. Tags with a suffix, such as `v1.1.0-beta.1`, become pre-releases.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
