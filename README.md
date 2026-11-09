# agy-zh-pack

Antigravity 桌面版（Windows）的非官方中文美化包：界面汉化、助手回复的字体和配色、输入框上方的用量状态栏。

> 这是第三方项目，和 Google 没有关系。使用前请先读下面的“风险”一节。

## 功能

- **界面汉化**：菜单、设置、按钮、提示文字换成中文（约 1700 条词典 + 44 条规则）。对话内容、代码、文件名不翻译。
- **回复字体**：助手回复的英文用 Lora，中文用 Noto Serif SC，标题用 Poppins。字体从 Google Fonts 在线加载。
- **外观**：界面缩放 131%、强对比度、系统字体、暖白配色。配色参考 Anthropic 公开的品牌指南。
- **用量状态栏**（输入框上方）：
  - 模型：界面上的名字，加上接口实际返回的模型名。Gemini 模型两者对不上时标黄。
  - 上下文用量、缓存命中、首字时间、生成速度、本次 token 数。
  - 5 小时额度和每周额度：已用比例、重置时间、和匀速用完相比的快慢。
  - 子代理：在跑的子代理每个单独一行，跑完约 10 秒后收起。打开子代理窗口时，显示那个子代理自己的数据。
  - 鼠标停在任何一项上，会显示详细说明。
- **可选：上下文上限 512K**。默认关闭，见下文“风险”。

## 风险

请先读完这一节，再决定用不用。

- Antigravity 附加服务条款第 6 条规定：不得滥用、损害、干扰服务，包括 “using the Service in connection with products not provided by us”。违反条款可能导致 Antigravity 和 Gemini CLI 账号被暂停或终止。本项目是第三方工具，作者不能保证使用它不违反条款。
- 汉化、字体、配色只改本机的界面显示。状态栏只读取本机数据。
- **512K 上下文风险最高，所以默认关闭。** 打开后，发给 Google 服务器的请求内容会改变：Gemini 和 Claude 模型的压缩线从 256K 提高到 512K（和 agy CLI 选 512K 时发的字段一样）。上下文越长，每一轮消耗的额度越多。要打开，把 `statusbar.js` 里的 `CTX_LIMIT` 改成 `512000`。
- 本项目依赖 Antigravity 内部的页面结构和接口。Antigravity 更新后，部分功能可能失效。
- 测试过的版本：Antigravity 桌面版 2.29.0，Windows 11。

## 安装（一键安装包）

1. 安装 Antigravity，并登录一次。
2. 从 Releases 下载 `Antigravity中文美化包.zip`，解压到任意位置。不要在压缩包里直接运行。
3. 双击 `一键安装.cmd`。如果弹出“Windows 已保护你的电脑”，点“更多信息”，再点“仍要运行”。
4. 如果 Antigravity 正开着，安装程序会提示。按回车后它会自动关闭 Antigravity，装好后再打开。

安装程序做的事：

- 把文件复制到 `%LOCALAPPDATA%\AgyZhPack`。安装包自带 `node.exe`，不用另装 Node.js。
- 改 Antigravity 的外观设置。改之前把原值记在 `originals.json`，卸载时恢复。
- 建计划任务 `AgyZhPack`：登录时在后台启动注入程序（普通权限，约占 60 MB 内存）。建不了计划任务时，改用“启动”文件夹。

## 卸载

双击 `一键卸载.cmd`，按提示选择要不要把外观恢复成安装前的样子。请保留解压出来的文件夹，卸载时要用。

## 原理

- Antigravity 主进程启动时会打开 Chromium 远程调试端口，端口号写在 `%APPDATA%\Antigravity\DevToolsActivePort`。
- `inject.mjs` 常驻后台，每 3 秒检查一次。发现主窗口后，用 Chrome DevTools Protocol 注入样式、翻译器和状态栏脚本。
- 不修改 Antigravity 的安装文件，Antigravity 自动更新后仍然有效。
- 状态栏在页面里包一层 `fetch`，旁听应用和本机后台（`language_server`）之间的 grpc-web+json 数据。另外，它向本机后台查几个只读接口：额度、实际模型名、子代理运行状态。
- 外观设置存在 `%APPDATA%\Antigravity\app_storage.json` 和 `%USERPROFILE%\.gemini\config\config.json`，只由安装脚本写入。

## 从源码运行

需要 Windows 和 Node.js 22 或更高版本（用到内置的 `WebSocket` 和 `fetch`）。

```bash
node inject.mjs
```

- 注入程序常驻后台。已经有一个在跑时，新启动的会自动退出。
- 改了 `style.css`、`statusbar.js` 或 `i18n` 下的文件后，已打开的窗口会自动更新，不用重启。
- 如果注入程序在 Antigravity 打开很久以后才启动，状态栏会提示按 Ctrl+R 刷新一次窗口。
- 从源码运行不会改外观设置。要改外观，用一键安装包。

## 打包

```bash
node package/build.mjs
```

生成 `dist/Antigravity中文美化包/` 和同名 zip。zip 里带上当前运行的 `node.exe`。

发布前，把 Node.js 的许可证放到 `package/third_party/node-LICENSE.txt`，打包时会一起放进安装包。

## 文件

| 文件 | 作用 |
|---|---|
| `inject.mjs` | 注入程序：连 Antigravity 的调试端口，注入下面几个文件 |
| `style.css` | 助手回复的字体 |
| `statusbar.js` | 用量状态栏（在页面里运行） |
| `i18n/translator.js` | 翻译器（在页面里运行） |
| `i18n/zh-CN.json` | 词典：界面英文原文 → 中文 |
| `i18n/zh-CN.rules.json` | 正则规则：相对时间、思考时长等带数字的文字 |
| `package/app/setup.mjs` | 一键安装和卸载 |
| `package/build.mjs` | 生成安装包 |

## 致谢

- 状态栏外观参考 CCometixLine 的 cometix 预设；5 小时和每周额度的显示方式参考 agyline。
- 状态栏配色：Catppuccin（浅色 Latte，深色 Mocha）。
- 字体：Lora、Poppins、Noto Serif SC、Noto Sans SC（Google Fonts，SIL Open Font License 1.1）。
- 图标：Material Symbols（Apache License 2.0）。

## 许可

本项目代码使用 MIT 许可，见 [LICENSE](LICENSE)。

Antigravity 是 Google 的产品。词典 `zh-CN.json` 的键是 Antigravity 的界面英文原文，用于匹配要翻译的文字。
