# 原理和开发

[简体中文](development.md) | [English](development.en.md)

← 返回 [README](../README.md)

## 原理

- 插件 = 插件目录里的 `plugin.json` + 一个 sidecar（`sidecars/core/sidecar.json`）。Antigravity 的后台（`language_server`）发现插件后，用 Antigravity 自带的 Node 启动 sidecar（`sidecars/core/main.mjs`）；sidecar 退出后约 1～2 秒会被重新拉起，插件目录被删掉时会被停掉。
- sidecar 里跑注入程序 `inject.mjs`：每 3 秒检查一次 Antigravity 的调试端口（端口号在 Antigravity 写的 `DevToolsActivePort` 文件里），发现主窗口后，用 Chrome DevTools Protocol 注入翻译器和状态栏脚本。不修改 Antigravity 的安装文件，Antigravity 自动更新后仍然有效。同一时间只有一个注入程序在工作（本机单实例锁）。
- sidecar 还提供插件面板（`lib/panel.mjs`，只听 `127.0.0.1`）、没带参数启动时的重开（`lib/relaunch.mjs`）和版本更新（`lib/update.mjs`）。
- 重开：sidecar 是 Antigravity 的子进程，Antigravity 关掉时它也会被关掉，所以重开由一个脱离 Antigravity 运行的脚本来做。Windows 上是数据目录里的 `relaunch-antigravity.ps1`，交给资源管理器启动（不行再用 WMI）；macOS 上是用 `nohup` 在后台运行的 shell 脚本。脚本请 Antigravity 正常关闭，10 秒后还没退出就强制结束，再带 `--remote-debugging-port=0` 打开。每一步记进 `relaunch.log`。
- 状态栏在页面里旁听应用和本机后台之间的数据，不改应用发出的请求：Antigravity 2.35 起应用默认经一条 WebSocket（同源的 `/connect-websocket`，状态栏只认本机后台这一条）访问本机后台，状态栏包一层 `WebSocket` 的 `send`，从应用发出的帧里取 CSRF 令牌，只解析状态流、账号和额度这几种回复；WebSocket 连不上、应用退回 HTTP 时（2.34 及以前也是这样），状态栏包一层 `fetch` 旁听 grpc-web+json 数据。另外，它向本机后台查几个只读接口：额度、当前登录的账号（邮箱和订阅档次；邮箱只在页面里用来算账号编号和打码显示，不写进文件）、实际模型名、子代理运行状态和步骤、每次调用的 token 用量和调用时间（算费用和调用明细）。
- 注入程序每 30 秒把页面里今天的花费存进 `cost-day.json`，并从 `~/.gemini/antigravity/brain/` 找出今天动过的对话，再把对话库文件夹（`conversations`）里最近 32 天的对话 ID、创建时间和修改时间交给状态栏（后台的对话列表只列一部分对话），所以 Antigravity 重启后今天的金额不会丢。只存对话 ID、金额和按模型的调用数、token 数。同时把当天的汇总和额度变化写进 `usage-history.json`，再把最近 31 天交给状态栏的每日用量面板。
- 注入程序每 30 秒看一次 agy CLI 的对话库文件夹（`~/.gemini/antigravity-cli/conversations`），只读打开改过的库，读出每次调用的时间、模型、token 数、首字时间和生成用时（平时只看 `fs.watch` 报告动过的库，动过的库从上次读到的最后一行接着读；每 10 分钟全部看一遍、整个重读一次），按天写进 `usage-history.json` 的 `cli`；同时记下每个库在哪几天有调用（`cli-index.json`），看 32 天以前的明细时只读那天涉及的库。调用明细页要某一天的 CLI 调用、每日面板选 `all` 要全部历史时，经 DevTools Protocol 的 `Runtime.addBinding` 加的 `window.__agyZhAsk` 向注入程序要；注入程序只回答只读的用量数字和 CLI 对话标题。
- 不写 Antigravity 的外观设置。只有卸载时选择恢复，才会按记下的原值改回 `~/.gemini/config/config.json` 的主题颜色（以前用过作者配色的才有；装过旧版 v1.0.0 的还有 `%APPDATA%\Antigravity\app_storage.json`）。卸载时还会删掉 Antigravity 给本插件记的条目。
- 联网只有三处：从 Google Fonts 加载状态栏的图标；[在线更新](../README.md#更新) 向 api.github.com 问本项目最新的提交，再从 jsDelivr（或 raw.githubusercontent.com）下载本项目仓库里的数据文件（可以关掉）；在插件面板里点“更新”时下载新版本。

## 从源码运行、打包和发版

**从源码运行**（不装成插件）：需要 Node.js 22.13 / 23.4 或更高版本（用到内置的 `WebSocket`、`fetch` 和 `node:sqlite`）。

```bash
node inject.mjs
```

- 这样运行时，数据文件放在 `inject.mjs` 同一个文件夹里。已经有一个注入程序在跑（包括装好的插件）时，新启动的会自动退出。
- Antigravity 要带 `--remote-debugging-port=0` 启动。Windows 先运行一次 `powershell -ExecutionPolicy Bypass -File debug-port.ps1` 给快捷方式加上参数；macOS 运行 `./macos/launch-agy.command`（或 `open -a Antigravity --args --remote-debugging-port=0`），见 [macos/README.md](../macos/README.md)。
- 改了 `statusbar.js` 或 `i18n` 下的文件后，已打开的窗口会自动更新，不用重启。改了 `inject.mjs` 要重启注入程序。
- 想给页面加自己的样式（比如换回复字体），在数据目录（从源码运行时是 `inject.mjs` 同一个文件夹）放一个 `style.css`，注入程序会自动加载；没有这个文件就不改任何样式。
- 改了 `i18n/translator.js` 的逻辑，要把里面的 `VERSION` 加 1，已打开的窗口才会换用新翻译器。
- 发版前，开着 Antigravity 运行 `node tools/dev/probe.mjs all`：经调试端口打开插件面板、状态栏、每日用量面板和当天的调用明细，读出界面上的文字和悬停说明，每项写 OK / WARN / FAIL。单元测试只管函数算得对不对，这里看功能在真的 Antigravity 里有没有显示出来。另有 `plugin`（读插件面板各块的文字和开关，v2.0.15 起 `all` 也跑它）、`speed`（每日面板的 speed 页和调用明细的 by model）、`missing`（列出记下的没翻译的文字）、`calls <日子>`、`miss`、`ckpt`、`english`、`swarm`、`eval` 等命令，`node tools/dev/probe.mjs help` 看全部。加 `--shot <目录>` 顺便截图；加 `--ssh <主机>` 在另一台 macOS 上跑（把脚本复制过去，用 Antigravity 自带的 Node 运行，截图拷回来）。除了 `check`、`update`、`english`，命令都只读。
- Antigravity 升级以后，开着 Antigravity 运行 `node tools/find-ui-strings.mjs`，找新出现的界面文字。结果在 `dist/ui-strings.md`，标 NEW 的是上一次没有的。提取是按规则猜的，会混进代码里的字符串，要人工挑出界面文字再翻。
- 如果注入程序在 Antigravity 打开很久以后才启动，状态栏会提示 `Press Ctrl+R to reload this window`，按一次 Ctrl+R 刷新窗口就好。

**测试**：`node --test "tests/*.test.mjs"`（需要 Node.js 22.13 以上，读 CLI 库的测试用到 `node:sqlite`）。测试数据都是写在测试里的合成数据，不读本机的用量记录和对话库。每次推送，GitHub Actions 也会跑一遍（`.github/workflows/test.yml`）。`inject.mjs` 和 `statusbar.js` 不是模块，测试按标记截出其中的函数；改了这些函数附近的代码，测试会提示要跟着改。

**发版**（需要作者的签名私钥）：先改好代码、README 和测试记录 `docs/testing.md`（都有中英文两份），新文件先 `git add`，写好提交说明和发布说明。提交说明的第一行是标题，写短一点（三十个字以内），细节写在后面的正文里：GitHub 的文件列表只显示标题，太长会被截断。再运行

```
node tools/publish.mjs <版本> --title "<Release 标题>" --notes <发布说明.md> --message <提交说明.txt>
```

脚本按顺序做下面几步，任何一步失败就停下，说明停在哪一步；查明原因后加 `--from <步骤>` 接着做。发版前可以先加 `--check`，只检查条件、跑测试，不改文件。

1. `test`：跑测试。
2. `bump`：把 `plugin.json` 的 `version` 和 `inject.mjs` 的 `PACK_VERSION` 改成新版本。
3. `sign`：`node tools/release.mjs sign`，按 `tools/plugin-files.mjs` 的清单生成并签名 `plugin-manifest.json`。
4. `build`：`node package/build.mjs`，核对签名清单，生成 `dist/agy-zh/` 和同名 zip，再复制成英文名 `agy-zh-pack-v<版本>.zip`（GitHub 会去掉文件名里的中文）。
5. `commit`：提交（包括 `plugin-manifest.json`），打标签 `v<版本>`，按标签里的文件核对签名清单。一键更新从 jsDelivr 的 `@v<版本>` 取文件，所以标签里必须有签好名的清单。
6. `push`：推送 main 和标签。
7. `release`：在 GitHub Releases 发布，上传 zip，下载回来核对 sha256。
8. `meta`：把 `data/meta.json` 的 `latest`、`date` 改成新版本，推到 main。装着旧版本的用户这时才会看到新版本提示，所以这一步放在最后。

开始前脚本还会检查：在 main 分支上；本地 main 不落后于 GitHub（价格表工作流每天可能往 main 推提交，落后时先 `git pull --rebase`）；没有未跟踪的新文件；标签还不存在。

私钥用 Windows DPAPI 加密存在作者电脑上（`tools/release.mjs keygen` 生成）。`node tools/release.mjs export <文件>` 备份成只有当前账号能读的文件，`node tools/release.mjs import <文件>` 在重装系统或换电脑后恢复。私钥丢了就签不了新版本，已安装的插件也收不到更新。

## 文件说明

| 文件 | 作用 |
|---|---|
| `plugin.json` | 插件的名字、版本、图标 |
| `sidecars/core/sidecar.json` | sidecar 的启动方式（Antigravity 自带的 Node）和侧边栏面板 |
| `sidecars/core/main.mjs` | sidecar 入口：设好数据目录，启动注入程序、面板、重开检查；插件文件被换掉时自动重启 |
| `lib/panel.mjs` | 插件面板（网页和接口） |
| `lib/relaunch.mjs` | 没带调试端口启动时询问或自动重开 |
| `lib/update.mjs` | 版本更新：校验签名、下载、备份、替换；作者的公钥在这里 |
| `lib/remote-source.mjs` | 在线更新从哪个地址、按哪个提交下载（先问 GitHub 最新提交；问不到就用 meta.json 最新的地址） |
| `plugin-manifest.json` | 签名清单：版本、每个插件文件的 sha256 和大小、Ed25519 签名 |
| `assets/logo.svg` | 插件图标 |
| `inject.mjs` | 注入程序：连 Antigravity 的调试端口，注入下面几个文件；保存今天花费的账本；在线更新 |
| `debug-port.ps1` | 给 Windows 上的 Antigravity 快捷方式加、去启动参数 `--remote-debugging-port=0` |
| `statusbar.js` | 用量状态栏和费用估算（在页面里运行） |
| `i18n/translator.js` | 翻译器（在页面里运行） |
| `i18n/zh-CN.json` | 词典：界面英文原文 → 中文 |
| `i18n/zh-CN.rules.json` | 正则规则：相对时间、思考时长、下线日期等带数字的文字 |
| `data/prices.json` | 在线价格表（GitHub Actions 每天按官方价格页更新） |
| `data/meta.json` | 最新版本号（发版时改） |
| `tools/plugin-files.mjs` | 插件包含哪些文件（签名、打包、安装都按它） |
| `tools/release.mjs` | 发版签名：生成钥匙、签名、校验、备份和恢复私钥 |
| `tools/dev/probe.mjs` | 验收探针：经调试端口打开面板、读界面文字和悬停说明、截图、调插件面板的接口（查版本、检查和安装更新），可以经 ssh 在另一台 macOS 上跑；不进安装包 |
| `tools/find-ui-strings.mjs` | 找还没有译文的界面文字：从运行中的 Antigravity 取前端脚本、读自带插件的源码，和词典比对，结果写进 `dist/ui-strings.md` |
| `tools/publish.mjs` | 一条命令发版：测试、改版本号、签名、打包、提交打标签、推送、建 Release、改 `data/meta.json` |
| `tools/update-prices.mjs` | 按官方价格页更新 `data/prices.json` |
| `.github/workflows/update-prices.yml` | 每天跑一次上面的脚本：价格变了就提交，出了问题就开 issue |
| `.github/workflows/purge-cdn.yml` | 推送了词典或 `data/` 以后，清掉 jsDelivr 上的缓存 |
| `.github/workflows/test.yml` | 每次推送都跑一遍 `tests/` 里的测试 |
| `tests/` | 测试：额度算法、读写数据文件、读 CLI 库、翻译器、数据文件、语法和版本号 |
| `package/app/setup.mjs` | 一键安装、卸载 |
| `package/build.mjs` | 生成安装包 |
| `macos/` | 从源码运行时的 macOS 脚本（v1.x 的方式）；装插件请用安装包 |
| `docs/images/statusbar.png`、`docs/images/panel.png` | README 里的截图 |
| `docs/testing.md`、`docs/development.md` | 测试记录；原理和开发说明（本页）。各有英文版 `*.en.md` |

数据目录里的文件见 [数据](../README.md#数据)。
