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

Menus, settings, buttons and hints are shown in Chinese (a dictionary of 3292 entries and 76 regex rules). Conversation content, code and file names are not translated.

#### Status bar only (no translation)

Delete `%LOCALAPPDATA%\AgyZhPack\i18n\zh-CN.json`, then press `Ctrl+R` once in Antigravity. The UI goes back to English and the status bar stays. A reinstall puts the file back.

### Usage status bar

Two fixed lines above the input box. Each item is a colored icon with text in the same color. Like ccline, the status bar text is in English. Hover over any item to see a detailed tooltip (in Chinese). You can change the colors and the style; see [Look](#look).

| Line | Example | Meaning |
|---|---|---|
| Line 1 | `gemini-flash-worker-agy` | Model: the name in the UI, plus the model name that the API actually returns. For Gemini models, it turns yellow when the two do not match |
| | `89% · 456k · ↻3×` | Context: the icon is a ring that fills as the context fills, then percent used and tokens used. If the conversation was auto-compacted, a small pale-yellow badge follows; the number is how many times. The tooltip shows the limit, a bar, the tokens and percent of each part that Antigravity reports, the free space, and at which steps it was compacted |
| | `99% hit` | Cache: the cache hit ratio of the last call; the tooltip shows how many tokens were read from cache |
| | `$17.81` | Total cost of this conversation (subagents included). Hover to see the input, cache and output tokens of the last call and the cost of each |
| | `$17.85 today` | Total cost today (from local midnight, all conversations). Click it to open the [daily usage panel](#daily-usage-panel) |
| | `running` | The model is generating. When it is not generating, this item keeps an empty space, so the bar does not wrap and jump when generation starts or stops. In a narrow window this item gets smaller first, so it does not move to the next line |
| Line 2 | `6.9s` | Time to first token |
| | `169 tok/s` | Output speed |
| | `0% · 16:44` | 5-hour limit: percent used (with a bar) and reset time |
| | `41% · Sat 16:08 · ↑15%` | Weekly limit: percent used, reset time, and how far ahead (↑) or behind (↓) an even pace you are |
| Subagents | `├ research · Paper Reviewer … ● 1m05s` | Each subagent gets its own line, joined in a tree with `├` and `└`. The items are: subagent type and task, model, context, cache hit, the cost of this subagent only, and status. The status is `● time running`, `● waiting` (it waits for your approval) or `✓ done time · N steps`; hover to see its current step and its last steps. The line closes about 10 seconds after the subagent ends. In a subagent window, the bar shows that subagent's own data |

The look follows the cometix theme of [CCometixLine](https://github.com/Haleclipse/CCometixLine) (ccline, a status line for Claude Code) by Haleclipse: two lines, colored icons with text in the same color, `|` between items, `·` between numbers in one item, and bars for the limits. This project does not use ccline code. The status bar was written again for Antigravity.

#### Look

Click `$x today` to open the [daily usage panel](#daily-usage-panel), then click `theme` at the top right. At the top is a gallery of color palettes. Each card is a live copy of your status bar; click a card to use that palette. The other options are below it. A change applies at once.

| Option | Values | Default |
|---|---|---|
| Palette | Cometix, Catppuccin, Tokyo Night, Rosé Pine, Gruvbox, Nord, Dracula, Mono | Cometix (this project's own palette) |
| Style | `plain`: text with vertical-line separators; `pill`: a rounded background for each item; `powerline`: arrow-shaped color blocks | `plain` |
| Bars (limits) | `thin`: a thin bar; `cells`: 10 cells; `ring`: a small ring; `none`: no bar | `thin` |
| Detail | `compact`: no context limit, cache shows only the hit ratio; `full`: context with limit, cache with tokens read | `compact` |
| Icons | `material`: filled icons; `outline`: line icons; `unicode`: plain characters (no online icon font); `off`: no icons | `material` |
| Swap (per item) | Each item has one alternative icon. Click to switch between the default and the alternative. For example, the model can use a comet, and the output speed can use a 3-step gauge (the needle points to slow / medium / fast: below 30, 30 to 60, above 60 tok/s) | All default icons |

- Each palette has a light and a dark version. The version follows the light or dark theme of Antigravity. The colors come from the published definitions of each palette (see [Credits](#credits)). Nord has only an official dark version, so its light version uses darker forms of the pale colors.
- Your choice is kept in `look.json` in the install folder. The injector saves it within 30 seconds and sends it to the other windows. To go back to the defaults, click `reset` at the top right of the Theme page, or close Antigravity and then delete the file.
- The layers (palette, style, bar glyphs, detail) and the "gauge instead of icon" idea (the context icon is a ring that fills) follow ccline v2. This project does not use ccline code.

#### Daily usage panel

Click `$x today` in the status bar. A panel opens above the status bar. It is as wide as the input box and uses all the height above the status bar. Click it again, click outside the panel, or press `Esc` to close it. At the top right are the signed-in account (the email is masked, for example `ab***12@gmail.com · Ultra`) and the `theme` button, which opens the [Look](#look) settings.

- **Top cards**: today's cost, calls, total tokens and cache hit ratio.
- **Bar chart**: the estimated cost of each day in the last 7 or 30 days, with one color for each model. Hover over a bar to see that day's details.
- **Table**: one row for each day, with cost, conversations, calls, total tokens, input / cache / output tokens, cache hit ratio, and how many percentage points of the weekly limit were used that day (Gemini group and Claude group separately).
- **Call details**: click a day in the table to see each model call of that day (today or an earlier day): time, conversation, model, cost, input, output, cache read, cache write, hit ratio, output speed, time to first token and total time. The newest call is at the top. Up to 600 rows are listed; the totals include all calls. Click `← usage` to go back.
- **Bottom lines**: the total (cost and tokens) and daily average for the period, and one line for each weekly limit group (see "Weekly limit estimate" below).

The data is kept in `usage-history.json` in the install folder for 90 days. It holds only amounts, call counts, token counts and limit ratios, not conversation content. Limit records are kept for each account separately, so they do not mix after you change accounts. The file keeps only the masked email and an account ID (a hash of the email), not the full email.

**Weekly limit estimate** (one line for each group, for example `Gemini weekly · 3% used · cap ≈ $952 / 2.15B tok (rough) · resets 11-29 09:41 · est 45% at reset (rough)`):

- `cap ≈`: this computer's estimated cost and tokens in this limit period (from 7 days before the reset time to the reset time), divided by the percent used in the period. It estimates how much cost and how many tokens the full weekly limit is worth.
- `est … at reset`: at the recent usage rate, about how much will be used at the reset time. If the limit will run out before that, it shows `full` and the expected time. The rate comes from the average of this period and from the last 24 hours (with at least 6 hours of readings). The readings are kept in `quota-samples.json` for 8 days.
- Both numbers have `(rough)`: the used ratio goes up and down, and early in a period, with little use, the error is large. Hover to see the method and the remaining limit.

After the install, the injector fills in earlier days once: it opens Antigravity's own conversation databases read-only (`%USERPROFILE%\.gemini\antigravity\conversations\*.db` on Windows, `~/.gemini/antigravity/conversations/*.db` on macOS), reads the time, model and token counts of each call, groups them by day, and the status bar prices them with its price table. Filled-in days have no limit data (nobody recorded it then). Each call is put on the day of its own time. v1.5.x used the start time of the turn, so a turn that ran past midnight was put on the day before (in one test, one day was missing 349 calls). After you upgrade to v1.6, earlier filled-in days are calculated again once. This needs Node.js 22.13 / 23.4 or later (the built-in `node:sqlite`; versions 22.5 to 22.12 need a start flag for it). On Windows, the `node.exe` in the package meets this. On macOS, the injector uses the Node.js that you installed. If the version is too old, only the fill-in step is skipped; the panel and the daily live records still work. It depends on Antigravity's internal storage format, so if that format changes, earlier days cannot be filled in; other features are not affected.

The weekly limit used in a day is the net change in each limit period: the last used ratio seen that day minus the used ratio at the start of the day. If a new period starts during the day, the parts are added. The reason: in one period the used ratio goes up and down (in one test, it went from 1.699% to 1.594% in 6 minutes while the model was generating). v1.4.x added only the increases, so an increase after a drop was counted again and the daily number was too high. After you upgrade to v1.5.0, earlier weekly records are calculated again with the new method.

- Limit used while Antigravity is closed (for example with the agy CLI) is counted on the next day that the injector sees it.
- The limit belongs to the account. If the account uses Google family sharing, or is also used on another computer, the limit includes other people's usage. Then `cap ≈` is too low (their usage raises the limit, but their cost is not in this computer's cost), and `est` is too high.

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
- `gemini-4-hydrogen-tiered-high` (used by the browser subagent) is not on the official pricing page. It is estimated with the Gemini 4 Hydrogen standard price.
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
| 2.34.0 | v1.6 (real Windows 11 computer): subagent tree lines (model, context, cache, own cost, time running, waiting for approval, time and steps when done), the compaction badge, the percent of each part in the context tooltip, and `running` that does not wrap in a narrow window; the four icon sets and the alternative icon of each item on the Theme page (comet, 3-step speed gauge); in the daily panel, the account, top cards, token column, call details (today and earlier days; 11-18 has 1101 calls, $69.24), and the weekly `cap` and estimate; tooltips are no longer transparent; the v2 fill-in read 79 conversation databases, and the call counts of 7 days (11-08, 11-10, 11-11, 11-16, 11-17, 11-18, 11-19) match the call details day by day; the total calls and the limit records did not change. Real Mac: the account, limit history kept for each account, and the panel work; the fill-in step is skipped correctly when there are no conversation databases. **Not tested**: the installer (not changed) | 2026-11-22 |
| 2.34.0 | v1.5.1: full test of the look on a real Mac (v1.5.0 source copied over, injector restarted): 8 palettes, 3 styles, 4 bar types, icons on and off, the 8 cards on the Theme page and a click on a card all work; with Antigravity switched to its dark theme in Settings, Cometix, Tokyo Night, Catppuccin + powerline, Gruvbox + pill + ring and the Theme page were checked, then the theme was switched back to light; after a window reload the chosen look comes back at once (v1.5.0 needed up to 30 seconds); the `reset` button restores the defaults; no page errors. **Not tested**: subagent lines with the new look | 2026-11-22 |
| 2.34.0 | Look (v1.5.0): on a real Windows computer, the new status bar (context ring, compact text, thin bars) shows correctly; the Theme page shows 8 palette cards and the 4 option rows (style, bars, detail, icons) with no errors; a choice is written to `look.json` after 28 seconds; in an offline preview page, all 8 palettes in light and dark, the 3 styles, the 4 bar types and icons off show correctly. On a real Mac: the new status bar, the Theme page and the icon font work with no errors. Weekly limit as net change per period: in one period, while the model was generating, the Gemini weekly limit went from 1.699% to 1.594% and the 5-hour limit from 1.907% to 1.487% in 6 minutes; the real history on our computer was calculated again offline, and 11-22 went from +7.24% to +1.59% (the status bar showed 2%); 3 more cases were simulated (ups and downs in one period, a new period during the day, a limit not seen before). **Not tested**: the dark theme of Antigravity on a real computer (only in the offline preview), subagent lines with the new look | 2026-11-22 |
| 2.34.0 | Status bar (issue #2): hover text now uses our own tooltip box. On a real Mac with a simulated mouse: shown after 0.6 seconds; it stays through 6 forced re-renders in a row; it closes when the mouse moves away; button tooltips in the daily panel work; the compress icon font loads. On Windows after a hot update, the status bar and panel have no native `title`; when not generating, the empty `running` space is on line 1 and the bar has 2 lines. Quick quota retry: after a restart of Antigravity on the Mac, the first request got the limits in 3.3 seconds and no retry was needed. **Not tested**: how the badge looks and wraps in a compacted conversation, the retry when the first quota request fails | 2026-11-22 |
| 2.34.0 | Translation: added 167 new UI strings and 16 rules from 2.34.0 (Orchestrator settings, permission and sandbox options, plugin panels, sidebar customization, send-key setting, home page suggestion cards; the limit descriptions on the Models settings screen are translated by rules, and the maximum text length for rules went from 80 to 120); after the change, scans of the Windows home and conversation pages and the macOS settings screens (General, Models) show only names and developer options in English | 2026-11-22 |
| 2.34.0 | macOS on a real computer (13-inch Intel MacBook Pro 2020, macOS 15.7.9, Node.js 24.14.0): `install-agent` installs the LaunchAgent and starts the injector; `launch-agy` starts Antigravity with the debugging port; after injection into the onboarding page, the window reloads once; translation, the status bar (model, today's cost, 5-hour and weekly limits) and the daily usage panel work; fill-in is skipped correctly when there are no conversation databases. **Not tested**: autostart after a restart, the notification when Antigravity starts without the flag, color toggle | 2026-11-22 |
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
- The status bar wraps `fetch` in the page and listens to the grpc-web+json data between the app and the local backend (`language_server`). It does not change the requests that the app sends. It also calls a few read-only local APIs: quota, the signed-in account (email and plan; the email is used only in the page to make the account ID and the masked text, and is not written to a file), the actual model name, subagent status and steps, and the token usage and time of each call (for the cost and the call details).
- Every 30 seconds, the injector saves today's cost from the page into `cost-day.json`. It also finds the conversations you used today in `%USERPROFILE%\.gemini\antigravity\brain\` (macOS: `~/.gemini/antigravity/brain/`) and gives them to the status bar, together with the ID, creation time and change time of each conversation in the last 32 days from the conversation database folder (`conversations`), because the backend's conversation list shows only some conversations. So today's amount is kept when Antigravity restarts. Only conversation IDs, amounts, and call and token counts for each model are saved. It also writes the day's totals and limit changes to `usage-history.json`, and gives the last 31 days to the daily usage panel.
- By default, it does not write Antigravity's settings files. It writes them only in two cases: you choose the author's color theme (or switch back), which changes the two theme color groups in `%USERPROFILE%\.gemini\config\config.json`; or you choose to restore on uninstall, which writes the saved values back to that file (and to `%APPDATA%\Antigravity\app_storage.json` if you installed the old v1.0.0).
- It does not connect to any website, except Google Fonts for the status bar icons.

<details>
<summary>Run from source and build the package</summary>

You need Node.js 22 or later (it uses the built-in `WebSocket` and `fetch`). Running from source works on both Windows and macOS (see [macos/README.md](macos/README.md) for macOS setup and LaunchAgent scripts).

```bash
node inject.mjs
```

- The injector stays in the background. If one is already running, a new one exits.
- From Antigravity 2.33.0, start Antigravity with `--remote-debugging-port=0`. On Windows, run `powershell -ExecutionPolicy Bypass -File debug-port.ps1` once to add the flag to the shortcuts, then open Antigravity from a shortcut. On macOS, run `./macos/launch-agy.command` (or `open -a Antigravity --args --remote-debugging-port=0`).
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
| `look.json` | Your status bar look (not in the repo; created when you choose a look on the Theme page) |
| `quota-samples.json` | Limit readings for 8 days, used for the weekly limit estimate (not in the repo; the injector creates it) |
| `package/app/setup.mjs` | Install, uninstall, color toggle |
| `package/build.mjs` | Builds the package |
| `package/third_party/node-LICENSE.txt` | License of the Node.js included in the package |
| `macos/manage.mjs` | macOS helper CLI (LaunchAgent auto-start, start/stop, theme toggle, debug-port launcher) |
| `macos/launch-agy.command` | macOS launcher (auto-detects Node.js and starts Antigravity with `--remote-debugging-port=0`) |
| `macos/README.md` | macOS usage guide |
| `assets/statusbar.png` | The screenshot at the top of this page |

</details>

## Credits

- The look and the English wording of the status bar follow the cometix theme of [CCometixLine](https://github.com/Haleclipse/CCometixLine) (ccline) by Haleclipse. The layers of the v1.5.0 look (palette, style, bars, detail) and the context ring follow ccline v2. Thanks to Haleclipse for such a good-looking status line.
- The display of the 5-hour and weekly limits follows agyline.
- The default palette, Cometix, is based on [Catppuccin](https://catppuccin.com) (Latte for light, Mocha for dark). The other palettes use the published colors of Catppuccin, [Tokyo Night](https://github.com/folke/tokyonight.nvim), [Rosé Pine](https://rosepinetheme.com), [Gruvbox](https://github.com/morhetz/gruvbox), [Nord](https://www.nordtheme.com) and [Dracula](https://draculatheme.com) (its light version is the official Alucard).
- Icons: Material Symbols (Apache License 2.0). The alternative model icon (a comet) is the meteor icon of [Font Awesome Free](https://fontawesome.com) 6.7.2, license [CC BY 4.0](https://fontawesome.com/license/free), copyright Fonticons, Inc.
- The package includes Node.js (MIT license, see `package/third_party/node-LICENSE.txt`).

## License

The code of this project uses the MIT license. See [LICENSE](LICENSE).

Antigravity is a Google product. The keys in the dictionary `zh-CN.json` are the original English UI text of Antigravity, used to match the text to translate.
