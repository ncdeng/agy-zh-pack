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
| 在线更新词典和价格 | 开 | 不会。每 6 小时从本项目的 GitHub 仓库（经 jsDelivr）下载词典和价格表，只是普通的下载请求，不上传任何数据。可以关掉，见 [在线更新](#在线更新) |

缩放、字体、对比度一律不改。

## 功能

### 界面汉化

菜单、设置、按钮、提示文字换成中文（3292 条词典 + 76 条正则规则）。对话内容、代码、文件名不翻译。

#### 只要状态栏、不要汉化

删掉 `%LOCALAPPDATA%\AgyZhPack\i18n\zh-CN.json`，再在 Antigravity 里按一次 `Ctrl+R`，界面就恢复英文，状态栏照常显示。重新安装会把这个文件装回来。

### 用量状态栏

输入框上方固定两行，每一项是“彩色图标 + 同色文字”。状态栏上的字和 ccline 一样用英文，鼠标停在任何一项上会显示中文的详细说明。配色、外形等可以换，见 [外观](#外观)。

| 行 | 显示示例 | 含义 |
|---|---|---|
| 第一行 | `gemini-flash-worker-agy` | 模型：界面上的名字，加上接口实际返回的模型名。Gemini 模型两者对不上时标黄 |
| | `89% · 456k · ↻3×` | 上下文：图标是随用量变满的圆环，后面是已用比例和已用 token。被自动压缩过的对话后面多一个浅黄小徽章，数字是压缩次数。悬停说明里有上限、进度条，以及 Antigravity 给出的各部分各占多少 token 和百分比、还剩多少空间（Free space），第几步压缩的也在这里 |
| | `99% hit` | 缓存：最近一次调用的缓存命中率；从缓存读了多少 token 看悬停说明 |
| | `$17.81` | 这个对话累计花费（含子代理）。悬停可以看最近一次调用的输入、缓存、输出 token 数和各自的金额 |
| | `$17.85 today` | 今天累计花费（本地 0 点起，所有对话）。点一下打开 [每日用量面板](#每日用量面板) |
| | `running` | 正在生成。没在生成时这一格留着空位，所以开始和结束生成时状态栏不会换行跳动；窗口窄时这一格先缩，不会挤到下一行 |
| 第二行 | `6.9s` | 首字时间 |
| | `169 tok/s` | 生成速度 |
| | `0% · 16:44` | 5 小时额度：已用比例（进度条）、重置时间 |
| | `41% · Sat 16:08 · ↑15%` | 每周额度：已用比例、重置时间、比匀速用完快（↑）或慢（↓）多少 |
| 子代理 | `├ research · Paper Reviewer … ● 1m05s` | 每个子代理单独一行，前面用 `├` `└` 连成树。依次是：子代理类型和任务、模型、上下文、缓存命中、这个子代理自己的花费、状态。状态是 `● 已运行时间`、`● waiting`（在等你批准）或 `✓ done 用时 · N steps`；悬停看它正在做哪一步和最近几步。跑完约 10 秒后收起。打开子代理窗口时，显示那个子代理自己的数据 |

外观借鉴 Haleclipse（哈雷）的 [CCometixLine](https://github.com/Haleclipse/CCometixLine)（ccline，Claude Code 的状态栏工具）的 cometix 主题：两行显示、彩色图标配同色文字、`|` 分隔各项、`·` 连接同一项里的数字、额度带进度条。本项目没有用它的代码，状态栏是为 Antigravity 重新写的。

#### 外观

点 `$x today` 打开 [每日用量面板](#每日用量面板)，再点右上角的 `theme`。上面是配色画廊，每张卡片是你当前状态栏的实时副本，点一下就换；下面是其他选项。选了马上生效。

| 选项 | 可选值 | 默认 |
|---|---|---|
| 配色（palette） | Cometix、Catppuccin、Tokyo Night、Rosé Pine、Gruvbox、Nord、Dracula、Mono（单色） | Cometix（本项目自己的配色） |
| 外形（style） | `plain` 纯文字、竖线分隔；`pill` 每项一个圆角底色块；`powerline` 箭头色块 | `plain` |
| 额度进度条（bars） | `thin` 细条；`cells` 10 格；`ring` 小圆环；`none` 不画 | `thin` |
| 信息密度（detail） | `compact` 上下文不写上限、缓存只写命中率；`full` 上下文带上限、缓存带读到的 token 数 | `compact` |
| 图标（icons） | `material` 实心图标；`outline` 线条图标；`unicode` 普通字符（不用在线图标字体）；`off` 不显示 | `material` |
| 单项图标（swap） | 每一项有一个备选图标，点一下在默认和备选之间切换。比如模型可以换成彗星，生成速度可以换成三档仪表（指针指向慢 / 中 / 快：低于 30、30～60、高于 60 tok/s） | 全部用默认图标 |

- 每套配色都有浅色和深色两版，跟着 Antigravity 的浅色 / 深色自动切换。色值取自各配色方案公开的定义（见 [致谢](#致谢)）。Nord 官方只有深色，浅色版把偏淡的几种颜色调深了。
- 选择存在安装目录的 `look.json`，注入程序 30 秒内保存，并同步到其他窗口。想回到默认，在 Theme 页右上角点 `reset`；也可以关掉 Antigravity 后删掉这个文件。
- 分层的思路（配色、外形、进度条字形、详略）和“仪表代替图标”（上下文的图标画成随用量变满的圆环）参考 ccline v2。本项目没有用它的代码。

#### 每日用量面板

点状态栏上的 `$x today`，状态栏上方会弹出一个面板，宽度和输入框一样，高度用满状态栏上方的空间。再点一次、点面板外面或按 `Esc` 关掉。右上角显示当前登录的账号（邮箱打码，比如 `ab***12@gmail.com · Ultra`）和 `theme` 按钮（打开 [外观](#外观) 设置）。

- **顶部四格**：今天的花费、调用次数、token 总数、缓存命中率。
- **柱状图**：最近 7 天或 30 天每天的折算花费，按模型分颜色。鼠标停在柱子上看当天的明细。
- **表格**：每天一行，有花费、对话数、调用数、token 总数、输入 / 缓存 / 输出 token、缓存命中率，以及当天用掉了多少个百分点的每周额度（Gemini 组和 Claude 组分开）。
- **调用明细**：点表格里的某一天，打开那一天每次模型调用的明细（今天和以前的天都可以）：时间、对话、模型、花费、输入、输出、缓存读、缓存写、命中率、生成速度、首字时间、总耗时。最新的在上面，最多列 600 行，合计按全部调用算。点 `← usage` 回去。
- **底部**：这段时间的合计（花费、token）和日均；每组每周额度一行，见下面的“每周额度预估”。

数据存在安装目录的 `usage-history.json`，保留 90 天，只存金额、调用数、token 数和额度比例，不存对话内容。额度记录按账号分开记，换号以后不会混在一起；文件里只存打码的邮箱和一个账号编号（邮箱的哈希），不存完整邮箱。

**每周额度预估**（每组一行，比如 `Gemini weekly · 3% used · cap ≈ $952 / 2.15B tok (rough) · resets 11-29 09:41 · est 45% at reset (rough)`）：

- `cap ≈`：这一周（重置时间往前 7 天到重置时间）本机的折算花费和 token，除以这一周的已用比例，估出整周额度大约相当于多少钱、多少 token。
- `est … at reset`：照最近的用量速度，到重置时大约会用到多少；照这个速度会提前用完的，改成 `full` 加预计用完的时间。速度取这一周的平均和最近 24 小时（至少有 6 小时的读数）两种。额度读数存在 `quota-samples.json`，保留 8 天。
- 两个数都标 `(rough)`：已用比例本身会来回起伏，刚开始一周、用得很少时误差很大。悬停看算法和剩余额度。

每周额度按每个周期的净变化算：当天最后看到的已用比例，减去当天开始时的已用比例；当天换了周期，就分段相加。原因是已用比例在同一个周期里会来回起伏（实测正在生成时，6 分钟里从 1.699% 降到 1.594%），v1.4.x 只累计上涨的部分，会把回落后的再上涨重复算进去，当天用量偏高。v1.5.0 升级后会自动按新方法重算以前的每周额度记录。

- Antigravity 没开着时用掉的额度（比如用 agy CLI），会算到下次观察到的那一天。
- 额度是按账号算的。如果这个号开了 Google 家庭组共享，或者在别的电脑上也在用，额度里会包含别人的用量。这时 `cap ≈` 会偏低（别人的用量涨了额度，却没有算进本机的花费），`est` 会偏高。

装上以后，注入程序会补算以前的天数，只补一次：只读打开 Antigravity 自己的对话库（Windows 是 `%USERPROFILE%\.gemini\antigravity\conversations\*.db`，macOS 是 `~/.gemini/antigravity/conversations/*.db`），读出每次调用的时间、模型和 token 数，按日期归到每一天，钱按状态栏的单价表算。补算的天没有额度记录（以前没人记过）。每次调用按它自己的时间归日。v1.5.x 按“这一轮开始的时间”归日，跑过 0 点的一轮会整轮记到前一天（实测一天少记了 349 次调用）；v1.6 升级后会自动重算一次以前补算的天数。补算需要 Node.js 22.13 / 23.4 或更高版本（用到内置的 `node:sqlite`，22.5～22.12 要加启动参数才能用）。Windows 安装包自带的 `node.exe` 满足；macOS 用系统装的 Node。版本不够时只跳过补算，面板和每天的实时记录照常工作。补算用的是 Antigravity 内部的存储格式，它改了格式就补不出来，不影响其他功能。

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
- `gemini-4-hydrogen-tiered-high`（浏览器子代理用的）官方价格页没有，按 Gemini 4 Hydrogen 的标准价估。
- GPT-OSS 120B 没有单价，不计入。
- 出处：Google AI Studio 价格页（2026-11-16；Neon 2026-11-19）、Anthropic 官方价（2026-11-03）。Claude 在 Antigravity 里经 Google Vertex 调用，实际价格可能不同。
- 单价默认用在线价格表 `data/prices.json`（见 [在线更新](#在线更新)）。鼠标停在 `$x today` 上可以看用的是在线的还是内置的。内置的单价写在 `statusbar.js` 的 `PRICES` 里，关掉在线更新或下载不到时用它。
- 今天的花费：今天动过的对话里，0 点以后的调用加起来。每个对话今天的金额记在安装目录的 `cost-day.json`，Antigravity 重启后不会清零；过了 0 点自动重新开始。

</details>

### 在线更新

Antigravity 更新后会加新的界面文字，Google 也会调价。为了不用每次都发新版、重装，注入程序每 6 小时从本项目的 GitHub 仓库下载几个数据文件：

| 文件 | 内容 | 谁来更新 |
|---|---|---|
| `i18n/zh-CN.json`、`i18n/zh-CN.rules.json` | 词典和规则 | 作者补了汉化就推上去 |
| `data/prices.json` | 每个模型的单价 | GitHub Actions 每天按 Google AI Studio 和 Vertex AI 的官方价格页核对，价格变了才提交（`tools/update-prices.mjs`） |
| `data/meta.json` | 最新的版本号 | 发版时改 |

- **只下载数据，不下载代码。** 词典和规则只被当作文字填进界面（不当 HTML），价格只是数字。注入程序、状态栏和翻译器不会自动更新。有新版本时，每日用量面板右上角显示 `v<版本> available`，要自己下载安装包覆盖安装。
- **下载走 Antigravity 自己的网络。** 请求从 Antigravity 的页面里发出，用的是 Antigravity 的网络和代理设置，不带 cookie 和 Referer。地址依次试 `cdn.jsdelivr.net`、`fastly.jsdelivr.net`、`gcore.jsdelivr.net`、`raw.githubusercontent.com`，记住上次能用的那个。
- **先校验再用。** 格式不对、条数比安装包自带的少两成以上（比如只下载到半截）、单价超出范围的文件不用，继续用原来的。下载失败 30 分钟后重试。
- 在线词典覆盖自带词典里的同名条目，自带的其他条目照用。删掉了自带词典（只要状态栏）时，在线词典也不用。在线价格表里有的模型用在线的价，没有的用内置的价。
- 改了译文的文字马上换上；在线词典里没有了的条目恢复英文。
- 下载到的文件存在安装目录的 `remote/` 里，Antigravity 重启后照用。装了新版本以后，存着的词典先不用，等下一次下载。
- **关掉**：每日用量面板 → `theme` → 最下面的 `updates` 选 `off`。关掉以后不再联网，词典和价格只用安装包自带的。这一行下面写着上次检查的时间、用的哪个地址、在线词典的条数、价格表的日期和出过的问题。

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
- 在线更新会从本项目的 GitHub 仓库下载词典和价格表。万一仓库被人篡改，界面上可能出现被改过的文字（不会执行代码，也拿不到你的数据）。介意的话在 Theme 页把 `updates` 关掉。
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
| 2.34.0 | v1.7（Windows 11 真机，用本机服务器模拟仓库）：四个文件从 Antigravity 页面里下载（不带 cookie 和 Referer），校验后存进 `remote/`；在线词典的条目生效；`updates` 关掉后回到自带词典和内置价格，打开后 3 秒内重新检查；版本号改成 1.7.1 时面板显示新版本提示；词典被截成 100 条时拒收、继续用原来的；规则里一条写错的正则只跳过这一条；服务器停掉时记下错误、继续用存着的数据。翻译器换词典重翻：浏览器里 17 项测试全部通过。连真实地址（这时 `data/meta.json` 还没推上去，返回 404）：Windows 四个地址都连得上；macOS 上 `cdn.jsdelivr.net` 连不上、`fastly.jsdelivr.net` 超时，另外两个连得上。抓价脚本：用当天的两个价格页离线跑，7 个必需模型的价和内置单价表一致；模拟了过了换价日旧价被删、数字变化超过 5 倍两种情况。**没测**：推到 GitHub 以后从 jsDelivr 真实下载、GitHub Actions 实际运行 | 2026-11-22 |
| 2.34.0 | v1.6（Windows 11 真机）：子代理树形行（模型、上下文、缓存、自己的花费、运行时间、等待批准、跑完的用时和步数）、压缩徽章、上下文悬停里各部分的百分比、`running` 在窄窗口不换行；Theme 页的四种图标和每一项的备选图标（彗星、三档速度仪表）；每日面板的账号、顶部四格、token 列、调用明细（今天和以前的天；11-18 共 1101 次、$69.24）、每周额度的 `cap` 和预估；悬停提示框不再透明；补算 v2 读了 79 个对话库，11-08、11-10、11-11、11-16、11-17、11-18、11-19 七天的调用次数逐天和调用明细一致，总调用数和额度记录没变。macOS 真机：账号显示、按账号分开记额度历史、面板正常；没有对话库时补算正常跳过。**没测**：一键安装（安装程序没改） | 2026-11-22 |
| 2.34.0 | v1.5.1：macOS 真机完整测外观（用 v1.5.0 源码覆盖后重启注入程序）：8 套配色、3 种外形、4 种进度条、图标开关、Theme 页 8 张卡片和点卡片换配色都正常；在 Antigravity 设置里切到深色，测了 Cometix、Tokyo Night、Catppuccin + powerline、Gruvbox + pill + 小圆环和 Theme 页，再切回浅色；刷新窗口后马上恢复所选外观（v1.5.0 要等最多 30 秒）；`reset` 按钮恢复默认；没有页面报错。**没测**：子代理行在新外观下的样子 | 2026-11-22 |
| 2.34.0 | 外观（v1.5.0）：Windows 真机上新状态栏（上下文圆环、紧凑写法、细进度条）显示正常；Theme 页 8 张配色卡片和外形、进度条、信息密度、图标四排选项正常，没有报错；选择在 28 秒后写进 `look.json`；离线预览页里 8 套配色的浅色和深色、3 种外形、4 种进度条、关掉图标都显示正常。macOS 真机：新状态栏、Theme 页、图标字体正常，没有报错。每周额度改成按周期净变化：同一周期、正在生成时实测 6 分钟里 Gemini 每周额度 1.699% → 1.594%、5 小时额度 1.907% → 1.487%；用本机真实历史离线重算，11-22 的每周额度从 +7.24% 改成 +1.59%（当时状态栏显示 2%）；另外模拟了同一周期起伏、当天中途换周期、以前没见过这个额度三种情况。**没测**：Antigravity 深色主题下的真机效果（只在离线预览里看过）、子代理行在新外观下的样子 | 2026-11-22 |
| 2.34.0 | 状态栏（issue #2）：悬停说明改成自己画的提示框。macOS 真机上用模拟鼠标测：停 0.6 秒时已显示；连续强制重画 6 次，提示框不消失；移开就收起；每日面板里按钮的说明正常；压缩图标的字体加载成功。Windows 热更新后，状态栏和面板里不再有原生 `title`；没在生成时 `running` 的空位在第一行，状态栏两行。额度快速重试：macOS 上重启 Antigravity，第一次请求在 3.3 秒拿到额度，没有触发重试。**没测**：有压缩记录的对话里徽章的实际样子和换行情况、第一次拿额度失败时的重试 | 2026-11-22 |
| 2.34.0 | 汉化：补了 2.34.0 新增的 167 条文字和 16 条规则（Orchestrator 设置、权限和沙盒选项、插件面板、侧边栏自定义、发送键设置、首页建议卡片；设置页“模型”屏的额度说明靠规则翻译，规则适用的文字长度从 80 放宽到 120）；Windows 首页、对话页和 macOS 设置页（通用、模型）扫描后只剩名字类和开发者选项没翻 | 2026-11-22 |
| 2.34.0 | macOS 真机（2020 款 13 寸 Intel MacBook Pro，macOS 15.7.9，Node.js 24.14.0）：`install-agent` 装好登录自启并拉起注入程序；`launch-agy` 带调试端口启动；注入引导页后自动刷新一次；汉化、状态栏（模型、今日花费、5 小时和每周额度）、每日用量面板正常；补算在没有对话库时正常跳过。**没测**：重启后自启、不带参数启动时的系统通知、配色开关 | 2026-11-22 |
| 2.33.0 | 关掉解锁后看官方默认上限：Gemini 4 Neon、Gemini 4 Carbon 是 512k，Claude Opus 5.5 是 840k；Neon 真实对话的费用有显示（金额没核对）；去掉解锁后，本机注入程序重启并重新注入，汉化和状态栏正常，新消息后 Claude Opus 5.5 显示 840k；隔离目录里测了从开过解锁的旧版升级（删掉旧设置并提示）、重装、卸载；每日用量面板在真机上显示正常（柱状图、表格、额度两栏）；额度累计的计算离线测了 8 种情况；补算：73 个对话库读出 4270 次调用，今天这天和状态栏实时记账逐项一致（Carbon、Opus 5.5、Neon 的调用数和 token） | 2026-11-20 |
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
- 状态栏在页面里包一层 `fetch`，旁听应用和本机后台（`language_server`）之间的 grpc-web+json 数据，不改应用发出的请求。另外，它向本机后台查几个只读接口：额度、当前登录的账号（邮箱和订阅档次；邮箱只在页面里用来算账号编号和打码显示，不写进文件）、实际模型名、子代理运行状态和步骤、每次调用的 token 用量和调用时间（算费用和调用明细）。
- 注入程序每 30 秒把页面里今天的花费存进 `cost-day.json`，并从 `%USERPROFILE%\.gemini\antigravity\brain\`（macOS 是 `~/.gemini/antigravity/brain/`）找出今天动过的对话，再把对话库文件夹（`conversations`）里最近 32 天的对话 ID、创建时间和修改时间交给状态栏（后台的对话列表只列一部分对话），所以 Antigravity 重启后今天的金额不会丢。只存对话 ID、金额和按模型的调用数、token 数。同时把当天的汇总和额度变化写进 `usage-history.json`，再把最近 31 天交给状态栏的每日用量面板。
- 默认不写 Antigravity 的设置文件。只有两种情况会写：你选择作者的配色（或换回），会改 `%USERPROFILE%\.gemini\config\config.json` 的两组主题颜色；卸载时选择恢复，会按记下的原值改回这个文件（装过旧版 v1.0.0 的还有 `%APPDATA%\Antigravity\app_storage.json`）。
- 联网只有两处：从 Google Fonts 加载状态栏的图标；[在线更新](#在线更新) 从 jsDelivr（或 raw.githubusercontent.com）下载本项目仓库里的数据文件（可以关掉）。

<details>
<summary>从源码运行和打包</summary>

需要 Node.js 22 或更高版本（用到内置的 `WebSocket` 和 `fetch`）。Windows 与 macOS 均支持从源码运行（macOS 详细步骤和登录自启脚本见 [macos/README.md](macos/README.md)）。

```bash
node inject.mjs
```

- 注入程序常驻后台。已经有一个在跑时，新启动的会自动退出。
- Antigravity 2.33.0 起要带 `--remote-debugging-port=0` 启动。Windows 先运行一次 `powershell -ExecutionPolicy Bypass -File debug-port.ps1` 给快捷方式加上参数，再从快捷方式打开 Antigravity；macOS 运行 `./macos/launch-agy.command`（或 `open -a Antigravity --args --remote-debugging-port=0`）。
- 改了 `statusbar.js` 或 `i18n` 下的文件后，已打开的窗口会自动更新，不用重启。改了 `inject.mjs` 要重启注入程序。
- 想给页面加自己的样式（比如换回复字体），在 `inject.mjs` 同目录放一个 `style.css`，注入程序会自动加载；没有这个文件就不改任何样式。
- 改了 `i18n/translator.js` 的逻辑，要把里面的 `VERSION` 加 1，已打开的窗口才会换用新翻译器。
- 如果注入程序在 Antigravity 打开很久以后才启动，状态栏会提示 `Press Ctrl+R to reload this window`，按一次 Ctrl+R 刷新窗口就好。

打包：

```bash
node package/build.mjs
```

发新版时，把 `inject.mjs` 里的 `PACK_VERSION` 和 `data/meta.json` 的 `latest`、`date` 改成新版本（打包脚本会检查两处一致）。`data/meta.json` 推到 main 以后，装着旧版本的用户会在每日用量面板上看到新版本提示。

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
| `look.json` | 状态栏外观的选择（不在仓库里，在 Theme 页选过才有） |
| `quota-samples.json` | 额度读数，保留 8 天，算每周额度预估用（不在仓库里，注入程序自动生成） |
| `remote/` | 在线更新下载到的词典、规则、价格表和检查情况（不在仓库里，注入程序自动生成） |
| `data/prices.json` | 在线价格表（GitHub Actions 每天按官方价格页更新） |
| `data/meta.json` | 最新版本号（发版时改） |
| `tools/update-prices.mjs` | 按官方价格页更新 `data/prices.json` |
| `.github/workflows/update-prices.yml` | 每天跑一次上面的脚本：价格变了就提交，出了问题就开 issue |
| `.github/workflows/purge-cdn.yml` | 推送了词典或 `data/` 以后，清掉 jsDelivr 上的缓存 |
| `package/app/setup.mjs` | 一键安装、卸载、配色开关 |
| `package/build.mjs` | 生成安装包 |
| `package/third_party/node-LICENSE.txt` | 安装包自带的 Node.js 的许可证 |
| `macos/manage.mjs` | macOS 管理脚本（LaunchAgent 登录自启、启停、配色开关、调试端口启动） |
| `macos/launch-agy.command` | macOS 启动器（自动查找 Node.js 并带 `--remote-debugging-port=0` 启动 Antigravity） |
| `macos/README.md` | macOS 使用说明 |
| `assets/statusbar.png` | 本页顶部的截图 |

</details>

## 致谢

- 状态栏的外观和英文写法借鉴 Haleclipse（哈雷）的 [CCometixLine](https://github.com/Haleclipse/CCometixLine)（ccline）的 cometix 主题；v1.5.0 的外观分层（配色、外形、进度条、详略）和上下文圆环参考 ccline v2。感谢哈雷做出这么好看的状态栏。
- 5 小时和每周额度的显示方式参考 agyline。
- 默认配色 Cometix 以 [Catppuccin](https://catppuccin.com)（浅色 Latte，深色 Mocha）为底。其他配色的色值取自各方案公开的定义：Catppuccin、[Tokyo Night](https://github.com/folke/tokyonight.nvim)、[Rosé Pine](https://rosepinetheme.com)、[Gruvbox](https://github.com/morhetz/gruvbox)、[Nord](https://www.nordtheme.com)、[Dracula](https://draculatheme.com)（浅色是官方的 Alucard）。
- 图标：Material Symbols（Apache License 2.0）。模型的备选图标（彗星）是 [Font Awesome Free](https://fontawesome.com) 6.7.2 的 meteor，许可 [CC BY 4.0](https://fontawesome.com/license/free)，版权 Fonticons, Inc.。
- 安装包自带 Node.js（MIT 许可，见 `package/third_party/node-LICENSE.txt`）。

## 许可

本项目代码使用 MIT 许可，见 [LICENSE](LICENSE)。

Antigravity 是 Google 的产品。词典 `zh-CN.json` 的键是 Antigravity 的界面英文原文，用于匹配要翻译的文字。
