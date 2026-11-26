<div align="center">

# agy-zh

[简体中文](README.md) | [English](README.en.md)

**An unofficial Simplified Chinese plugin for Antigravity Desktop (Windows / macOS)**

Chinese UI translation · usage status bar above the input box · optional color theme · signed one-click updates

[![Download](https://img.shields.io/github/v/release/ncdeng/agy-zh-pack?label=download&color=D97757)](https://github.com/ncdeng/agy-zh-pack/releases/latest)
[![License](https://img.shields.io/github/license/ncdeng/agy-zh-pack)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![macOS](https://img.shields.io/badge/platform-macOS-555555)

![The usage status bar above the input box](docs/images/statusbar.png)

<sub>Real screenshot: a long conversation</sub>

</div>

> [!WARNING]
> This is a third-party project. It has no connection with Google. By default it only changes what you see on your own computer and only reads local data. Read [Risks](#risks) before you install.

> [!IMPORTANT]
> Tested with Antigravity 2.35.2. From Antigravity 2.35, use v2.0.12 or later; with earlier versions the status bar and the call details get no data. If you installed v1.x (then called "中文美化包"), see [Upgrade from v1.x](#upgrade-from-v1x).

> [!NOTE]
> This pack is made for Chinese users. It translates the Antigravity UI into Simplified Chinese. The status bar text is in English, but its hover tooltips, the plugin panel, the installer prompts and the file names in the download are in Chinese. If you only want the status bar, see [Status bar only](#status-bar-only-no-translation).

## Quick start

**Windows**

1. Install Antigravity and sign in once.
2. Download the latest `agy-zh-pack-v<version>.zip` from [Releases](https://github.com/ncdeng/agy-zh-pack/releases/latest). Extract it to any folder. Do not run it from inside the zip.
3. Double-click `一键安装.cmd` (install). If Windows shows "Windows protected your PC", click "More info", then click "Run anyway".
4. The installer asks one optional question: use the author's color theme. If you are not sure, press Enter (the answer is "no").
5. You do not need to close Antigravity. If Antigravity was started without the debugging port flag this time, the installer asks you; after Enter it closes Antigravity and opens it again with the flag when the install is done.
6. From now on, open Antigravity from the Start menu, desktop or taskbar icon. The installer added a start flag to these shortcuts.

**macOS**

1. Install Antigravity and sign in once.
2. Download and extract the package. Open Terminal, type `bash` and a space, drag `一键安装.command` (install) into the Terminal window, and press Enter.
3. The installer asks two questions: whether to reopen Antigravity automatically when it starts without the debugging port flag (recommended: press Enter for "auto"), and whether to use the author's color theme.

After the install, the plugin panel is in the "Plugins" menu at the top right of Antigravity, under the name "agy-zh". To change the color theme, run `配色开关` (color toggle). To uninstall, run `一键卸载` (uninstall). Keep the extracted folder.

### Upgrade from v1.x

From v2.0, agy-zh is an Antigravity plugin (v1.x was called "中文美化包"). If you installed v1.x, download the new package and run `一键安装` (install) once. Your daily records and look settings from the old version are moved over, and the old autostart is removed. After that, when a new version is out, click "更新" (update) in the plugin panel; you do not need to download the package again.

## Defaults

| Feature | Default | Changes what is sent to Google? |
|---|---|---|
| Chinese UI translation | On | No. It only changes the local display |
| Usage status bar | On | No. It only reads local data |
| Author's color theme | Off | No. It only changes the theme colors of your local Antigravity |
| Online updates of the dictionary and prices | On | No. Every 6 hours it asks GitHub for the latest commit of this project, then downloads the dictionary and price table from this project's GitHub repository (through jsDelivr). These are plain download requests; no data is uploaded. You can turn it off; see [Online updates](#online-updates) |
| Version updates (code) | Only when you click "更新" (update) | No. Before it installs, it checks the signature with the author's public key; see [Version updates](#version-updates) |
| Start without the debugging port | Windows: ask you; macOS: as chosen at install | No. It only closes Antigravity and opens it again with the flag; see [Without the debugging port flag](#without-the-debugging-port-flag) |

Zoom, font and contrast are never changed.

## Features

### Chinese UI translation

Menus, settings, buttons and hints are shown in Chinese (a dictionary of 3567 entries and 128 regex rules). Conversation content, code and file names are not translated. From v2.0.7, when a text made of several sentences (for example a description and a retirement date in the model menu) is not in the dictionary, it is split at the periods and translated sentence by sentence. It is shown in Chinese only if each sentence has a translation. From v2.0.8, the Swarm panel of Antigravity (a separate plugin frame) is also translated: tabs, states, counts and filters are shown in Chinese, and the goal, task titles and messages written by the agents stay as written.

Some things are not translated on purpose:

- **Names of Antigravity features**: Artifact, Turbo, Coordinator and Swarm stay in English (for example "Turbo 模式", "Artifact 评论"), so that they match the official docs and the community and are easy to search. Terms such as MCP, URL, SSH and token also stay in English.
- **Names that you or third parties give**: conversation titles, project names, files and paths, automation names, Coordinator names, branch / repository / worktree names, SSH hosts, plugin titles and MCP server names are not translated, even when they are the same as a dictionary word.
- **Single words that change meaning without context**: for example Plan (it can mean a subscription plan or a work plan), Type and Space stay in English when they stand alone.
- **Error messages** are translated, and the original English text shows when you hold the mouse over them, so you can search for it or report it.

#### Switch back to English

From v2.0.8, press `Ctrl+Alt+E` (`Ctrl+Option+E` on macOS) to show the whole page in English, for example to compare with the official documentation. Press it again to switch back to Chinese. All windows and the Swarm panel switch together. A reload switches back to Chinese, and no setting is changed. In the plugin panel, the line below "中文界面" (Chinese UI) also has "现在切换" (switch now). AltGr+E (used for € on some European keyboards) does not switch.

#### Untranslated UI text

From v2.0.7, UI text that has no translation is recorded in `i18n-missing.json` in the data folder. The "没翻译的界面文字" (untranslated UI text) line under "高级" (advanced) in the plugin panel shows the count. You can expand it to see the latest 30 items, or clear the list.

- The file stays on your computer. It is not uploaded.
- The plugin does not record paths, URLs, email addresses, file names, model names and single code-like words. Texts that are different only in their numbers are recorded as one item (for example "Retry in 5 seconds" and "Retry in 12 seconds"). But names shown in the UI, such as project names and conversation titles, can be recorded.
- To help with the dictionary, you can paste the UI text from the file into a GitHub issue of this project (remove names that you do not want to make public first).
- A name that must stay in English is written in the dictionary with the same text as the translation (for example `"Swarm": "Swarm"`). Then it is not recorded again.

#### Status bar only (no translation)

From v2.0.15, turn off "中文界面" (Chinese UI) in the plugin panel. The UI goes back to English at once, the status bar stays, and the UI stays in English after a restart of Antigravity. For the opposite (translation only, no status bar), turn off "显示用量状态栏" (show the usage status bar).

v2.0.14 and earlier: delete `i18n/zh-CN.json` in the plugin folder (see [What the installer does](#what-the-installer-does)), then press `Ctrl+R` (`Cmd+R` on macOS) once in Antigravity. The UI goes back to English and the status bar stays. The "插件文件" (plugin files) line under "高级" (advanced) in the plugin panel then shows that 1 file does not match the signed manifest; this is expected. A reinstall or a version update puts the file back.

#### Known gaps in the translation

- Some sentences are built from several pieces of text with a file name or link in between. These are translated piece by piece, so the word order is not always natural. Pieces with only one or two function words that make no sense alone stay in English.
- Some descriptions on the settings page (for example, the names of layout modes and the descriptions of built-in skills) come from the Antigravity backend, not from the frontend code. If the backend changes the text, these places show English until the dictionary is updated.

### Usage status bar

Two fixed lines above the input box. Each item is a colored icon with text in the same color. Like ccline, the status bar text is in English. Hover over any item to see a detailed tooltip (in Chinese). You can change the colors and the style; see [Look](#look).

| Line | Example | Meaning |
|---|---|---|
| Line 1 | `gemini-flash-worker-agy` | Model: the name in the UI, plus the model name that the API actually returns. For Gemini models, it turns yellow when the two do not match |
| | `89% · 456k · ↻3×` | Context: the icon is a ring that fills as the context fills, then percent used and tokens used. If the conversation was auto-compacted, a small pale-yellow badge follows; the number is how many times. The tooltip shows the limit, a bar, the tokens and percent of each part that Antigravity reports, the free space, and at which steps it was compacted. From v2.0.8, click the badge to open the compaction viewer (see "Compaction viewer" below) |
| | `99% hit` | Cache: the cache hit ratio of the last call; the tooltip shows how many tokens were read from cache |
| | `$17.81` | Total cost of this conversation (subagents included). Hover to see the input, cache and output tokens of the last call and the cost of each. From v2.0.8, when the last call cost $0.50 or more, a small red badge follows (for example `!$1.82`; it flashes when it first shows). Its hover text gives the cache hit ratio of that call, how much the cache would have saved, and the usual causes |
| | `$17.85 today` | Total cost today (from local midnight, all conversations). Click it to open the [daily usage panel](#daily-usage-panel) |
| | `running` | The model is generating. When it is not generating, this item keeps an empty space, so the bar does not wrap and jump when generation starts or stops. In a narrow window this item gets smaller first, so it does not move to the next line |
| Line 2 | `6.9s` | Time to first token |
| | `169 tok/s` | Output speed |
| | `0% · 16:44` | 5-hour limit: percent used (with a bar) and reset time |
| | `41% · Sat 16:08 · ↑15%` | Weekly limit: percent used, reset time, and how far ahead (↑) or behind (↓) an even pace you are |
| Subagents | `├ research · Paper Reviewer … ● 1m05s` | Each subagent gets its own line, joined in a tree with `├` and `└`; the columns of these lines are aligned. The items are: subagent type and task, model, context, cache hit, the cost of this subagent only, and status. The status is `● time running`, `● waiting` (it waits for your approval) or `✓ done time · N steps`; hover to see its current step and its last steps. The line closes about 10 seconds after the subagent ends. In a subagent window, the bar shows that subagent's own data |

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
- Your choice is kept in `look.json` in the data folder. The plugin saves it within 30 seconds and sends it to the other windows. To go back to the defaults, click `reset` at the top right of the Theme page, or close Antigravity and then delete the file.
- The layers (palette, style, bar glyphs, detail) and the "gauge instead of icon" idea (the context icon is a ring that fills) follow ccline v2. This project does not use ccline code.

#### Daily usage panel

Click `$x today` in the status bar. A panel opens above the status bar. It is as wide as the input box and uses all the height above the status bar. Click it again, click outside the panel, or press `Esc` to close it. At the top right are the signed-in account (the email is masked, for example `ab***12@gmail.com · Ultra`) and the `theme` button, which opens the [Look](#look) settings.

- **Top cards**: today's cost, calls, total tokens and cache hit ratio.
- **Bar chart**: the estimated cost of each day in the last 7 days, the last 30 days, or all days (`all`, from v2.0.5: from the first day with records to today, up to 400 days; with more than 62 days, each bar is one week), with one color for each model. Hover over a bar to see that day's details.
- **Table**: one row for each day, with cost, conversations, calls, total tokens, input / cache / output tokens, cache hit ratio, and how many percentage points of the weekly limit were used that day (Gemini group and Claude group separately).
- **Call details** (from v2.0.8, the cost cell of a call of $0.50 or more is red with "!"; hover to see the cache hit ratio and likely causes, and the total next to the title gives how many such calls there are; on the author's computer, 93% of these calls had a cache miss; from v2.0.9, the hit cell of a call with a cache miss is yellow, its hover text gives the missed tokens, the extra cost and the cause, the total next to the title shows `miss +$X`, `all calls | cache misses` shows only these calls, and the per-conversation view has a `Miss` column; see "Cache misses" below): click a day in the table to see each model call of that day (today or an earlier day): time, conversation, model, cost, input, output, cache read, cache write, hit ratio, output speed, time to first token and total time. The newest call is at the top. The first 600 rows are listed, and `show 600 more` / `show all` below the table shows more; the totals include all calls. The row below the title (from v2.0.6): `calls | by conversation` switches between one row per call and one row per conversation (sorted by cost; click a row to go back to the calls and see only that conversation, and click `×` to clear it); `all | desktop | CLI` appears when the day has agy CLI calls; a model filter appears when the day used two or more models (grouped by price name, such as Carbon or Neon). Days older than 32 days also have call details (from v2.0.6; CLI databases are read when needed, so the first open can take a few seconds). While it is open, it refreshes in the background every 30 seconds and changes the table only when the data changed, so it does not flicker or jump back to the top. Click `← usage` to go back.
- **By model and generation speed** (from v2.0.15): choose `by model` in `calls | by conversation | by model` below the title of the call details. Each model has one row (by display name; different thinking levels are counted apart): calls, cost, output, the median generation speed, the speed range of the middle half of the calls (P25 to P75), and the median and P90 time to first token. Click a row to go back to the details with only the calls of that price name. Generation speed = output tokens of a call (thinking included) ÷ (time to first token + generation time), the same as the tok/s column of the details. Calls with fewer than 100 output tokens (mostly tool calls) are not counted for speed. The speed of one model changes a lot (author's computer, 11-26: Hydrogen (High) median 100 tok/s, middle half 56 to 143), so only the median and the range are shown, not the mean.
- **speed page** (from v2.0.15): the `speed` button in the title row. The `Hourly` part at the top shows the median generation speed of each hour: `last 24 hours | today` switches between the last 24 full hours and today from 0:00; an hour with fewer than 3 calls counted for speed has no point, and there is no line across a gap of more than 2 hours. The legend gives the speed of each model now (the last 60 minutes) and usually (the median of the daily medians of the 7 days before today); when now is more than 40% slower than usual, it is marked. Author's computer, 11-26: Hydrogen (High) had 149 tok/s at 1:00, only 35 to 43 after 15:00, and about 100 usually. The `Daily median` part below is a line chart of the median generation speed of each model on each day of the last 30 days: only the 5 models with the most calls; the second thinking level of the same price name is dashed; a day with fewer than 3 calls counted for speed has no point. Hover a point to see the speed range, the time to first token and the number of calls of that day. The table below has one row for each model: the speed today, in the last 7 days and in the last 30 days (7 and 30 days = the median of the daily medians), the time to first token in the last 7 days, and the calls in 30 days. The daily speed summaries are kept in the usage history (`spd` in `usage-history.json`): today's (together with each hour of the last 24 hours) is calculated every 5 minutes; for days in the last 7 days that have calls but no summary (or an empty summary), one day is calculated in the background every 2 minutes (like opening the call details of that day, this reads the call records of each conversation of that day, and from v2.0.16 it waits for the agy CLI calls too; the Antigravity window must be in front); for older days, the summary is made when you open the call details of that day.
- **Bottom lines**: the total (cost and tokens) and daily average for the period; from v2.0.9, one line for the extra cost of today's cache misses, for example `cache miss today +$60.67 (34%) · your pause $27.90 · other $24.61` (hover to see the number of calls and the cost for each cause; click to open today's call details with only the missed calls); and one line for each weekly limit group (see "Weekly limit estimate" below).
- **`↺` early reset** (from v2.0.4): if a weekly limit is reset before its planned reset time (for example, on 2026-11-24 Google reset the Gemini weekly limit early), the date under that day's bar and the limit cell in the table get a `↺`. Hover to see when the reset happened, how much was used before it, and the planned reset time. If the current period started after an early reset, the bottom line ends with `↺ early reset 11-24`.

The data is kept in `usage-history.json` in the data folder for 400 days (from v2.0.5; before, 90 days). It holds only amounts, call counts, token counts and limit ratios, not conversation content. Limit records are kept for each account separately, so they do not mix after you change accounts. The file keeps only the masked email and an account ID (a hash of the email), not the full email.

**Compaction viewer** (from v2.0.8): click the compaction badge `↻N×` after the context to see what the agent still has after the last compaction. When the backend compacts the context, Antigravity replaces the old steps with one resume message: all your requests from the removed part (as written), a checkpoint summary (task overview, progress, key findings, errors and fixes, active context, next steps, commitments and constraints), the list of artifacts, and the location of the conversation log. File contents that were read, command output and reasoning are gone. The viewer shows the number of requests and artifacts and the summary. It reads them from the local conversation log (`~/.gemini/antigravity/brain/<conversation>/.system_generated/logs/transcript_full.jsonl`), read-only. If the agent "forgets" something after a compaction, first check if the summary has it, then remind the agent of the missing part.

**Cache misses** (from v2.0.9): in each conversation, each call is compared with the last large call (input of 20k tokens or more) of the same model. If the earlier context could have come from the cache but this call paid the full price for it, the call is a cache miss. Missed tokens = the smaller input of the two calls − the cache read of this call; less than 20k missed tokens is not counted. Extra cost = missed tokens × (full input price − cache read price); for Claude, a miss writes the content to the cache, so the cache write price is used. The cause is found in the order of the table:

| Cause | Shown as | Rule |
| --- | --- | --- |
| Model change | `model switch` | The first call of this model in the conversation, and the last large call used another model (the cache of the new model is empty) |
| Compaction | `compaction` | A compaction step is between the two calls, or the input is more than 40% smaller than before |
| You waited | `your pause` | 1 minute or more after the end of the last call, and you sent a message between them |
| Pause in a turn | `agent pause` | 1 minute or more, and no message from you between them (a long command, waiting for your approval, waiting for a subagent) |
| Pause (agy CLI) | `pause` | agy CLI calls have no step data, so it is not known whether you sent a message between them |
| Other | `other` | Less than 1 minute after the end of the last call (the server did not use its cache, or the earlier content changed) |

The limits come from 4143 calls on the author's computer from 11-17 to 11-24: when two calls in a conversation are less than 30 seconds apart, the Gemini cache hit ratio is 90% to 95%; at 2 to 5 minutes, 59% of the Hydrogen calls and 41% of the Carbon calls had no cache hit at all; the Claude cache stops after about 5 minutes (few samples). In these 7 days, misses cost about $161 more, 39% of the cost: about $91 after pauses of 1 minute or more, about $61 after less than 1 minute, and less than $9 for compaction and model changes together. The data is the same as in the call details (read from the local backend, read-only, not sent to Google). It is an estimate: the missed tokens assume that the earlier context should have come from the cache, but the server decides what it actually reuses.

**agy CLI usage** (from v2.0.4): when other tools call the agy CLI directly, they use the same account, so the limit percentages already include the CLI usage. The plugin also opens the CLI conversation databases read-only (`~/.gemini/antigravity-cli/conversations/*.db`, under `%USERPROFILE%` on Windows), groups the time, model and token counts of each call by day, and adds them to today's cost in the status bar, the cost / calls / tokens in the panel, `cap ≈`, and the call details (the conversation column shows `CLI · title`). The hover text shows the desktop part and the CLI part separately. The first time, it reads all CLI databases (167 databases, 1.7 GB, about 7 seconds on the author's computer); after that, it reads again only the changed ones, every 30 seconds. When today's usage changes, the status bar is updated at once, so while the CLI is running it is at most about 30 seconds late. In the call details, the CLI conversation names come from the CLI's own conversation summaries; conversations started by other tools usually have no title, so the start of the first message is shown.

**Weekly limit estimate** (one line for each group, for example `Gemini weekly · 3% used · cap ≈ $952 / 2.15B tok (rough) · resets 11-29 09:41 · est 45% at reset (rough)`):

- `cap ≈`: this computer's estimated cost and tokens in this limit period (from 7 days before the reset time to the reset time), divided by the percent used in the period. It estimates how much cost and how many tokens the full weekly limit is worth. From v2.0.5, on the day the period starts, only the calls after the start time are counted (by the time of each call; until that is calculated, the whole day is used).
- `est … at reset`: at the recent usage rate, about how much will be used at the reset time. If the limit will run out before that, it shows `full` and the expected time. The rate comes from the average of this period and from the last 24 hours (with at least 6 hours of readings). The readings are kept in `quota-samples.json` for 8 days.
- Both numbers have `(rough)`: the used ratio goes up and down, and early in a period, with little use, the error is large. Hover to see the method and the remaining limit.
- Earlier periods (from v2.0.6): at each period change (a normal reset or an early reset), the plugin records the start and end time and how much was used before the end. The hover text lists the cost and `cap` of the last 4 periods (the cost uses the time of each call). After a few periods, a clearly smaller `cap` can mean that the limit was made smaller. Before v2.0.6, only early resets were recorded.

The weekly limit used in a day is the net change in each limit period: the last used ratio seen that day minus the used ratio at the start of the day. If a new period starts during the day, the parts are added. The reason: in one period the used ratio goes up and down (in one test, it went from 1.699% to 1.594% in 6 minutes while the model was generating). v1.4.x added only the increases, so an increase after a drop was counted again and the daily number was too high. After you upgrade to v1.5.0, earlier weekly records are calculated again with the new method. From v2.0.4, each period is recorded as a separate part. When a limit is reset, the readings sometimes go back to the old period once (seen on 2026-11-24); the plugin then continues that old part and does not count the old period's usage again as new usage (that day was recorded as 14.84%; the correct number was 7.06%). After the upgrade, days that the readings in `quota-samples.json` cover completely are calculated again once.

- Limit used while Antigravity is closed (for example with the agy CLI) is counted on the next day that the plugin sees it.
- The limit belongs to the account. If the account uses Google family sharing, or is also used on another computer, the limit includes other people's usage. Then `cap ≈` is too low (their usage raises the limit, but their cost is not in this computer's cost), and `est` is too high.

After the install, the plugin fills in earlier days once: it opens Antigravity's own conversation databases read-only (`%USERPROFILE%\.gemini\antigravity\conversations\*.db` on Windows, `~/.gemini/antigravity/conversations/*.db` on macOS), reads the time, model and token counts of each call, groups them by day, and the status bar prices them with its price table. Filled-in days have no limit data (nobody recorded it then). Each call is put on the day of its own time. v1.5.x used the start time of the turn, so a turn that ran past midnight was put on the day before (in one test, one day was missing 349 calls). From v1.6, earlier filled-in days are calculated again once after the upgrade. The fill-in uses the built-in `node:sqlite` of Node.js; the plugin runs on the Node that comes with Antigravity (24.x), which has it. It depends on Antigravity's internal storage format, so if that format changes, earlier days cannot be filled in; other features are not affected. From v2.0.5 the history is kept for 400 days, and after the upgrade the fill-in runs again once (for both the desktop and the CLI), so days older than 90 days that were deleted before come back.

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
- By default, prices come from the online price table `data/prices.json` (see [Online updates](#online-updates)). Hover over `$x today` to see whether the online or the built-in prices are used. The built-in prices are in `PRICES` in `statusbar.js`; they are used when online updates are off or the download fails.
- Today's cost: the sum of calls after midnight in the conversations you used today. The amount for each conversation is saved in `cost-day.json` in the data folder, so it is not reset when Antigravity restarts. It starts again from zero after midnight. From v2.0.10, each call counts by its own start time. Before, it counted by the time of the latest step of its turn: when a turn ran from before midnight to after midnight, all calls of the turn counted on the second day, and the calls before midnight had already counted on the day before (on the author's computer on 11-25: $14.18 today, but $7.46 by the time of each call). After the update, today's cost is calculated again from zero; earlier days do not change, because an overcount cannot be told apart from a deleted conversation. From v2.0.11, the price is also chosen by the time of each call: when the time of a call is not known, the known calls before and after it give a time range; if a price change (for example, Carbon and Argon on 2026-12-01 08:00 UTC) is in that range, the plugin gets the time of each call. Before, a conversation started today used its start time for the price. Side questions (`/btw`) and forked conversations (from v2.0.13): when Antigravity makes them, it copies all steps and call records of the original conversation. The plugin counts only their own calls (the copied steps are older than the conversation), so the copied calls no longer count in today's cost, the call details or the conversation total. Before, one `/btw` in a large conversation counted the calls of the original conversation again (on the author's computer on 11-26: the side question itself cost $1.36, but today's cost showed $13.79); after the update, today's cost is calculated again from zero. A forked conversation does not always show where it came from (for example, when the original conversation is not loaded), so for a conversation started today the plugin first gets the step times once, and counts it in today's cost only after it is sure that the conversation is not a copy. This usually takes a few seconds. When a conversation is found to be a copy, its amount for today can go down. Also note: a `/btw` side question cannot read the cache of the original conversation (tested on 11-26), so each one pays the full price for the whole context, which is more than one US dollar in a large conversation.

</details>

### Plugin panel

<img src="docs/images/panel.png" alt="The plugin panel" width="420">

"Plugins" menu at the top right of Antigravity → agy-zh. The panel uses the colors and fonts of the current Antigravity theme. From v2.0.15 the panel has this layout:

- **Top**: the version and a status dot (all OK / new version / files do not match the signature / standby / not connected). Click the dot to expand "高级" (advanced). When Antigravity was started without the debugging port flag, when a new version is out, or when the last update failed, a banner shows below, with a "带参数重启" (restart with the flag) or "更新" (update) button.
- **今天 (today)**: four cards, each answering a question that the status bar does not. Cost: today's cost, number of conversations and calls (the agy CLI cost is shown separately). Quota: the 5-hour and weekly quota of the current model group, with a time-progress mark, and below it the estimated weekly use (or, when more than half of the 5-hour quota is used, when it resets). Generation speed: the median tok/s of the model with the most calls in the last hour, compared with usual (the 7 days before); click it to see the speed chart below. Cache misses: the extra cost today, its share of today's cost and the largest cause; click it to open today's call details with only the misses. A card that is not normal is yellow (weekly quota estimated over 100%, more than half of the 5-hour quota used, speed more than 40% slower than usual, misses at 30% or more of the cost). The line below is the current conversation: total cost, context, compactions, and the cache hit ratio of the last call. Three buttons open the "每日用量" (daily usage), "调用明细" (calls) and "外观" (look) pages of the daily usage panel in the Antigravity window. The status bar preview shows only when "显示用量状态栏" (show the usage status bar) is off.
- **最近 7 天 / 生成速度 (last 7 days / generation speed)**: the `花费 | 速度` (cost | speed) switch at the top right of the card. Cost: the cost of each day in the last 7 days (at API standard prices); click a bar to open the calls of that day. Speed: the median generation speed of each hour (tok/s, up to 3 models); `24 小时 | 今天` (24 hours | today) switches between the last 24 full hours and today from 0:00. The legend gives the speed of each model now (the last 60 minutes) and usually (the median of the daily medians of the 7 days before today); when now is more than 40% slower than usual, it is yellow. Move the mouse over the chart to see the speed and number of calls of each model in that hour (in the current hour, also the speed of the last 60 minutes); click the chart to open the speed page of the daily usage panel.
- **显示 (display)**: the "中文界面" (Chinese UI) switch. The main window and the Swarm panel switch together, at once, and the setting stays after a restart. The line below it gives the shortcut to switch back to English for a moment, and "现在切换" (switch now). The "显示用量状态栏" (show the usage status bar) switch: when it is off, you can still open the daily usage panel with the buttons above.
- **更新与启动 (updates and start)**: the plugin version and a "检查" (check) button; the switch for online updates of the dictionary and prices, and the time of the last check; when Antigravity starts without the debugging port: ask / auto reopen / do nothing, see [Without the debugging port flag](#without-the-debugging-port-flag).
- The details of the settings (number of dictionary entries, date of the price table, download address, what each option does) are in the hover tooltips.
- **高级 (advanced)** (closed by default): whether injection, the debugging port, the translation and the status bar work; whether the files in the plugin folder match the signed manifest; the memory the plugin uses (RSS includes program files shared with Antigravity; the JS heap is the plugin's own objects); the untranslated UI text (from v2.0.7), see [Untranslated UI text](#untranslated-ui-text).

The panel shows no email or other personal data. The "当前对话" (current conversation) card shows the conversation title and cost, and the untranslated UI text can include names such as project names and conversation titles. The panel API listens only on `127.0.0.1` and needs the token that Antigravity gives to the panel.

After the plugin restarts (after a version update or a reinstall), Antigravity opens the panel again. If the plugin cannot be reached at that moment, the panel stays on the Antigravity page "plugin unavailable", and Antigravity does not try again. From v2.0.3, when the plugin finds that the panel does not show its page, it reloads the panel (up to 6 times). If this does not help, close the panel and open it again.

### Online updates

Antigravity adds new UI text when it updates, and Google changes prices. So that a new version is not needed each time, the plugin downloads a few data files from this project's GitHub repository every 6 hours:

| File | Contents | Updated by |
|---|---|---|
| `i18n/zh-CN.json`, `i18n/zh-CN.rules.json` | Dictionary and rules | The author pushes new translations |
| `data/prices.json` | The price of each model | GitHub Actions checks the official pricing pages of Google AI Studio and Vertex AI every day and commits only when a price changes (`tools/update-prices.mjs`) |
| `data/meta.json` | The latest version number | Changed at each release |

- **Only data is downloaded here.** The dictionary and rules are only put into the UI as text (not as HTML), and prices are only numbers. Code updates are installed only when you click in the plugin panel; see [Version updates](#version-updates).
- **The download uses Antigravity's own network.** The requests go out from the Antigravity page, with Antigravity's network and proxy settings, without cookies or a Referer. The addresses are tried in this order: `cdn.jsdelivr.net`, `fastly.jsdelivr.net`, `gcore.jsdelivr.net`, `raw.githubusercontent.com`. The last address that worked is tried first.
- **Downloads by commit.** The plugin first asks GitHub (`api.github.com`) for the latest commit on the main branch, then downloads all files at that commit. Files at a commit do not change, so every address gives the same, current content. If GitHub cannot be reached (for example, because of a rate limit), the plugin gets `data/meta.json` from all addresses and uses the address with the newest content. v2.0.1 and earlier downloaded only by branch, so when one jsDelivr node had an old cache, the plugin could get an old dictionary and miss the new version notice for hours; v2.0.2 fixes this.
- **Files are checked before use.** A file with a bad format, with more than 20% fewer entries than the bundled one (for example, a partial download), or with prices out of range is not used; the old data stays. After a failure, the plugin tries again in 30 minutes.
- Online dictionary entries replace bundled entries with the same text; the other bundled entries stay. If you deleted the bundled dictionary (status bar only), the online dictionary is not used either. Models in the online price table use the online price; other models use the built-in price.
- Text whose translation changed is updated at once; entries that are no longer in the online dictionary go back to English.
- The downloaded files are kept in `remote/` in the data folder and are used again after Antigravity restarts. After you install a new version, the saved dictionary is not used until the next download (about 1 minute after the plugin starts). v1.7.0 had a bug: after a restart, the saved price table and version info could not be read until the next download (up to 6 hours). v2.0 fixes it.
- **To turn it off**: plugin panel → 更新与启动 (updates and start) → set "词典和价格" (dictionary and prices) to "关闭" (off); or daily usage panel → `theme` → `updates` at the bottom → `off`. Both are the same switch. Then nothing is downloaded, the dictionary and prices come only from the plugin, and no new version is checked.

### Version updates

When a new version is out, the top of the plugin panel and the top right of the daily usage panel show it. Click "更新" (update) in the banner of the plugin panel:

1. The plugin downloads the signed manifest `plugin-manifest.json` from the tag of that version (`@v<version>` on jsDelivr, with raw.githubusercontent.com as a fallback) and checks its Ed25519 signature with the author's public key in the plugin. If the signature is wrong, it stops and downloads no files.
2. It downloads each file in the manifest and checks its sha256 and size. If any file does not match, it stops: the plugin folder is not changed, and the partial download is deleted.
3. When all files match, it backs up the current files to `backup/v<current version>/` in the data folder, then replaces the files one by one. If a replacement fails, it restores the backup.
4. The plugin restarts by itself (about 2 seconds). You do not need to close Antigravity; open windows are injected again.

- The private key for signing is only on the author's computer, not on GitHub. So even if the GitHub account or repository is changed by someone else, code without the author's signature cannot be installed. The public key fingerprint is `246b2f1a387df2c5`.
- When the plugin starts, it compares the files in the plugin folder with the signed manifest. The result is the "插件文件" (plugin files) line under "高级" (advanced) in the panel.
- Like the dictionary, the update is downloaded from the Antigravity page. If no window is open, the plugin downloads it directly.

### Optional: the author's color theme

A warm white color theme in the Claude style. Off by default.

| Theme | Background | Text | Accent |
|---|---|---|---|
| Light | `#FAF9F5` | `#141413` | `#D97757` |
| Dark | `#262624` | `#FAF9F5` | `#D97757` |

- It only changes the theme colors. Zoom, font and contrast stay the same.
- Before it changes them, it saves your old colors in `originals.json` in the data folder. Switching back or uninstalling restores them from that file.
- The installer asks once (Enter = no). After the install, run `配色开关` (color toggle) to switch it on or off.
- The colors are stored in Antigravity's own settings file (`customThemeSeedsLight` / `customThemeSeedsDark` in `~/.gemini/config/config.json`). Antigravity writes this file back while it runs, so the toggle closes Antigravity first, changes the colors, and opens it again.

### Context limit

v1.1.0 to v1.3.0 had an optional "unlock 512K context". It was removed on 2026-11-20 because the official default limit is now higher: on Antigravity 2.33.0, with the unlock off, a new conversation shows 512k for Gemini 4 Neon and Gemini 4 Carbon and 840k for Claude Opus 5.5. With these defaults, adding 512000 does nothing for Gemini, and it lowers the limit for Claude from 840k to 512k. If you installed an old version and turned the unlock on, the old setting is removed when you install v2.0.

## Without the debugging port flag

The plugin changes the UI through the Chromium remote debugging port of Antigravity. From Antigravity 2.33.0, the port opens only when Antigravity starts with the flag `--remote-debugging-port`.

- **Windows**: the installer adds `--remote-debugging-port=0` (`0` = a random port) to the Antigravity shortcuts in the Start menu, on the desktop and on the taskbar. The uninstaller removes it. Only shortcuts whose target is `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe` are changed. After an automatic update, Antigravity can rewrite its shortcuts; when the plugin finds no port, it checks every 2 minutes and adds the flag again.
- **macOS**: Antigravity opened from the Dock or Launchpad never has the flag.
- **When Antigravity started without the flag this time**: the plugin finds out after about 20 seconds and acts on the "没带调试端口启动时" setting in the panel:
  - **询问 (ask)** (Windows default): a dialog asks whether to restart Antigravity now. Click "确定" (OK) to restart; click "取消" (Cancel) and it does not ask again for this start.
  - **自动重开 (auto reopen)** (recommended on macOS at install): it restarts without asking.
  - **不处理 (do nothing)**: nothing happens, and the UI stays in English.
- Before it asks or reopens, the plugin checks how the running Antigravity was started. It asks or reopens only if the flag is really missing. If the flag is there and the port is only slow to answer (for example, when the computer is busy), the plugin does nothing and writes one line to its log. v2.0.0 did not do this check and could restart an Antigravity that had the flag; v2.0.1 fixes this.
- How the restart works: it closes Antigravity normally, ends it if it has not quit after a few seconds, then opens it with the flag. Your conversations are kept; running tasks are interrupted. In tests, it took about 6 seconds from close to injection. The reopen adds only the debugging port flag: other flags that you put on your shortcut are not used for this start.
- To check the Windows shortcuts by hand: `powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.gemini\config\plugins\agy-zh-pack\debug-port.ps1" -Mode check`.

## Risks

Read this section before you decide to use the pack.

- Section 6 of the Antigravity additional terms of service says you must not abuse, harm or interfere with the service, including "using the Service in connection with products not provided by us". A breach can get your Antigravity and Gemini CLI accounts suspended or terminated. This project is a third-party tool. The author cannot promise that using it does not break the terms.
- This project only changes the local UI. The status bar only reads local data and does not change what is sent to Google.
- Antigravity starts the plugin in the background and runs it on the Node that comes with Antigravity. It uses about 80 to 120 MB of memory.
- Online updates download the dictionary and price table from this project's GitHub repository. If someone tampered with the repository, the UI could show changed text (no code runs, and your data cannot be read). If you do not accept this, turn online updates off in the plugin panel.
- Version updates download and run new code, but only versions signed by the author (see [Version updates](#version-updates)). If the author's private key leaked, someone else could sign a version that looks like the author's.
- The auto reopen without the debugging port flag closes Antigravity, so running tasks are interrupted. If you do not want this, choose "ask" or "do nothing" in the panel.
- This project depends on the internal page structure and APIs of Antigravity. After an Antigravity update, some features can stop working, and new UI text shows in English until the dictionary is updated.
- The start flag opens a debugging port on `127.0.0.1` on your computer (Antigravity before 2.33.0 opened it by default). Other programs on your computer can use this port to control the Antigravity window. If you do not accept this, do not use this project.

## What the installer does

The installer runs on the Node that comes with Antigravity (`Antigravity.exe` on Windows, `Antigravity Helper` on macOS), so you do not need to install Node.js.

1. It checks the package: the author's signature and the sha256 of each file, against `plugin-manifest.json`. If they do not match, it does not install.
2. If Antigravity is open but was started without the debugging port flag, it asks you, closes Antigravity, and opens it again with the flag after the install.
3. Migration from v1.x: it stops the old injector, removes the old autostart (the scheduled task `AgyZhPack` and the script in the Startup folder on Windows, the LaunchAgent on macOS), moves the daily records, look, limit readings, saved colors and `style.css` to the data folder, and deletes the old install folder `%LOCALAPPDATA%\AgyZhPack` on Windows. On macOS, the source folder of an old version run from source is not touched.
4. It copies the plugin to the **plugin folder** `~/.gemini/config/plugins/agy-zh-pack` (`%USERPROFILE%\.gemini\config\plugins\agy-zh-pack` on Windows). If Antigravity is open, it starts the plugin within a few seconds (tested on macOS). If it does not, restart Antigravity once.
5. Windows: it adds the start flag to the Antigravity shortcuts. macOS: it asks whether to reopen Antigravity automatically when it starts without the flag.
6. It asks whether to use the author's color theme (default: no).

The **data folder** is `~/.gemini/antigravity/plugin_data/agy-zh-pack` (`%USERPROFILE%\.gemini\antigravity\plugin_data\agy-zh-pack` on Windows). A version update replaces the whole plugin folder, so the data is kept outside it. It holds: `cost-day.json` (today's cost), `usage-history.json` (daily usage), `quota-samples.json` (limit readings), `cli-index.json` (the days on which each agy CLI database has calls), `i18n-missing.json` (untranslated UI text), `look.json` (status bar look and the online update switch), `settings.json` (what to do on a start without the flag), `originals.json` (saved colors), `remote/` (files from online updates), `inject.log` (log) and `relaunch.log` (restart records). If a data file cannot be read (for example, it is damaged), it is renamed to `<name>.bad-<date and time>.json` and kept, so new data does not overwrite it. If another program holds the file for a short time (for example, an antivirus scan), the plugin tries again a few times; if it still cannot read the file, it does not use or save it this time and reads it again later, so empty data does not overwrite the file (from v2.0.11; before, the file was treated as missing and was overwritten at the next save).

It does not change zoom, font or contrast. It changes colors only if you choose the author's color theme.

## Uninstall

Run `一键卸载` (uninstall): double-click `一键卸载.cmd` on Windows; on macOS, run `一键卸载.command` with `bash` in Terminal.

- It removes the start flag from the shortcuts and deletes the plugin folder. If Antigravity is open, it stops the plugin within a few seconds; reload the window and the UI goes back to English.
- If you used the author's color theme, it asks whether to restore your old colors (it closes Antigravity first and opens it again after).
- If Antigravity is closed, it also removes the entries that Antigravity keeps for this plugin in its settings file.
- At the end it asks whether to delete the data folder too. If you keep it, a later reinstall continues with your daily records.
- If the plugin folder is in use and cannot be deleted (rare), it tells you to close Antigravity and delete the folder by hand.

Keep the extracted folder: you need it to uninstall and to use the color toggle.

<details>
<summary>If you installed the old v1.0.0</summary>

v1.0.0 changed the look directly at install time (131% zoom, strong contrast, system font, warm white colors). From v1.1.0, zoom, contrast and font are no longer changed, and the color theme is optional:

- When you upgrade, the zoom, contrast and font set by the old version stay as they are. The color question says that you use the author's color theme now. Type n to go back to your old colors.
- To restore everything to how it was before you installed the old version: run `一键卸载` (uninstall), choose to restore, then install again.

</details>

## Tested versions

Tested with Antigravity 2.35.2 (real Windows 11 and macOS computers). For what each version was tested with and what was not tested, see [docs/testing.en.md](docs/testing.en.md).

## How it works

- The status bar listens in the page to the data between the app and the local backend. It does not change the requests that the app sends. From Antigravity 2.35, the app uses one WebSocket (`/connect-websocket` on the same origin; the status bar listens only to this connection to the local backend) by default: the status bar wraps the `send` of `WebSocket`, takes the CSRF token from the frames that the app sends, and reads only the replies of the state stream, the account and the quota. If the WebSocket cannot connect and the app uses HTTP (as in 2.34 and earlier), the status bar wraps `fetch` and listens to the grpc-web+json data. It also calls a few read-only local APIs: quota, the signed-in account (email and plan; the email is used only in the page to make the account ID and the masked text, and is not written to a file), the actual model name, subagent status and steps, and the token usage and time of each call (for the cost and the call details).
- By default, it does not write Antigravity's settings files. It writes them only in two cases: you choose the author's color theme (or switch back), which changes the two theme color groups in `~/.gemini/config/config.json`; or you choose to restore on uninstall, which writes the saved values back to that file (and to `%APPDATA%\Antigravity\app_storage.json` if you installed the old v1.0.0). The uninstaller also removes the entries that Antigravity keeps for this plugin.
- It connects to only three places: Google Fonts for the status bar icons; api.github.com for the latest commit of this repository, then jsDelivr (or raw.githubusercontent.com) for its data files ([Online updates](#online-updates), which you can turn off); and the new version when you click "更新" (update) in the plugin panel.

For how the plugin starts, injects and reopens Antigravity, and for running from source, tests, build and release, and what each file does, see [docs/development.en.md](docs/development.en.md).

## Credits

- The look and the English wording of the status bar follow the cometix theme of [CCometixLine](https://github.com/Haleclipse/CCometixLine) (ccline) by Haleclipse. The layers of the v1.5.0 look (palette, style, bars, detail) and the context ring follow ccline v2. Thanks to Haleclipse for such a good-looking status line.
- The display of the 5-hour and weekly limits follows agyline.
- The default palette, Cometix, is based on [Catppuccin](https://catppuccin.com) (Latte for light, Mocha for dark). The other palettes use the published colors of Catppuccin, [Tokyo Night](https://github.com/folke/tokyonight.nvim), [Rosé Pine](https://rosepinetheme.com), [Gruvbox](https://github.com/morhetz/gruvbox), [Nord](https://www.nordtheme.com) and [Dracula](https://draculatheme.com) (its light version is the official Alucard).
- Icons: Material Symbols and, for the plugin icon, the Material Icons "translate" icon (Apache License 2.0). The alternative model icon (a comet) is the meteor icon of [Font Awesome Free](https://fontawesome.com) 6.7.2, license [CC BY 4.0](https://fontawesome.com/license/free), copyright Fonticons, Inc.

## License

The code of this project uses the MIT license. See [LICENSE](LICENSE).

Antigravity is a Google product. The keys in the dictionary `zh-CN.json` are the original English UI text of Antigravity, used to match the text to translate.
