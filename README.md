# agy-zh-pack

Antigravity 桌面版（Windows）的非官方中文美化包：界面汉化，加上输入框上方的用量状态栏。默认不改 Antigravity 的缩放、配色、字体等设置；作者的配色可以自己选择要不要用。

> 这是第三方项目，和 Google 没有关系。使用前请先读“风险”一节。

## 一眼看懂

| 功能 | 默认 | 会不会改发给 Google 的内容 |
|---|---|---|
| 界面汉化 | 开 | 不会，只改本机显示 |
| 用量状态栏 | 开 | 不会，只读本机数据 |
| 作者的配色 | 关 | 不会，只改本机 Antigravity 的主题颜色 |
| 解锁 512K 上下文 | **关** | **会**，所以要你自己选择打开 |

## 功能

- **界面汉化**：菜单、设置、按钮、提示文字换成中文（约 2800 条词典 + 56 条正则规则）。对话内容、代码、文件名不翻译。
- **用量状态栏**（输入框上方）：
  - 模型：界面上的名字，加上接口实际返回的模型名。Gemini 模型两者对不上时标黄。
  - 上下文用量、缓存命中、首字时间、生成速度、本次 token 数。
  - 5 小时额度和每周额度：已用比例、重置时间、和匀速用完相比的快慢。
  - 子代理：在跑的子代理每个单独一行，跑完约 10 秒后收起。打开子代理窗口时，显示那个子代理自己的数据。
  - 鼠标停在任何一项上，会显示详细说明。
  - 外观借鉴 Haleclipse（哈雷）的 [CCometixLine](https://github.com/Haleclipse/CCometixLine)（ccline，Claude Code 的状态栏工具）的 cometix 主题：两行显示、彩色图标配同色文字、`|` 分隔各项、`·` 连接同一项里的数字、额度用 10 格进度条。本项目没有用它的代码，只借鉴了显示风格，状态栏是为 Antigravity 重新写的。
- **可选：作者的配色**。Claude 风格的暖白配色，默认不用，见下文“配色开关”。
- **可选：解锁 512K 上下文**。默认关闭，见下文“上下文开关”。

## 风险

请先读完这一节，再决定用不用。

- Antigravity 附加服务条款第 6 条规定：不得滥用、损害、干扰服务，包括 “using the Service in connection with products not provided by us”。违反条款可能导致 Antigravity 和 Gemini CLI 账号被暂停或终止。本项目是第三方工具，作者不能保证使用它不违反条款。
- 默认情况下，本项目只改本机的界面显示，状态栏只读取本机数据，不改发给 Google 的内容。
- 解锁 512K 上下文会改变发给 Google 的内容，风险最高，所以默认关闭，只有你自己选择才会打开。
- 本项目依赖 Antigravity 内部的页面结构和接口。Antigravity 更新后，部分功能可能失效，新加的界面文字会先显示英文。

## 配色开关（可选，默认不用）

作者自己用的是 Claude 风格的暖白配色：

| 主题 | 背景 | 文字 | 强调色 |
|---|---|---|---|
| 浅色 | `#FAF9F5` | `#141413` | `#D97757` |
| 深色 | `#262624` | `#FAF9F5` | `#D97757` |

- 只改主题颜色，不改缩放、字体和对比度。
- 换上前，安装程序会把你原来的颜色记在 `%LOCALAPPDATA%\AgyZhPack\originals.json`。换回或卸载时按它恢复。
- 一键安装时会问一次。直接按回车 = 不用。
- 装好以后，双击 `配色开关.cmd` 换上或换回。
- 颜色存在 Antigravity 自己的设置文件里（`%USERPROFILE%\.gemini\config\config.json` 的 `customThemeSeedsLight` / `customThemeSeedsDark`）。Antigravity 运行时会把这个文件写回去，所以换颜色时要先关闭它，改完会自动重新打开。

## 上下文开关（可选，默认关闭）

**它做什么**：Antigravity 桌面版默认在对话约 25.6 万 token 时自动压缩上下文（Gemini 和 Claude 模型）。解锁后，压缩线提高到 51.2 万 token，长对话能记住更多内容。做法和 agy CLI 在 `/model` 里选 512K 时一样：给请求补上 `checkpointConfig.maxTokenLimit = 512000`。

**代价**：

- 发给 Google 的内容会变，和官方桌面端的默认行为不同（见“风险”）。
- 上下文越长，每一轮消耗的额度越多，额度会用得更快。

**怎么打开或关闭**：

- 一键安装时，安装程序会问一次。直接按回车 = 不解锁。
- 装好以后，双击安装包文件夹里的 `上下文开关.cmd`，按提示输入。不用关 Antigravity，几秒内自动生效，从下一条消息开始按新设置计算。
- 从源码运行时，在 `inject.mjs` 同目录建 `config.json`，内容是 `{"contextLimit": 512000}`；删掉这个文件或写 `0` 就是关闭。文件写错时按关闭处理。

**怎么确认**：看状态栏的上下文一项。上限显示 `512k` 就是已解锁，`256k` 就是默认。

**关闭以后**：已经超过 25.6 万 token 的长对话，下一轮可能会被自动压缩。

## 安装（一键安装包）

1. 安装 Antigravity，并登录一次。
2. 拿到安装包：从本仓库的 [Releases](https://github.com/ncdeng/agy-zh-pack/releases) 下载 `agy-zh-pack-v<版本>.zip`（解压后是 `Antigravity中文美化包` 文件夹）；也可以按下文“打包”自己生成。
3. 把 zip 解压到任意位置。不要在压缩包里直接运行。
4. 双击 `一键安装.cmd`。如果弹出“Windows 已保护你的电脑”，点“更多信息”，再点“仍要运行”。
5. 安装程序会问两个可选项：要不要用作者的配色、要不要解锁 512K 上下文。不确定就直接按回车（都不用）。选了作者的配色时，安装程序会请你关闭 Antigravity，改完再自动打开。
6. Antigravity 原来就开着的话，不用关。装好后在 Antigravity 里按一次 Ctrl+R 刷新窗口，用量状态栏就会出现。

安装程序做的事：

- 把文件复制到 `%LOCALAPPDATA%\AgyZhPack`。安装包自带 `node.exe`（Node.js 官方程序，许可证在 `app\node-LICENSE.txt`），不用另装 Node.js。
- 把上下文开关的选择写进 `%LOCALAPPDATA%\AgyZhPack\config.json`。
- 不改缩放、字体、对比度。配色只在你选择“作者的配色”时才改，原来的颜色记在 `originals.json`。
- 建计划任务 `AgyZhPack`：登录时在后台启动注入程序（普通权限，约占 60 MB 内存）。建不了计划任务时，改用“启动”文件夹。

## 卸载

双击 `一键卸载.cmd`。用过作者的配色的，卸载时会问要不要恢复成原来的颜色。请保留解压出来的文件夹，卸载、切换配色和上下文时都要用。

装过旧版 v1.0.0 的注意：v1.0.0 安装时直接改了外观（缩放 131%、强对比度、系统字体、暖白配色）。从 v1.1.0 起，缩放、对比度、字体不再改，配色改成可选：

- 升级安装时，旧版改的缩放、对比度、字体保持不动；配色那一问会显示“现在用的是作者的配色”，输入 n 就能换回原来的颜色。
- 想全部恢复成安装旧版之前的样子：运行 `一键卸载.cmd` 时选择恢复，再重新安装。

## 测试情况

| Antigravity 版本 | 测过的内容 | 日期 |
|---|---|---|
| 2.31.2 | 汉化（设置页各屏、对话页）、状态栏（模型、上下文、缓存、首字、速度、5 小时和每周额度）、512K 改写生效、上下文开关切换；隔离目录里测了一键安装、配色开关（换上、换回、卸载恢复、Antigravity 开着时先关再开、从 v1.0.0 升级）、上下文开关、卸载 | 2026-11-13 |
| 2.31.2 | **没测**：子代理那几行（这次没有跑子代理） | — |
| 2.29.0 | 汉化和状态栏全部功能，包括子代理那几行 | 2026-11-04～09 |

系统：Windows 11。

已知的汉化不足：

- 有些句子由几段文字拼成，中间夹着文件名或链接。这类句子按段翻译，语序不一定自然；只剩一两个虚词、单独读不通的片段保持英文。
- 设置页的部分说明（比如界面布局的模式名、内置技能的说明）是 Antigravity 后台下发的，不在前端代码里。后台改了文字，这些地方会先变回英文。

## 原理

- Antigravity 主进程启动时会打开 Chromium 远程调试端口，端口号写在 `%APPDATA%\Antigravity\DevToolsActivePort`。
- `inject.mjs` 常驻后台，每 3 秒检查一次。发现主窗口后，用 Chrome DevTools Protocol 注入翻译器和状态栏脚本。
- 不修改 Antigravity 的安装文件，Antigravity 自动更新后仍然有效。
- 状态栏在页面里包一层 `fetch`，旁听应用和本机后台（`language_server`）之间的 grpc-web+json 数据。另外，它向本机后台查几个只读接口：额度、实际模型名、子代理运行状态。
- 上下文开关打开时，同一层 `fetch` 包装给带 `cascadeConfig` 的请求补上 `checkpointConfig.maxTokenLimit`；关闭时完全不改请求。
- 默认不写 Antigravity 的设置文件。只有两种情况会写：你选择作者的配色（或换回），会改 `%USERPROFILE%\.gemini\config\config.json` 的两组主题颜色；卸载时选择恢复，会按记下的原值改回这个文件（装过旧版 v1.0.0 的还有 `%APPDATA%\Antigravity\app_storage.json`）。

## 从源码运行

需要 Windows 和 Node.js 22 或更高版本（用到内置的 `WebSocket` 和 `fetch`）。

```bash
node inject.mjs
```

- 注入程序常驻后台。已经有一个在跑时，新启动的会自动退出。
- 改了 `statusbar.js`、`config.json` 或 `i18n` 下的文件后，已打开的窗口会自动更新，不用重启。
- 想给页面加自己的样式（比如换回复字体），在 `inject.mjs` 同目录放一个 `style.css`，注入程序会自动加载；没有这个文件就不改任何样式。
- 改了 `i18n/translator.js` 的逻辑，要把里面的 `VERSION` 加 1，已打开的窗口才会换用新翻译器。
- 如果注入程序在 Antigravity 打开很久以后才启动，状态栏会提示按 Ctrl+R 刷新一次窗口。

## 打包

```bash
node package/build.mjs
```

生成 `dist/Antigravity中文美化包/` 和同名 zip。传到 GitHub Releases 时，把 zip 改成英文名 `agy-zh-pack-v<版本>.zip`（GitHub 会去掉文件名里的中文）。zip 里带上当前运行的 `node.exe` 和 `package/third_party/node-LICENSE.txt`（Node.js 的许可证）。用别的 Node.js 版本打包时，把许可证换成对应版本的：`https://raw.githubusercontent.com/nodejs/node/<版本>/LICENSE`。

## 文件

| 文件 | 作用 |
|---|---|
| `inject.mjs` | 注入程序：连 Antigravity 的调试端口，注入下面几个文件 |
| `statusbar.js` | 用量状态栏和上下文开关的改写（在页面里运行） |
| `i18n/translator.js` | 翻译器（在页面里运行） |
| `i18n/zh-CN.json` | 词典：界面英文原文 → 中文 |
| `i18n/zh-CN.rules.json` | 正则规则：相对时间、思考时长等带数字的文字 |
| `config.json` | 上下文开关的设置（不在仓库里，由安装程序或你自己创建） |
| `package/app/setup.mjs` | 一键安装、卸载、配色开关、上下文开关 |
| `package/build.mjs` | 生成安装包 |
| `package/third_party/node-LICENSE.txt` | 安装包自带的 Node.js 的许可证 |

## 致谢

- 状态栏的外观借鉴 Haleclipse（哈雷）的 [CCometixLine](https://github.com/Haleclipse/CCometixLine)（ccline）的 cometix 主题。感谢哈雷做出这么好看的状态栏。
- 5 小时和每周额度的显示方式参考 agyline。
- 状态栏配色：Catppuccin（浅色 Latte，深色 Mocha）。
- 图标：Material Symbols（Apache License 2.0）。
- 安装包自带 Node.js（MIT 许可，见 `package/third_party/node-LICENSE.txt`）。

## 许可

本项目代码使用 MIT 许可，见 [LICENSE](LICENSE)。

Antigravity 是 Google 的产品。词典 `zh-CN.json` 的键是 Antigravity 的界面英文原文，用于匹配要翻译的文字。
