<div align="center">

# agy-zh-pack

[简体中文](README.md) | [English](README.en.md)

**An unofficial Simplified Chinese pack for Antigravity Desktop (Windows)**

Chinese UI translation · usage status bar above the input box · optional color theme

[![Download](https://img.shields.io/github/v/release/ncdeng/agy-zh-pack?label=download&color=D97757)](https://github.com/ncdeng/agy-zh-pack/releases/latest)
[![License](https://img.shields.io/github/license/ncdeng/agy-zh-pack)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6)

![The usage status bar above the input box](assets/statusbar.png)

<sub>Real screenshot: a long conversation</sub>

</div>

> [!WARNING]
> This is a third-party project. It has no connection with Google. By default it only changes what you see on your own computer and only reads local data. Read [Risks](#risks) before you install.

> [!IMPORTANT]
> **From Antigravity 2.33.0, old versions of this pack (v1.2.1 and earlier) stop working**: the UI goes back to English and the status bar does not show. The cause: 2.33.0 no longer opens its debugging port by default. Download v1.3.0 or later and run `一键安装.cmd` (install) again. See [Shortcut flag](#shortcut-flag).

> [!NOTE]
> **"Unlock 512K context" was removed (2026-11-20)**: the official default context limit of Antigravity is now higher, and the unlock would lower the limit for Claude. If you installed an old version and turned the unlock on, download the latest version and run `一键安装.cmd` (install) again. See [Context limit](#context-limit).

> [!NOTE]
> This pack is made for Chinese users. It translates the Antigravity UI into Simplified Chinese. The status bar text is in English, but its hover tooltips, the installer prompts and the file names in the download are in Chinese. If you only want the status bar, see [Status bar only](#status-bar-only-no-translation).

## Quick start

1. Install Antigravity and sign in once.
2. Download the latest `agy-zh-pack-v<version>.zip` from [Releases](https://github.com/ncdeng/agy-zh-pack/releases/latest). Extract it to any folder. Do not run it from inside the zip.
3. Double-click `一键安装.cmd` (install). If Windows shows "Windows protected your PC", click "More info", then click "Run anyway".
4. The installer asks one optional question: use the author's color theme. If you are not sure, press Enter (the answer is "no").
5. You do not need to close Antigravity. After the install, press `Ctrl+R` once in Antigravity. The status bar appears. If Antigravity was started without the debugging port flag this time, the installer asks you, and after Enter it restarts Antigravity once.
6. From now on, open Antigravity from the Start menu, desktop or taskbar icon. The installer added a start flag to these shortcuts.

To change the color theme later, double-click `配色开关.cmd` (color toggle). To uninstall, double-click `一键卸载.cmd` (uninstall).

## Defaults

| Feature | Default | Changes what is sent to Google? |
|---|---|---|
| Chinese UI translation | On | No. It only changes the local display |
| Usage status bar | On | No. It only reads local data |
| Author's color theme | Off | No. It only changes the theme colors of your local Antigravity |

Zoom, font and contrast are never changed.

## Features

### Chinese UI translation

Menus, settings, buttons and hints are shown in Chinese (a dictionary of 3125 entries and 60 regex rules). Conversation content, code and file names are not translated.

#### Status bar only (no translation)

Delete `%LOCALAPPDATA%\AgyZhPack\i18n\zh-CN.json`, then press `Ctrl+R` once in Antigravity. The UI goes back to English and the status bar stays. A reinstall puts the file back.

### Usage status bar

Two fixed lines above the input box. Each item is a colored icon with text in the same color. Like ccline, the status bar text is in English. Hover over any item to see a detailed tooltip (in Chinese).

| Line | Example | Meaning |
|---|---|---|
| Line 1 | `gemini-flash-worker-agy` | Model: the name in the UI, plus the model name that the API actually returns. For Gemini models, it turns yellow when the two do not match |
| | `89% · 456k / 512k · compacted 3×` | Context: percent used, used / limit, and how many times it was auto-compacted |
| | `450k · 99% hit` | Cache: tokens read from cache in the last call, and the hit ratio |
| | `$17.81` | Total cost of this conversation (subagents included). Hover to see the input, cache and output tokens of the last call and the cost of each |
| | `$17.85 today` | Total cost today (from local midnight, all conversations). Click it to open the [daily usage panel](#daily-usage-panel) |
| | `running` | The model is generating |
| Line 2 | `6.9s` | Time to first token |
| | `169 tok/s` | Output speed |
| | `0% · 16:44` | 5-hour limit: percent used (10-cell bar) and reset time |
| | `41% · Sat 16:08 · ↑15%` | Weekly limit: percent used, reset time, and how far ahead (↑) or behind (↓) an even pace you are |
| Subagents | `self · … · running` | Each running subagent gets its own line. The line closes about 10 seconds after the subagent ends. In a subagent window, the bar shows that subagent's own data |

The look follows the cometix theme of [CCometixLine](https://github.com/Haleclipse/CCometixLine) (ccline, a status line for Claude Code) by Haleclipse: two lines, colored icons with text in the same color, `|` between items, `·` between numbers in one item, and 10-cell bars for the limits. This project does not use ccline code. The status bar was written again for Antigravity.

#### Daily usage panel

Click `$x today` in the status bar. A panel opens above the status bar. Click it again, click outside the panel, or press `Esc` to close it.

- **Bar chart**: the estimated cost of each day in the last 7 or 30 days, with one color for each model. Hover over a bar to see that day's details.
- **Table**: one row for each day, with cost, conversations, calls, input / cache / output tokens, cache hit ratio, and how many percentage points of the weekly limit were used that day (Gemini group and Claude group separately).
- **Bottom lines**: the total and daily average for the period; for each limit group, how much is used now and how much was used in the period, plus an estimate of how much cost one percent of the weekly limit is worth.

The data is kept in `usage-history.json` in the install folder for 90 days. It holds only amounts, call counts, token counts and limit ratios, not conversation content. After the install, the injector fills in earlier days once: it opens Antigravity's own conversation databases read-only (`%USERPROFILE%\.gemini\antigravity\conversations\*.db`), reads the time, model and token counts of each call, groups them by day, and the status bar prices them with its price table. Filled-in days have no limit data (nobody recorded it then). This needs Node.js 22.5 or later (the built-in `node:sqlite`); the `node.exe` in the package meets this. It depends on Antigravity's internal storage format, so if that format changes, earlier days cannot be filled in; other features are not affected. The weekly limit is counted from the changes that the injector sees: limit used while Antigravity is closed (for example with the agy CLI) is counted on the next day that the injector sees it.

#### How cost is calculated

Cost = tokens × the public API list price from Google / Anthropic, in US dollars. **This is an estimate, not what you are charged.** Subscriptions use quota, not money.

<details>
<summary>Price table (USD per million tokens)</summary>

| Model | Input | Cache read | Output (thinking included) |
|---|---|---|---|
| Gemini 4 Neon (includes Orchestrator (Neon) planning) | $3 | $0.15 | $15 |
| Gemini 4 Carbon / Argon (includes Orchestrator planning) | $2 ($4 from 12-01) | $0.10 ($0.20 from 12-01) | $10 ($20 from 12-01) |
| Gemini 4 Hydrogen (includes the Orchestrator execution model) | $1.50 | $0.075 | $7.50 |
| Gemini 3.8 Flash | $0.75 ($1.50 from 2027-01-01) | $0.075 ($0.15 from the same day) | $3.75 ($7.50 from the same day) |
| Claude Opus 5.5 | $4 | $0.20 | $20 |
| Claude Sonnet 5.5 | $2 | $0.10 | $10 |

- Claude cache writes use the 5-minute cache price: Opus 5.5 $5, Sonnet 5.5 $2.50.
- GPT-OSS 120B has no price and is not counted.
- Sources: the Google AI Studio pricing page (2026-11-16; Neon 2026-11-19) and the Anthropic list prices (2026-11-03). In Antigravity, Claude is called through Google Vertex, so the real price can be different.
- The prices are in `PRICES` in `statusbar.js`. Change them there if prices change.
- Today's cost: the sum of calls after midnight in the conversations you used today. The amount for each conversation is saved in `cost-day.json` in the install folder, so it is not reset when Antigravity restarts. It starts again from zero after midnight.

</details>

### Optional: the author's color theme

A warm white color theme in the Claude style. Off by default.

| Theme | Background | Text | Accent |
|---|---|---|---|
| Light | `#FAF9F5` | `#141413` | `#D97757` |
| Dark | `#262624` | `#FAF9F5` | `#D97757` |

- It only changes the theme colors. Zoom, font and contrast stay the same.
- Before it changes them, it saves your old colors in `%LOCALAPPDATA%\AgyZhPack\originals.json`. Switching back or uninstalling restores them from that file.
- The installer asks once (Enter = no). After the install, double-click `配色开关.cmd` (color toggle) to switch it on or off.
- The colors are stored in Antigravity's own settings file (`customThemeSeedsLight` / `customThemeSeedsDark` in `%USERPROFILE%\.gemini\config\config.json`). Antigravity writes this file back while it runs, so the toggle closes Antigravity first, changes the colors, and opens it again.

### Context limit

v1.1.0 to v1.3.0 had an optional "unlock 512K context". At that time, Antigravity Desktop auto-compacted the context at about 256K tokens. The unlock added `checkpointConfig.maxTokenLimit = 512000` to the request, which raised the limit to 512K tokens.

This feature was removed on 2026-11-20 because the official default limit is now higher. On Antigravity 2.33.0, with the unlock off, a new conversation shows these limits in the status bar:

| Model | Official default limit |
|---|---|
| Gemini 4 Neon | 512k |
| Gemini 4 Carbon | 512k |
| Claude Opus 5.5 | 840k |

With these defaults, adding 512000 does nothing for Gemini, and it lowers the limit for Claude from 840k to 512k.

- **If you installed an old version and turned the unlock on**: download the latest version and run `一键安装.cmd` (install) again. The installer deletes the old setting (`config.json` in the install folder). After the upgrade, `上下文开关.cmd` (context toggle) in the old folder has no effect.
- **If you run from source**: `inject.mjs` no longer reads `config.json`. You can delete that file.

## Shortcut flag

Before Antigravity 2.33.0, the main process always opened a Chromium remote debugging port when it started, and the injector used it to reach the window. From 2.33.0, the port opens only when Antigravity starts with the flag `--remote-debugging-port`.

- The installer adds `--remote-debugging-port=0` (`0` = a random port) to the Antigravity shortcuts in the Start menu, on the desktop and on the taskbar. The uninstaller removes it. Only shortcuts whose target is `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe` are changed.
- Open Antigravity from these shortcuts. If you double-click `Antigravity.exe` directly, or open it in another way, the UI stays in English.
- After an automatic update, Antigravity can rewrite its shortcuts, or restart by itself without the flag. When the injector cannot find the port while Antigravity is open, it checks every 2 minutes: if a shortcut lost the flag, it adds the flag again; if Antigravity is open without the flag, it shows one notification in the lower-right corner. Then close Antigravity and open it again from a shortcut. When Antigravity is closed, it does not check (it looks for `%APPDATA%\Antigravity\lockfile`), so it does not start PowerShell again and again in the background.
- `debug-port.ps1` adds, removes and checks the flag. To check by hand: `powershell -ExecutionPolicy Bypass -File %LOCALAPPDATA%\AgyZhPack\debug-port.ps1 -Mode check`.

## Risks

Read this section before you decide to use the pack.

- Section 6 of the Antigravity additional terms of service says you must not abuse, harm or interfere with the service, including "using the Service in connection with products not provided by us". A breach can get your Antigravity and Gemini CLI accounts suspended or terminated. This project is a third-party tool. The author cannot promise that using it does not break the terms.
- This project only changes the local UI. The status bar only reads local data and does not change what is sent to Google.
- This project depends on the internal page structure and APIs of Antigravity. After an Antigravity update, some features can stop working, and new UI text shows in English until the dictionary is updated.
- The shortcut flag opens a debugging port on `127.0.0.1` on your computer (Antigravity before 2.33.0 opened it by default). Other programs on your computer can use this port to control the Antigravity window. If you do not accept this, do not use this project.

## What the installer does

- It copies the files to `%LOCALAPPDATA%\AgyZhPack`. The pack includes `node.exe` (the official Node.js program; its license is in `app\node-LICENSE.txt`), so you do not need to install Node.js.
- When you upgrade, it deletes the `config.json` left by an old version (the old "unlock 512K context" setting).
- It does not change zoom, font or contrast. It changes colors only if you choose the author's color theme, and it saves the old colors in `originals.json`.
- It creates the scheduled task `AgyZhPack`, which starts the injector in the background when you sign in (normal user rights, about 60 MB of memory). If it cannot create the task, it uses the Startup folder.
- It adds the start flag `--remote-debugging-port=0` to the Antigravity shortcuts (see [Shortcut flag](#shortcut-flag)). If Antigravity is open without the flag, it asks you before it restarts Antigravity once.

## Uninstall

Double-click `一键卸载.cmd` (uninstall). It removes the start flag from the shortcuts. If you used the author's color theme, it asks whether to restore your old colors. Keep the extracted folder: you need it to uninstall and to use the color toggle.

<details>
<summary>If you installed the old v1.0.0</summary>

v1.0.0 changed the look directly at install time (131% zoom, strong contrast, system font, warm white colors). From v1.1.0, zoom, contrast and font are no longer changed, and the color theme is optional:

- When you upgrade, the zoom, contrast and font set by the old version stay as they are. The color question says that you use the author's color theme now. Type n to go back to your old colors.
- To restore everything to how it was before you installed the old version: run `一键卸载.cmd` (uninstall), choose to restore, then install again.

</details>

## Tested versions

| Antigravity version | What was tested | Date |
|---|---|---|
| 2.33.0 | Official default limits with the unlock off: 512k for Gemini 4 Neon and Gemini 4 Carbon, 840k for Claude Opus 5.5; cost shows in a real Neon conversation (amount not checked); after the unlock was removed, the injector on a real computer restarted and injected again, translation and the status bar work, and Claude Opus 5.5 shows 840k after a new message; in an isolated folder: upgrade from an old version with the unlock on (old setting deleted, with a message), reinstall, uninstall; the daily usage panel shows correctly on a real computer (bar chart, table, both limit columns); the limit counting was tested offline in 8 cases; fill-in: 4270 calls read from 73 conversation databases, and today's numbers match the live status bar ledger item by item (calls and tokens for Carbon, Opus 5.5 and Neon) | 2026-11-20 |
| 2.33.0 | Translation (home page, all settings screens, model menu; added 301 new UI strings from 2.32 and 2.33 and 4 rules); prices for Neon and Orchestrator (Neon) (checked offline); shortcut flag: on a real computer, injection works after a restart from the shortcut, and a start without the flag shows the notification in about 20 seconds; in an isolated folder: install, reinstall, flag removal on uninstall, restart or skip when Antigravity is open, no shortcuts | 2026-11-19 |
| 2.33.0 | **Not tested**: whether the next automatic update rewrites the shortcuts or restarts Antigravity without the flag; color toggle (no code change this time) | — |
| 2.32.1 | 512K for Orchestrator (Carbon) (tested in both the planning and execution phases), Orchestrator quota groups, cost (per conversation and today, including today's amount after an Antigravity restart), English status bar text, two-line layout | 2026-11-16 |
| 2.32.1 | **Not tested**: install and color toggle, translation of new UI text in 2.32.1, how today's cost is split for a conversation that runs past midnight | — |
| 2.31.2 | Translation (all settings screens, conversation page), status bar (model, context, cache, first token, speed, 5-hour and weekly limits), 512K request change, context toggle; in an isolated folder: install, color toggle (switch on, switch back, restore on uninstall, close and reopen Antigravity when it is open, upgrade from v1.0.0), context toggle, uninstall | 2026-11-13 |
| 2.31.2 | **Not tested**: subagent lines (no subagents ran) | — |
| 2.29.0 | All translation and status bar features, including subagent lines | 2026-11-04 to 09 |

System: Windows 11.

Known gaps in the translation:

- Some sentences are built from several pieces of text with a file name or link in between. These are translated piece by piece, so the word order is not always natural. Pieces with only one or two function words that make no sense alone stay in English.
- Some descriptions on the settings page (for example, the names of layout modes and the descriptions of built-in skills) come from the Antigravity backend, not from the frontend code. If the backend changes the text, these places show English until the dictionary is updated.

## How it works

- The Antigravity main process opens a Chromium remote debugging port. The port number is in `%APPDATA%\Antigravity\DevToolsActivePort`. From 2.33.0, it opens only with a start flag; see [Shortcut flag](#shortcut-flag).
- `inject.mjs` runs in the background and checks every 3 seconds. When it finds the main window, it injects the translator and the status bar script through the Chrome DevTools Protocol. It does not change the Antigravity install files, so it keeps working after Antigravity updates itself.
- The status bar wraps `fetch` in the page and listens to the grpc-web+json data between the app and the local backend (`language_server`). It does not change the requests that the app sends. It also calls a few read-only local APIs: quota, the actual model name, subagent status, and the token usage and time of each call (for the cost).
- Every 30 seconds, the injector saves today's cost from the page into `cost-day.json`. It also finds the conversations you used today in `%USERPROFILE%\.gemini\antigravity\brain\` and gives them to the status bar, so today's amount is kept when Antigravity restarts. Only conversation IDs, amounts, and call and token counts for each model are saved. It also writes the day's totals and limit changes to `usage-history.json`, and gives the last 31 days to the daily usage panel.
- By default, it does not write Antigravity's settings files. It writes them only in two cases: you choose the author's color theme (or switch back), which changes the two theme color groups in `%USERPROFILE%\.gemini\config\config.json`; or you choose to restore on uninstall, which writes the saved values back to that file (and to `%APPDATA%\Antigravity\app_storage.json` if you installed the old v1.0.0).
- It does not connect to any website, except Google Fonts for the status bar icons.

<details>
<summary>Run from source and build the package</summary>

You need Windows and Node.js 22 or later (it uses the built-in `WebSocket` and `fetch`).

```bash
node inject.mjs
```

- The injector stays in the background. If one is already running, a new one exits.
- From Antigravity 2.33.0, start Antigravity with `--remote-debugging-port=0`. Run `powershell -ExecutionPolicy Bypass -File debug-port.ps1` once to add the flag to the shortcuts, then open Antigravity from a shortcut.
- After you change `statusbar.js` or a file in `i18n`, open windows update automatically. You do not need to restart. After you change `inject.mjs`, restart the injector.
- To add your own styles to the page (for example, a different reply font), put a `style.css` next to `inject.mjs`. The injector loads it automatically. Without this file, no styles are changed.
- If you change the logic in `i18n/translator.js`, add 1 to its `VERSION`. Open windows then switch to the new translator.
- If the injector starts long after Antigravity opened, the status bar shows `Press Ctrl+R to reload this window`. Press Ctrl+R once to reload the window.

Build:

```bash
node package/build.mjs
```

This creates `dist/Antigravity中文美化包/` and a zip with the same name. When you upload it to GitHub Releases, rename the zip to `agy-zh-pack-v<version>.zip` (GitHub removes Chinese characters from file names). The zip includes the running `node.exe` and `package/third_party/node-LICENSE.txt` (the Node.js license). If you build with a different Node.js version, use the license for that version: `https://raw.githubusercontent.com/nodejs/node/<version>/LICENSE`.

</details>

<details>
<summary>Files</summary>

| File | Purpose |
|---|---|
| `inject.mjs` | Injector: connects to the Antigravity debugging port and injects the files below; keeps the ledger for today's cost |
| `debug-port.ps1` | Adds and removes the start flag `--remote-debugging-port=0` on the Antigravity shortcuts, finds an Antigravity that runs without the flag, shows the notification |
| `statusbar.js` | Usage status bar and cost estimate (runs in the page) |
| `i18n/translator.js` | Translator (runs in the page) |
| `i18n/zh-CN.json` | Dictionary: English UI text → Chinese |
| `i18n/zh-CN.rules.json` | Regex rules: relative times, thinking time and other text with numbers |
| `cost-day.json` | Ledger for today's cost (not in the repo; created by the injector) |
| `usage-history.json` | Daily usage history, kept for 90 days (not in the repo; created by the injector) |
| `package/app/setup.mjs` | Install, uninstall, color toggle |
| `package/build.mjs` | Builds the package |
| `package/third_party/node-LICENSE.txt` | License of the Node.js included in the package |
| `assets/statusbar.png` | The screenshot at the top of this page |

</details>

## Credits

- The look and the English wording of the status bar follow the cometix theme of [CCometixLine](https://github.com/Haleclipse/CCometixLine) (ccline) by Haleclipse. Thanks to Haleclipse for such a good-looking status line.
- The display of the 5-hour and weekly limits follows agyline.
- Status bar colors: Catppuccin (Latte for light, Mocha for dark).
- Icons: Material Symbols (Apache License 2.0).
- The package includes Node.js (MIT license, see `package/third_party/node-LICENSE.txt`).

## License

The code of this project uses the MIT license. See [LICENSE](LICENSE).

Antigravity is a Google product. The keys in the dictionary `zh-CN.json` are the original English UI text of Antigravity, used to match the text to translate.
