// 生成 agy-zh 安装包（v2.0 起是 Antigravity 插件）：插件文件 + 签名清单 + 安装脚本，压缩成 zip。
// 用法：先 node tools/release.mjs sign（改过插件文件就要重签），再 node package/build.mjs。
// 安装包不再带 node.exe：安装脚本用 Antigravity 自带的 Node 运行（Windows 的 Antigravity.exe、macOS 的 Antigravity Helper，
// 设 ELECTRON_RUN_AS_NODE=1）。Windows 和 macOS 用同一个 zip。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUGIN_FILES, readPluginFile } from '../tools/plugin-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // 仓库里的 package 目录
const SRC = path.dirname(HERE); // 仓库根目录 = 插件根目录
const NAME = 'agy-zh';
const DIST = path.join(SRC, 'dist');
const OUT = path.join(DIST, NAME);

// 1. 版本号和签名清单
const PACK_VERSION = (/const PACK_VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(SRC, 'inject.mjs'), 'utf8')) || [])[1];
const plugin = JSON.parse(fs.readFileSync(path.join(SRC, 'plugin.json'), 'utf8'));
if (!PACK_VERSION || plugin.version !== PACK_VERSION) { console.error(`版本号对不上：inject.mjs ${PACK_VERSION}，plugin.json ${plugin.version}`); process.exit(1); }
const META = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'meta.json'), 'utf8'));
// 由 tools/publish.mjs 运行时不提醒：它最后一步自己改 meta.json
if (META.latest !== PACK_VERSION && !process.env.AGY_ZH_PUBLISH) console.warn(`提醒：data/meta.json 的 latest 是 ${META.latest}，要发 ${PACK_VERSION} 的话记得改（推到 main 后旧版本的用户才会看到新版本提示）。`);
const { verifyManifest } = await import(pathToFileURL(path.join(SRC, 'lib', 'update.mjs')).href);
const manifestText = fs.readFileSync(path.join(SRC, 'plugin-manifest.json'), 'utf8');
const manifest = verifyManifest(manifestText);
if (manifest.version !== PACK_VERSION) { console.error(`plugin-manifest.json 是 v${manifest.version}，先运行 node tools/release.mjs sign`); process.exit(1); }
const files = new Map();
for (const rel of PLUGIN_FILES) files.set(rel, readPluginFile(fs, path.join(SRC, rel)));
for (const [rel, hash, size] of manifest.files) {
  const buf = files.get(rel);
  if (!buf || buf.length !== size || crypto.createHash('sha256').update(buf).digest('hex') !== hash) {
    console.error(`${rel} 和 plugin-manifest.json 对不上（改过文件没重签？），先运行 node tools/release.mjs sign`);
    process.exit(1);
  }
}

// 2. 文件夹：app/ 里是插件文件（统一成 LF）、签名清单和安装程序
// 文件夹本身被别的程序当作工作目录占着时（比如从这里启动过的 Antigravity）删不掉，就只清空里面的东西
try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true }); }
for (const [rel, buf] of files) {
  fs.mkdirSync(path.dirname(path.join(OUT, 'app', rel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'app', rel), buf);
}
fs.writeFileSync(path.join(OUT, 'app', 'plugin-manifest.json'), manifestText);
fs.copyFileSync(path.join(HERE, 'app', 'setup.mjs'), path.join(OUT, 'app', 'setup.mjs'));

// Windows：.cmd（只用 ASCII，提示文字由 setup.mjs 输出）
const cmd = (action) => [
  '@echo off',
  'chcp 65001 >nul',
  'set "AGY=%LOCALAPPDATA%\\Programs\\antigravity\\Antigravity.exe"',
  'if not exist "%AGY%" (',
  '  echo   Antigravity not found: %AGY%',
  '  echo   Please install Antigravity and sign in once, then run this again.',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  'set ELECTRON_RUN_AS_NODE=1',
  `"%AGY%" "%~dp0app\\setup.mjs" ${action}`,
  'set ELECTRON_RUN_AS_NODE=',
  'echo.',
  'pause',
  '',
].join('\r\n');
// macOS：.command（zip 里没有执行权限，说明里写了用“bash 文件名”运行）
const command = (action) => [
  '#!/bin/bash',
  '# agy-zh：Antigravity 中文插件（macOS）。在“终端”里运行：bash 本文件（或者右键 → 打开方式 → 终端）',
  'cd "$(dirname "$0")"',
  'APP="/Applications/Antigravity.app"; [ -d "$APP" ] || APP="$HOME/Applications/Antigravity.app"',
  'NODE="$APP/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"',
  'if [ ! -x "$NODE" ]; then echo "  没找到 Antigravity.app，请先安装 Antigravity 并登录一次。"; exit 1; fi',
  `ELECTRON_RUN_AS_NODE=1 "$NODE" "$(pwd)/app/setup.mjs" ${action}`,
  '',
].join('\n');
for (const [zh, action] of [['一键安装', 'install'], ['一键卸载', 'uninstall'], ['配色开关', 'theme']]) {
  fs.writeFileSync(path.join(OUT, zh + '.cmd'), cmd(action), 'ascii');
  fs.writeFileSync(path.join(OUT, zh + '.command'), command(action), 'utf8');
}

// 测试过的 Antigravity 版本（改了要同步 README.md 的“测试情况”和 README.en.md 的“Tested versions”）
const TESTED = 'Antigravity 桌面版 2.34.0，Windows 11 和 macOS 15';

const readme = `agy-zh：Antigravity 中文插件（非官方）v${PACK_VERSION}

这是第三方工具，和 Google 没有关系。安装前请先读完“风险”一节。
从 v2.0 起，agy-zh 是一个 Antigravity 插件：Antigravity 开着时它才运行，由 Antigravity 负责启动和停止。

【风险】
- Antigravity 附加服务条款第 6 条：不得滥用、损害、干扰服务，包括
  “using the Service in connection with products not provided by us”（和非 Google 提供的产品一起使用服务）。
  违反条款可能导致 Antigravity 和 Gemini CLI 账号被暂停或终止。作者不能保证使用本工具不违反条款。
- 本工具只在本机界面上加汉化和用量状态栏，不改发给 Google 的内容，默认也不改 Antigravity 的设置
  （缩放、配色、字体都保持你自己的）。作者的配色是可选项，见下面“配色开关”。
- 本工具依赖 Antigravity 内部的页面结构。Antigravity 更新后，部分功能可能失效或显示英文。
  测试过的版本：${TESTED}。
- 汉化要靠 Antigravity 的调试端口（本机 127.0.0.1）。本机上的其他程序可以通过它控制 Antigravity 窗口。介意的话不要使用本工具。
- 在线更新会从本项目的 GitHub 仓库下载词典和价格表。万一仓库被人篡改，界面上可能出现被改过的文字（不会执行代码）。
  代码更新必须有作者的签名才装，仓库被改也装不进没签名的代码。

【装好以后的样子】
- 界面变成中文：菜单、设置、按钮、提示文字等。对话内容、代码、文件名不翻译。
- 输入框上方有用量信息（两行）：模型、上下文、缓存命中、花费（这个对话、今天）、首字时间、生成速度、5 小时和每周额度；
  子代理各占一行。鼠标停在任何一项上会显示中文说明。点“$x today”打开每日用量面板（每天的花费、token、额度、调用明细、
  每周额度预估），右上角的 theme 可以换状态栏的外观。
- 插件面板：Antigravity 右上角的“插件”菜单 → agy-zh。显示运行状态，可以开关在线更新、更新版本、带参数重启 Antigravity。
- 费用是按 Google / Anthropic 公开的 API 标准价把 token 折成美元，是折算值，不是实际扣费（订阅按额度扣）。

【安装（Windows）】
1. 先安装 Antigravity，并登录一次。
2. 把压缩包解压到任意位置（不要在压缩包里直接双击运行）。
3. 双击“一键安装.cmd”。如果弹出“Windows 已保护你的电脑”，点“更多信息”，再点“仍要运行”。
4. 按提示操作。装过旧版（v1.x）的直接装就行：旧版的每日记录和外观设置会自动搬过来，旧版的开机自启会删掉。
5. 以后请从开始菜单、桌面或任务栏的图标打开 Antigravity（安装程序给这些快捷方式加了 --remote-debugging-port=0）。

【安装（macOS）】
1. 先安装 Antigravity，并登录一次。
2. 解压压缩包，打开“终端”，输入 bash 和一个空格，把“一键安装.command”拖进终端窗口，按回车。
3. 按提示操作。从源码运行过旧版的，旧版的登录自启会删掉、数据会搬过来；源码文件夹不动，确认正常后可以自己删。
4. macOS 从程序坞打开 Antigravity 时不带调试端口参数。插件会帮你关掉再带参数重开（安装时可以选自动重开，或每次先问）。

【更新】
- 词典和价格：每 6 小时自动从 GitHub（经 jsDelivr）取最新的，不用重装。插件面板里可以关掉。
- 代码：有新版本时，插件面板和每日用量面板会提示。在插件面板里点“更新”，校验作者签名后自动安装，插件自动重启，
  Antigravity 不用关。签名或任何一个文件对不上就不装。

【快捷方式参数（Windows）】
- Antigravity 2.33.0 起，只有带启动参数 --remote-debugging-port=0 打开时，本工具才能改它的界面。
  安装程序会给开始菜单、桌面、任务栏上的 Antigravity 快捷方式加上这个参数，卸载时去掉。
- Antigravity 自动更新后可能重写快捷方式或自己重启：插件会把参数补回去；这次启动没带参数时会弹框问你要不要重开。

【配色开关（可选，默认不用）】
- 作者的配色是 Claude 风格的暖白配色：
  浅色主题 背景 #FAF9F5、文字 #141413、强调色 #D97757；深色主题 背景 #262624、文字 #FAF9F5、强调色 #D97757。
- 只改主题颜色，不改缩放、字体和对比度。换上前会记下你原来的颜色，换回或卸载时恢复。
- 想换上或换回：运行“配色开关”，按提示输入。换颜色时要先关闭 Antigravity，改完会自动重新打开。

【卸载】
运行“一键卸载”。会删掉插件、去掉快捷方式上的参数；用过作者配色的会问要不要恢复；最后问要不要连每天的用量记录一起删。
请保留这个文件夹，卸载、切换配色时都要用。

【说明】
- 不修改 Antigravity 本身的文件，Antigravity 自动更新后仍然有效。
- 插件装在 ~/.gemini/config/plugins/agy-zh-pack（Windows 是 %USERPROFILE%\\.gemini\\config\\plugins\\agy-zh-pack）。
- 数据在 ~/.gemini/antigravity/plugin_data/agy-zh-pack：今天的花费（cost-day.json）、每天用量的历史（usage-history.json，
  只存数字和打码的邮箱）、额度读数（quota-samples.json）、状态栏外观和在线更新开关（look.json）、插件设置（settings.json）、
  配色原值（originals.json）、在线更新下载到的文件（remote）、日志（inject.log）。
- 联网只有三处：从 Google Fonts 加载状态栏的图标；在线更新从 jsDelivr（或 raw.githubusercontent.com）下载词典和价格；
  在插件面板里点“更新”时下载新版本。用量和额度是向本机的 Antigravity 后台查的。
- 安装脚本用 Antigravity 自带的 Node 运行，不用另装 Node.js。
`;
fs.writeFileSync(path.join(OUT, '使用说明.txt'), '\uFEFF' + readme.replace(/\n/g, '\r\n'), 'utf8');

// 3. 压缩（PowerShell 7 的 Compress-Archive 用 UTF-8 文件名）
const zip = path.join(DIST, NAME + '.zip');
fs.rmSync(zip, { force: true });
execFileSync('pwsh', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath '${OUT.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`], { stdio: 'inherit' });
console.log('folder:', OUT);
console.log('zip:', zip, (fs.statSync(zip).size / 1024).toFixed(0) + ' KB', 'version', PACK_VERSION);
