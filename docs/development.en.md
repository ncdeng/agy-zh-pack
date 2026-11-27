# How it works and development

[简体中文](development.md) | [English](development.en.md)

← Back to [README](../README.en.md)

## How it works

- The plugin is `plugin.json` plus one sidecar (`sidecars/core/sidecar.json`) in the plugin folder. When the Antigravity backend (`language_server`) finds the plugin, it starts the sidecar (`sidecars/core/main.mjs`) on the Node that comes with Antigravity. If the sidecar exits, it is started again after about 1 to 2 seconds; if the plugin folder is deleted, it is stopped.
- The sidecar runs the injector `inject.mjs`. Every 3 seconds it checks the Antigravity debugging port (the port number is in the `DevToolsActivePort` file that Antigravity writes). When it finds the main window, it injects the translator and the status bar script through the Chrome DevTools Protocol. It does not change the Antigravity install files, so it keeps working after Antigravity updates itself. Only one injector works at a time (a local single-instance lock).
- The sidecar also serves the plugin panel (`lib/panel.mjs`, on `127.0.0.1` only), the reopen on a start without the flag (`lib/relaunch.mjs`), and version updates (`lib/update.mjs`).
- Reopen: the sidecar is a child process of Antigravity, so it stops when Antigravity closes. A script that runs apart from Antigravity does the reopen. On Windows it is `relaunch-antigravity.ps1` in the data folder, started through Explorer (or WMI if that fails). On macOS it is a shell script that runs in the background with `nohup`. The script asks Antigravity to close, ends it if it is still running after 10 seconds, and opens it again with `--remote-debugging-port=0`. Each step goes into `relaunch.log`.
- The status bar listens in the page to the data between the app and the local backend. It does not change the requests that the app sends. From Antigravity 2.35, the app uses one WebSocket (`/connect-websocket` on the same origin; the status bar listens only to this connection to the local backend) by default: the status bar wraps the `send` of `WebSocket`, takes the CSRF token from the frames that the app sends, and reads only the replies of the state stream, the account and the quota. If the WebSocket cannot connect and the app uses HTTP (as in 2.34 and earlier), the status bar wraps `fetch` and listens to the grpc-web+json data. It also calls a few read-only local APIs: quota, the signed-in account (email and plan; the email is used only in the page to make the account ID and the masked text, and is not written to a file), the actual model name, subagent status and steps, and the token usage and time of each call (for the cost and the call details).
- Every 30 seconds, the injector saves today's cost from the page into `cost-day.json`. It also finds the conversations you used today in `~/.gemini/antigravity/brain/` and gives them to the status bar, together with the ID, creation time and change time of each conversation in the last 32 days from the conversation database folder (`conversations`), because the backend's conversation list shows only some conversations. So today's amount is kept when Antigravity restarts. Only conversation IDs, amounts, and call and token counts for each model are saved. It also writes the day's totals and limit changes to `usage-history.json`, and gives the last 31 days to the daily usage panel.
- Every 30 seconds, the injector checks the agy CLI conversation database folder (`~/.gemini/antigravity-cli/conversations`). It opens the changed databases read-only, reads the time, model, token counts, time to first token and generation time of each call (normally it checks only the databases that `fs.watch` reports as changed, and continues from the last row it read; every 10 minutes it checks and reads all of them again), and writes the daily totals to `cli` in `usage-history.json`. It also records the days on which each database has calls (`cli-index.json`), so for call details older than 32 days it reads only the databases of that day. When the call details need the CLI calls of a day, or the daily usage panel needs all history for `all`, the page asks the injector through `window.__agyZhAsk`, which the injector adds with `Runtime.addBinding` of the DevTools Protocol. The injector answers only with read-only usage numbers and CLI conversation titles.
- It does not write Antigravity's look settings. Only if you choose to restore on uninstall does it write the saved theme colors back to `~/.gemini/config/config.json` (only if you used the author's color theme in an earlier version; and to `%APPDATA%\Antigravity\app_storage.json` if you installed the old v1.0.0). The uninstaller also removes the entries that Antigravity keeps for this plugin.
- It connects to only three places: Google Fonts for the status bar icons; api.github.com for the latest commit of this repository, then jsDelivr (or raw.githubusercontent.com) for its data files ([Online updates](../README.en.md#updates), which you can turn off); and the new version when you click "更新" (update) in the plugin panel.

## Run from source, build and release

**Run from source** (without installing the plugin): you need Node.js 22.13 / 23.4 or later (it uses the built-in `WebSocket`, `fetch` and `node:sqlite`).

```bash
node inject.mjs
```

- When run this way, the data files are kept in the same folder as `inject.mjs`. If an injector is already running (including the installed plugin), a new one exits.
- Start Antigravity with `--remote-debugging-port=0`. On Windows, run `powershell -ExecutionPolicy Bypass -File debug-port.ps1` once to add the flag to the shortcuts; on macOS, run `./macos/launch-agy.command` (or `open -a Antigravity --args --remote-debugging-port=0`); see [macos/README.md](../macos/README.md).
- After you change `statusbar.js` or a file in `i18n`, open windows update automatically. You do not need to restart. After you change `inject.mjs`, restart the injector.
- To add your own styles to the page (for example, a different reply font), put a `style.css` in the data folder (when run from source, the folder of `inject.mjs`). The injector loads it automatically. Without this file, no styles are changed.
- If you change the logic in `i18n/translator.js`, add 1 to its `VERSION`. Open windows then switch to the new translator.
- Before a release, run `node tools/dev/probe.mjs all` while Antigravity is open. Through the debugging port, it opens the plugin panel, the status bar, the daily usage panel and the call details of today, reads the text and hover text, and gives OK / WARN / FAIL for each item. The unit tests check that the functions calculate correctly; this checks that the features show in the real Antigravity. Other commands include `plugin` (the text and switches of each part of the plugin panel; from v2.0.15 `all` runs it too), `speed` (the speed page of the daily panel and the by model view of the call details), `missing` (the untranslated texts that were recorded), `calls <day>`, `miss`, `ckpt`, `english`, `swarm` and `eval`; run `node tools/dev/probe.mjs help` to see all. Add `--shot <folder>` to also save screenshots, and `--ssh <host>` to run it on another macOS computer (it copies the script there, runs it with the Node of Antigravity, and copies the screenshots back). All commands are read-only, except `check`, `update` and `english`.
- After an Antigravity update, run `node tools/find-ui-strings.mjs` while Antigravity is open to find new UI text. The result is in `dist/ui-strings.md`; NEW marks text that was not in the last run. The extraction is a guess by rules and includes strings from code, so pick the UI text by hand before you translate it.
- If the injector starts long after Antigravity opened, the status bar shows `Press Ctrl+R to reload this window`. Press Ctrl+R once to reload the window.

**Tests**: `node --test "tests/*.test.mjs"` (needs Node.js 22.13 or later; the CLI database test uses `node:sqlite`). The test data is written in the tests. The tests do not read the usage records or conversation databases on your computer. GitHub Actions also runs the tests at each push (`.github/workflows/test.yml`). `inject.mjs` and `statusbar.js` are not modules, so the tests cut their functions out by markers. If you change the code near these functions, a test tells you to update it.

**Release** (needs the author's signing key): first finish the code, the README and the test records in `docs/testing.md` (each in Chinese and English), `git add` new files, and write the commit message and the release notes. Keep the first line of the commit message (the title) short, and put the details in the body: the GitHub file list shows only the title and cuts long ones. Then run

```
node tools/publish.mjs <version> --title "<release title>" --notes <release-notes.md> --message <commit-message.txt>
```

The script does the steps below in order. If a step fails, the script stops and tells you which step it stopped at. After you find the cause, add `--from <step>` to continue. Before a release, you can add `--check` to only check the conditions and run the tests, without changing files.

1. `test`: runs the tests.
2. `bump`: changes `version` in `plugin.json` and `PACK_VERSION` in `inject.mjs` to the new version.
3. `sign`: `node tools/release.mjs sign` creates and signs `plugin-manifest.json` from the file list in `tools/plugin-files.mjs`.
4. `build`: `node package/build.mjs` checks the signed manifest and creates `dist/agy-zh/` and a zip with the same name; the zip is then copied to the English name `agy-zh-pack-v<version>.zip` (GitHub removes Chinese characters from file names).
5. `commit`: commits (including `plugin-manifest.json`), tags `v<version>`, and checks the signed manifest against the files in the tag. One-click updates get the files from `@v<version>` on jsDelivr, so the tag must contain the signed manifest.
6. `push`: pushes main and the tag.
7. `release`: publishes on GitHub Releases, uploads the zip, and downloads it again to check the sha256.
8. `meta`: changes `latest` and `date` in `data/meta.json` to the new version and pushes to main. Only then do users of older versions see the new-version notice, so this step is the last one.

Before it starts, the script also checks that you are on main, that the local main is not behind GitHub (the price workflow can push to main every day; if it is behind, run `git pull --rebase` first), that there are no untracked new files, and that the tag does not exist yet.

The private key is kept on the author's computer, encrypted with Windows DPAPI (created by `tools/release.mjs keygen`). `node tools/release.mjs export <file>` backs it up to a file that only the current account can read; `node tools/release.mjs import <file>` restores it after a system reinstall or on a new computer. Without the private key, no new version can be signed, and installed plugins get no more updates.

## Files

| File | Purpose |
|---|---|
| `plugin.json` | Name, version and icon of the plugin |
| `sidecars/core/sidecar.json` | How the sidecar starts (the Node that comes with Antigravity) and the side panel |
| `sidecars/core/main.mjs` | Sidecar entry: sets the data folder and starts the injector, panel and reopen check; restarts itself when the plugin files are replaced |
| `lib/panel.mjs` | Plugin panel (web page and API) |
| `lib/relaunch.mjs` | Asks or reopens when Antigravity starts without the debugging port flag |
| `lib/update.mjs` | Version updates: signature check, download, backup, replace; holds the author's public key |
| `lib/remote-source.mjs` | Chooses the address and the commit for online updates (asks GitHub for the latest commit; if that fails, uses the address with the newest meta.json) |
| `plugin-manifest.json` | Signed manifest: version, sha256 and size of each plugin file, Ed25519 signature |
| `assets/logo.svg` | Plugin icon |
| `inject.mjs` | Injector: connects to the Antigravity debugging port and injects the files below; keeps the ledger for today's cost; online updates |
| `debug-port.ps1` | Adds and removes the start flag `--remote-debugging-port=0` on the Antigravity shortcuts on Windows |
| `statusbar.js` | Usage status bar and cost estimate (runs in the page) |
| `i18n/translator.js` | Translator (runs in the page) |
| `i18n/zh-CN.json` | Dictionary: English UI text → Chinese |
| `i18n/zh-CN.rules.json` | Regex rules: relative times, thinking time, retirement dates and other text with numbers |
| `data/prices.json` | The online price table (GitHub Actions updates it daily from the official pricing pages) |
| `data/meta.json` | The latest version number (changed at each release) |
| `tools/plugin-files.mjs` | Which files belong to the plugin (used for signing, building and installing) |
| `tools/release.mjs` | Release signing: key creation, signing, checking, key backup and restore |
| `tools/dev/probe.mjs` | Acceptance probe: through the debugging port, opens the panels, reads the UI text and hover text, takes screenshots, and calls the plugin panel API (version, check for and install updates); can run on another macOS computer through ssh; not in the installer |
| `tools/find-ui-strings.mjs` | Finds UI text without a translation: gets the front-end scripts from the running Antigravity, reads the source of the built-in plugins, compares with the dictionary, and writes `dist/ui-strings.md` |
| `tools/publish.mjs` | Release with one command: tests, version number, signing, build, commit and tag, push, GitHub release, `data/meta.json` |
| `tools/update-prices.mjs` | Updates `data/prices.json` from the official pricing pages |
| `.github/workflows/update-prices.yml` | Runs that script every day; commits when a price changes and opens an issue when there is a problem |
| `.github/workflows/purge-cdn.yml` | Clears the jsDelivr cache after the dictionary or `data/` is pushed |
| `.github/workflows/test.yml` | Runs the tests in `tests/` at each push |
| `tests/` | Tests: limit calculation, data file reading and writing, CLI databases, translator, data files, syntax and version numbers |
| `package/app/setup.mjs` | Install, uninstall |
| `package/build.mjs` | Builds the package |
| `macos/` | macOS scripts for running from source (the v1.x way); to install the plugin, use the package |
| `docs/images/statusbar.png`, `docs/images/panel.png` | The screenshots in the README |
| `docs/testing.md`, `docs/development.md` | Test records; how it works and development (this page). Each has an English version `*.en.md` |

For the files in the data folder, see [Data](../README.en.md#data).
