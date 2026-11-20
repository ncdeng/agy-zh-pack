<div align="center">

# agy-zh-pack

[简体中文](README.md) | [English](README.en.md)

**Antigravity 桌面版（Windows）的非官方中文美化包**

界面汉化 · 输入框上方的用量状态栏 · 可选配色

[![下载](https://img.shields.io/github/v/release/ncdeng/agy-zh-pack?label=%E4%B8%8B%E8%BD%BD&color=D97757)](https://github.com/ncdeng/agy-zh-pack/releases/latest)
[![License](https://img.shields.io/github/license/ncdeng/agy-zh-pack)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6)

![输入框上方的用量状态栏](assets/statusbar.png)

<sub>实际截图：一个长对话</sub>

</div>

> [!WARNING]
> 这是第三方项目，和 Google 没有关系。默认只改本机显示、只读本机数据；安装前请先读 [风险](#风险)。

> [!IMPORTANT]
> **Antigravity 2.33.0 起，旧版美化包（v1.2.1 及以前）会失效**：界面变回英文，状态栏也不出现。原因是 2.33.0 不再默认打开调试端口。请下载 v1.3.0 或更新的版本，重新运行一次 `一键安装.cmd`。详见 [快捷方式参数](#快捷方式参数)。

> [!NOTE]
> **“解锁 512K 上下文”已经去掉（2026-11-20）**：Antigravity 官方默认的上下文上限已经提高，再解锁反而会把 Claude 的上限压低。装过旧版并打开过解锁的，请下载最新版重新运行一次 `一键安装.cmd`。详见 [上下文上限](#上下文上限)。

## 快速开始

1. 安装 Antigravity，并登录一次。
2. 从 [Releases](https://github.com/ncdeng/agy-zh-pack/releases/latest) 下载最新的 `agy-zh-pack-v<版本>.zip`，解压到任意位置（不要在压缩包里直接运行）。
3. 双击 `一键安装.cmd`。弹出“Windows 已保护你的电脑”时，点“更多信息”，再点“仍要运行”。
4. 安装中会问一个可选项：要不要用作者的配色。不确定就直接按回车（不用）。
5. Antigravity 开着的话不用关。装好后在 Antigravity 里按一次 `Ctrl+R`，状态栏就会出现。如果它这次启动时没带调试端口参数，安装程序会问你，回车后自动重开一次。
6. 以后请从开始菜单、桌面或任务栏的图标打开 Antigravity。安装程序给这些快捷方式加了启动参数。

以后想换配色：双击 `配色开关.cmd`。卸载：双击 `一键卸载.cmd`。

## 默认状态

| 功能 | 默认 | 会不会改发给 Google 的内容 |
|---|---|---|
| 界面汉化 | 开 | 不会，只改本机显示 |
| 用量状态栏 | 开 | 不会，只读本机数据 |
| 作者的配色 | 关 | 不会，只改本机 Antigravity 的主题颜色 |

缩放、字体、对比度一律不改。

## 功能

### 界面汉化

菜单、设置、按钮、提示文字换成中文（3125 条词典 + 60 条正则规则）。对话内容、代码、文件名不翻译。

#### 只要状态栏、不要汉化

删掉 `%LOCALAPPDATA%\AgyZhPack\i18n\zh-CN.json`，再在 Antigravity 里按一次 `Ctrl+R`，界面就恢复英文，状态栏照常显示。重新安装会把这个文件装回来。

### 用量状态栏

输入框上方固定两行，每一项是“彩色图标 + 同色文字”。状态栏上的字和 ccline 一样用英文，鼠标停在任何一项上会显示中文的详细说明。

| 行 | 显示示例 | 含义 |
|---|---|---|
| 第一行 | `gemini-flash-worker-agy` | 模型：界面上的名字，加上接口实际返回的模型名。Gemini 模型两者对不上时标黄 |
| | `89% · 456k / 512k · compacted 3×` | 上下文：已用比例、已用 / 上限、被自动压缩过几次 |
| | `450k · 99% hit` | 缓存：最近一次调用从缓存读取的 token 和命中率 |
| | `$17.81` | 这个对话累计花费（含子代理）。悬停可以看最近一次调用的输入、缓存、输出 token 数和各自的金额 |
| | `$17.85 today` | 今天累计花费（本地 0 点起，所有对话）。点一下打开 [每日用量面板](#每日用量面板) |
| | `running` | 正在生成 |
| 第二行 | `6.9s` | 首字时间 |
| | `169 tok/s` | 生成速度 |
| | `0% · 16:44` | 5 小时额度：已用比例（10 格进度条）、重置时间 |
| | `41% · Sat 16:08 · ↑15%` | 每周额度：已用比例、重置时间、比匀速用完快（↑）或慢（↓）多少 |
| 子代理 | `self · … · running` | 每个在跑的子代理单独一行，跑完约 10 秒后收起。打开子代理窗口时，显示那个子代理自己的数据 |

外观借鉴 Haleclipse（哈雷）的 [CCometixLine](https://github.com/Haleclipse/CCometixLine)（ccline，Claude Code 的状态栏工具）的 cometix 主题：两行显示、彩色图标配同色文字、`|` 分隔各项、`·` 连接同一项里的数字、额度用 10 格进度条。本项目没有用它的代码，状态栏是为 Antigravity 重新写的。

#### 每日用量面板

点状态栏上的 `$x today`，状态栏上方会弹出一个面板。再点一次、点面板外面或按 `Esc` 关掉。

- **柱状图**：最近 7 天或 30 天每天的折算花费，按模型分颜色。鼠标停在柱子上看当天的明细。
- **表格**：每天一行，有花费、对话数、调用数、输入 / 缓存 / 输出 token、缓存命中率，以及当天用掉了多少个百分点的每周额度（Gemini 组和 Claude 组分开）。
- **底部**：这段时间的合计和日均；每组额度现在用了多少、这段时间用掉多少，以及按折算花费估算的“1% 每周额度大约值多少钱”。

数据存在安装目录的 `usage-history.json`，保留 90 天，只存金额、调用数、token 数和额度比例，不存对话内容。从装上这一版那天开始记录，以前的天数没有数据。每周额度按注入程序观察到的变化累计：Antigravity 没开着时用掉的额度（比如用 agy CLI），会算到下次观察到的那一天。

#### 费用怎么算

费用 = token 数 × Google / Anthropic 公开的 API 标准价，折成美元。**这是折算值，不是实际扣费**：订阅是按额度扣的。

<details>
<summary>单价表（美元 / 百万 token）</summary>

| 模型 | 输入 | 缓存读取 | 输出（含思考） |
|---|---|---|---|
| Gemini 4 Neon（含 Orchestrator (Neon) 的规划） | $3 | $0.15 | $15 |
| Gemini 4 Carbon / Argon（含 Orchestrator 的规划） | $2（12-01 起 $4） | $0.10（12-01 起 $0.20） | $10（12-01 起 $20） |
| Gemini 4 Hydrogen（含 Orchestrator 的执行模型） | $1.50 | $0.075 | $7.50 |
| Gemini 3.8 Flash | $0.75（2027-01-01 起 $1.50） | $0.075（同日起 $0.15） | $3.75（同日起 $7.50） |
| Claude Opus 5.5 | $4 | $0.20 | $20 |
| Claude Sonnet 5.5 | $2 | $0.10 | $10 |

- Claude 的缓存写入按 5 分钟缓存计：Opus 5.5 $5、Sonnet 5.5 $2.50。
- GPT-OSS 120B 没有单价，不计入。
- 出处：Google AI Studio 价格页（2026-11-16；Neon 2026-11-19）、Anthropic 官方价（2026-11-03）。Claude 在 Antigravity 里经 Google Vertex 调用，实际价格可能不同。
- 单价写在 `statusbar.js` 的 `PRICES` 里，价格变了改这里。
- 今天的花费：今天动过的对话里，0 点以后的调用加起来。每个对话今天的金额记在安装目录的 `cost-day.json`，Antigravity 重启后不会清零；过了 0 点自动重新开始。

</details>

### 可选：作者的配色

Claude 风格的暖白配色，默认不用。

| 主题 | 背景 | 文字 | 强调色 |
|---|---|---|---|
| 浅色 | `#FAF9F5` | `#141413` | `#D97757` |
| 深色 | `#262624` | `#FAF9F5` | `#D97757` |

- 只改主题颜色，不改缩放、字体和对比度。
- 换上前，原来的颜色记在 `%LOCALAPPDATA%\AgyZhPack\originals.json`，换回或卸载时按它恢复。
- 一键安装时会问一次（回车 = 不用）；装好以后双击 `配色开关.cmd` 换上或换回。
- 颜色存在 Antigravity 自己的设置文件里（`%USERPROFILE%\.gemini\config\config.json` 的 `customThemeSeedsLight` / `customThemeSeedsDark`）。Antigravity 运行时会把这个文件写回去，所以换颜色时要先关闭它，改完会自动重新打开。

### 上下文上限

v1.1.0～v1.3.0 有一个可选的“解锁 512K 上下文”：当时 Antigravity 桌面版在对话约 25.6 万 token 时就自动压缩，解锁后给请求补上 `checkpointConfig.maxTokenLimit = 512000`，把压缩线提高到 51.2 万 token。

2026-11-20 起这个功能去掉了。原因是官方默认的上限已经提高：在 Antigravity 2.33.0 上关掉解锁、新开对话，状态栏显示的上限如下。

| 模型 | 官方默认上限 |
|---|---|
| Gemini 4 Neon | 512k |
| Gemini 4 Carbon | 512k |
| Claude Opus 5.5 | 840k |

这时再补 512000，对 Gemini 没有作用，反而会把 Claude 的上限从 840k 压到 512k。

- **装过旧版、打开过解锁的**：下载最新版，重新运行一次 `一键安装.cmd`，安装程序会删掉旧设置（安装目录里的 `config.json`）。升级以后，旧文件夹里的 `上下文开关.cmd` 就不起作用了。
- **从源码运行的**：`inject.mjs` 不再读取 `config.json`，可以删掉这个文件。

## 快捷方式参数

Antigravity 2.33.0 以前，主程序启动时总会打开 Chromium 远程调试端口，注入程序靠它连上窗口。2.33.0 起，只有带启动参数 `--remote-debugging-port` 打开时才有这个端口。

- 安装程序给开始菜单、桌面、任务栏上的 Antigravity 快捷方式加上 `--remote-debugging-port=0`（`0` = 随机端口），卸载时去掉。只改目标是 `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe` 的快捷方式。
- 请从这些快捷方式打开 Antigravity。直接双击 `Antigravity.exe`、或用别的方式打开时，界面会是英文。
- Antigravity 自动更新后可能重写快捷方式，或者自己重新启动（不带参数）。注入程序找不到端口、而 Antigravity 正开着时，每 2 分钟检查一次：快捷方式上的参数没了就补回去；Antigravity 正开着但没带参数，就在右下角弹一次提醒。照提醒关掉 Antigravity、再从快捷方式打开即可。Antigravity 没开时不检查（看 `%APPDATA%\Antigravity\lockfile` 在不在），不会在后台反复启动 PowerShell。
- 加参数、去参数、检查都由 `debug-port.ps1` 完成。手动检查：`powershell -ExecutionPolicy Bypass -File %LOCALAPPDATA%\AgyZhPack\debug-port.ps1 -Mode check`。

## 风险

请先读完这一节，再决定用不用。

- Antigravity 附加服务条款第 6 条规定：不得滥用、损害、干扰服务，包括 “using the Service in connection with products not provided by us”。违反条款可能导致 Antigravity 和 Gemini CLI 账号被暂停或终止。本项目是第三方工具，作者不能保证使用它不违反条款。
- 本项目只改本机的界面显示，状态栏只读取本机数据，不改发给 Google 的内容。
- 本项目依赖 Antigravity 内部的页面结构和接口。Antigravity 更新后，部分功能可能失效，新加的界面文字会先显示英文。
- 快捷方式上的启动参数会在本机 `127.0.0.1` 打开一个调试端口（2.33.0 以前的 Antigravity 本来就默认打开）。本机上的其他程序可以通过这个端口控制 Antigravity 窗口。介意的话请不要使用本项目。

## 安装程序做了什么

- 把文件复制到 `%LOCALAPPDATA%\AgyZhPack`。安装包自带 `node.exe`（Node.js 官方程序，许可证在 `app\node-LICENSE.txt`），不用另装 Node.js。
- 升级安装时，删掉旧版留下的 `config.json`（以前“解锁 512K 上下文”的设置）。
- 不改缩放、字体、对比度。配色只在你选择“作者的配色”时才改，原来的颜色记在 `originals.json`。
- 建计划任务 `AgyZhPack`：登录时在后台启动注入程序（普通权限，约占 60 MB 内存）。建不了计划任务时，改用“启动”文件夹。
- 给 Antigravity 的快捷方式加启动参数 `--remote-debugging-port=0`（见 [快捷方式参数](#快捷方式参数)）。Antigravity 开着但没带参数时，问过你再重开一次。

## 卸载

双击 `一键卸载.cmd`。快捷方式上的启动参数会去掉。用过作者的配色的，卸载时会问要不要恢复成原来的颜色。请保留解压出来的文件夹，卸载、切换配色时都要用。

<details>
<summary>装过旧版 v1.0.0 的注意</summary>

v1.0.0 安装时直接改了外观（缩放 131%、强对比度、系统字体、暖白配色）。从 v1.1.0 起，缩放、对比度、字体不再改，配色改成可选：

- 升级安装时，旧版改的缩放、对比度、字体保持不动；配色那一问会显示“现在用的是作者的配色”，输入 n 就能换回原来的颜色。
- 想全部恢复成安装旧版之前的样子：运行 `一键卸载.cmd` 时选择恢复，再重新安装。

</details>

## 测试情况

| Antigravity 版本 | 测过的内容 | 日期 |
|---|---|---|
| 2.33.0 | 关掉解锁后看官方默认上限：Gemini 4 Neon、Gemini 4 Carbon 是 512k，Claude Opus 5.5 是 840k；Neon 真实对话的费用有显示（金额没核对）；去掉解锁后，本机注入程序重启并重新注入，汉化和状态栏正常，新消息后 Claude Opus 5.5 显示 840k；隔离目录里测了从开过解锁的旧版升级（删掉旧设置并提示）、重装、卸载 | 2026-11-20 |
| 2.33.0 | 汉化（首页、设置页各屏、模型菜单，补了 2.32 和 2.33 新增的 301 条文字和 4 条规则）；Neon 和 Orchestrator (Neon) 的单价（离线核对）；快捷方式参数：真机上加参数后重开能注入、不带参数启动时约 20 秒弹出提醒；隔离目录里测了安装、重装、卸载去参数、Antigravity 开着时重开或跳过、没有快捷方式 | 2026-11-19 |
| 2.33.0 | **没测**：Antigravity 下次自动更新时会不会重写快捷方式、会不会不带参数自己重启；配色开关（这次没改代码） | — |
| 2.32.1 | Orchestrator (Carbon) 的 512K（计划阶段和执行阶段都实测）、Orchestrator 的额度分组、费用（对话累计、今天累计，包括 Antigravity 重启后今天的金额不清零）、状态栏英文显示、两行布局 | 2026-11-16 |
| 2.32.1 | **没测**：一键安装和配色开关、2.32.1 新增界面文字的汉化、跨过 0 点的对话怎么拆分今天的费用 | — |
| 2.31.2 | 汉化（设置页各屏、对话页）、状态栏（模型、上下文、缓存、首字、速度、5 小时和每周额度）、512K 改写生效、上下文开关切换；隔离目录里测了一键安装、配色开关（换上、换回、卸载恢复、Antigravity 开着时先关再开、从 v1.0.0 升级）、上下文开关、卸载 | 2026-11-13 |
| 2.31.2 | **没测**：子代理那几行（这次没有跑子代理） | — |
| 2.29.0 | 汉化和状态栏全部功能，包括子代理那几行 | 2026-11-04～09 |

系统：Windows 11。

已知的汉化不足：

- 有些句子由几段文字拼成，中间夹着文件名或链接。这类句子按段翻译，语序不一定自然；只剩一两个虚词、单独读不通的片段保持英文。
- 设置页的部分说明（比如界面布局的模式名、内置技能的说明）是 Antigravity 后台下发的，不在前端代码里。后台改了文字，这些地方会先变回英文。

## 原理

- Antigravity 主进程打开 Chromium 远程调试端口，端口号写在 `%APPDATA%\Antigravity\DevToolsActivePort`。2.33.0 起要带启动参数才打开，见 [快捷方式参数](#快捷方式参数)。
- `inject.mjs` 常驻后台，每 3 秒检查一次。发现主窗口后，用 Chrome DevTools Protocol 注入翻译器和状态栏脚本。不修改 Antigravity 的安装文件，Antigravity 自动更新后仍然有效。
- 状态栏在页面里包一层 `fetch`，旁听应用和本机后台（`language_server`）之间的 grpc-web+json 数据，不改应用发出的请求。另外，它向本机后台查几个只读接口：额度、实际模型名、子代理运行状态、每次调用的 token 用量和调用时间（算费用）。
- 注入程序每 30 秒把页面里今天的花费存进 `cost-day.json`，并从 `%USERPROFILE%\.gemini\antigravity\brain\` 找出今天动过的对话交给状态栏，所以 Antigravity 重启后今天的金额不会丢。只存对话 ID、金额和按模型的调用数、token 数。同时把当天的汇总和额度变化写进 `usage-history.json`，再把最近 31 天交给状态栏的每日用量面板。
- 默认不写 Antigravity 的设置文件。只有两种情况会写：你选择作者的配色（或换回），会改 `%USERPROFILE%\.gemini\config\config.json` 的两组主题颜色；卸载时选择恢复，会按记下的原值改回这个文件（装过旧版 v1.0.0 的还有 `%APPDATA%\Antigravity\app_storage.json`）。
- 除了从 Google Fonts 在线加载状态栏的图标，不连接其他网站。

<details>
<summary>从源码运行和打包</summary>

需要 Windows 和 Node.js 22 或更高版本（用到内置的 `WebSocket` 和 `fetch`）。

```bash
node inject.mjs
```

- 注入程序常驻后台。已经有一个在跑时，新启动的会自动退出。
- Antigravity 2.33.0 起要带 `--remote-debugging-port=0` 启动。先运行一次 `powershell -ExecutionPolicy Bypass -File debug-port.ps1` 给快捷方式加上参数，再从快捷方式打开 Antigravity。
- 改了 `statusbar.js` 或 `i18n` 下的文件后，已打开的窗口会自动更新，不用重启。改了 `inject.mjs` 要重启注入程序。
- 想给页面加自己的样式（比如换回复字体），在 `inject.mjs` 同目录放一个 `style.css`，注入程序会自动加载；没有这个文件就不改任何样式。
- 改了 `i18n/translator.js` 的逻辑，要把里面的 `VERSION` 加 1，已打开的窗口才会换用新翻译器。
- 如果注入程序在 Antigravity 打开很久以后才启动，状态栏会提示 `Press Ctrl+R to reload this window`，按一次 Ctrl+R 刷新窗口就好。

打包：

```bash
node package/build.mjs
```

生成 `dist/Antigravity中文美化包/` 和同名 zip。传到 GitHub Releases 时，把 zip 改成英文名 `agy-zh-pack-v<版本>.zip`（GitHub 会去掉文件名里的中文）。zip 里带上当前运行的 `node.exe` 和 `package/third_party/node-LICENSE.txt`（Node.js 的许可证）。用别的 Node.js 版本打包时，把许可证换成对应版本的：`https://raw.githubusercontent.com/nodejs/node/<版本>/LICENSE`。

</details>

<details>
<summary>文件说明</summary>

| 文件 | 作用 |
|---|---|
| `inject.mjs` | 注入程序：连 Antigravity 的调试端口，注入下面几个文件；保存今天花费的账本 |
| `debug-port.ps1` | 给 Antigravity 快捷方式加、去启动参数 `--remote-debugging-port=0`，检查不带参数的 Antigravity，弹出提醒 |
| `statusbar.js` | 用量状态栏和费用估算（在页面里运行） |
| `i18n/translator.js` | 翻译器（在页面里运行） |
| `i18n/zh-CN.json` | 词典：界面英文原文 → 中文 |
| `i18n/zh-CN.rules.json` | 正则规则：相对时间、思考时长等带数字的文字 |
| `cost-day.json` | 今天花费的账本（不在仓库里，注入程序自动生成） |
| `usage-history.json` | 每天用量的历史，保留 90 天（不在仓库里，注入程序自动生成） |
| `package/app/setup.mjs` | 一键安装、卸载、配色开关 |
| `package/build.mjs` | 生成安装包 |
| `package/third_party/node-LICENSE.txt` | 安装包自带的 Node.js 的许可证 |
| `assets/statusbar.png` | 本页顶部的截图 |

</details>

## 致谢

- 状态栏的外观和英文写法借鉴 Haleclipse（哈雷）的 [CCometixLine](https://github.com/Haleclipse/CCometixLine)（ccline）的 cometix 主题。感谢哈雷做出这么好看的状态栏。
- 5 小时和每周额度的显示方式参考 agyline。
- 状态栏配色：Catppuccin（浅色 Latte，深色 Mocha）。
- 图标：Material Symbols（Apache License 2.0）。
- 安装包自带 Node.js（MIT 许可，见 `package/third_party/node-LICENSE.txt`）。

## 许可

本项目代码使用 MIT 许可，见 [LICENSE](LICENSE)。

Antigravity 是 Google 的产品。词典 `zh-CN.json` 的键是 Antigravity 的界面英文原文，用于匹配要翻译的文字。
