// 生成“Antigravity中文美化包”：把当前在用的文件和安装脚本拼成一个文件夹，再压缩成 zip。
// 用法：node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // 仓库里的 package 目录
const SRC = path.dirname(HERE); // 仓库根目录（inject.mjs、statusbar.js 等所在的目录）
const NAME = 'Antigravity中文美化包';
const DIST = path.join(SRC, 'dist');
const OUT = path.join(DIST, NAME);
const NODE = process.execPath;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'app', 'i18n'), { recursive: true });

const copy = (from, to) => fs.copyFileSync(from, path.join(OUT, 'app', to));
copy(NODE, 'node.exe');
copy(path.join(HERE, 'app', 'setup.mjs'), 'setup.mjs');
// 公开版只带汉化和状态栏：不带 style.css（回复字体）；安装时不改缩放、字体、对比度，配色由用户选择要不要用作者的
for (const f of ['inject.mjs', 'statusbar.js', 'debug-port.ps1']) copy(path.join(SRC, f), f);
for (const f of ['translator.js', 'zh-CN.json', 'zh-CN.rules.json']) copy(path.join(SRC, 'i18n', f), path.join('i18n', f));

// node.exe 是 Node.js 官方程序（MIT 许可）。Node.js 的 LICENSE 放在 package\third_party\node-LICENSE.txt
// （从 github.com/nodejs/node 对应版本的 LICENSE 下载），打包时一起放进去。没有这个文件就不打包。
const NODE_LICENSE = path.join(HERE, 'third_party', 'node-LICENSE.txt');
if (!fs.existsSync(NODE_LICENSE)) {
  console.error('缺少 package/third_party/node-LICENSE.txt（Node.js 的许可证），安装包里必须带上。');
  console.error(`下载地址：https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  process.exit(1);
}
copy(NODE_LICENSE, 'node-LICENSE.txt');

const cmd = (action) => ['@echo off', 'chcp 65001 >nul', `"%~dp0app\\node.exe" "%~dp0app\\setup.mjs" ${action}`, 'echo.', 'pause', ''].join('\r\n');
fs.writeFileSync(path.join(OUT, '一键安装.cmd'), cmd('install'), 'ascii');
fs.writeFileSync(path.join(OUT, '一键卸载.cmd'), cmd('uninstall'), 'ascii');
fs.writeFileSync(path.join(OUT, '配色开关.cmd'), cmd('theme'), 'ascii');

// 测试过的 Antigravity 版本（改了要同步 README.md 的“测试情况”和 README.en.md 的“Tested versions”）
const TESTED = 'Antigravity 桌面版 2.34.0（汉化、状态栏）、2.33.0（快捷方式参数）、2.31.2（配色开关），Windows 11';

const readme = `Antigravity 中文美化包（非官方）

这是第三方工具，和 Google 没有关系。安装前请先读完“风险”一节。

【风险】
- Antigravity 附加服务条款第 6 条：不得滥用、损害、干扰服务，包括
  “using the Service in connection with products not provided by us”（和非 Google 提供的产品一起使用服务）。
  违反条款可能导致 Antigravity 和 Gemini CLI 账号被暂停或终止。作者不能保证使用本工具不违反条款。
- 本工具只在本机界面上加汉化和用量状态栏，不改发给 Google 的内容，
  默认也不改 Antigravity 的设置（缩放、配色、字体都保持你自己的）。作者的配色是可选项，见下面“配色开关”。
- 本工具依赖 Antigravity 内部的页面结构。Antigravity 更新后，部分功能可能失效或显示英文。
  测试过的版本：${TESTED}。

【装好以后的样子】
- 界面变成中文：菜单、设置、按钮、提示文字等。对话内容、代码、文件名不翻译。
- 输入框上方有用量信息（两行）：
  第一行：模型（界面上的名字 + 接口实际返回的模型名，灰测版本会标黄）、上下文用量、缓存命中、
          费用（这个对话累计、今天累计）；
  第二行：首字时间、生成速度、5 小时额度和每周额度（已用比例、重置时间、和匀速用完的进度差）。
  子代理每个单独一行，连成树形：模型、上下文、缓存、这个子代理自己的花费、运行时间（或在等你批准、跑完的用时和步数），
  跑完约 10 秒后自动收起；打开子代理窗口时，显示的是那个子代理自己的数据。
  鼠标停在任何一项上，会显示中文的详细说明。
  点“$x today”会打开每日用量面板：当前账号（邮箱打码）、最近 7 天或 30 天每天的折算花费、token、缓存命中率、
  当天用掉的每周额度，以及每周额度的估算（整周额度约合多少钱和 token、到重置时大约会用到多少）。
  点表格里的某一天，可以看那一天每次模型调用的明细（时间、对话、模型、花费、token、速度、首字时间）。
  面板右上角的 theme 可以换状态栏的外观：8 套配色（默认 Cometix）、3 种外形、4 种额度进度条、信息详略、
  4 种图标（实心、线条、普通字符、不显示），每一项还可以换成备选图标；
  配色跟着 Antigravity 的浅色 / 深色自动切换，选择记在安装目录的 look.json；想回到默认，在 theme 页右上角点 reset。
  装好后会从 Antigravity 自己的对话库（只读）补算以前每天的花费和 token，只补一次；以前的天数没有额度记录。
  （从 v1.5.x 升级：以前补算的天数会按每次调用自己的时间重算一次，跑过 0 点的对话不再整轮记到前一天。）
  费用是按 Google / Anthropic 公开的 API 标准价把 token 折成美元，是折算值，不是实际扣费（订阅按额度扣）。
  状态栏的外观和英文写法借鉴 Haleclipse（哈雷）的 CCometixLine（ccline）的 cometix 主题：https://github.com/Haleclipse/CCometixLine

【安装】
1. 先安装 Antigravity，并登录一次。
2. 把压缩包解压到任意位置（不要在压缩包里直接双击运行）。
3. 双击“一键安装.cmd”。
   如果弹出“Windows 已保护你的电脑”，点“更多信息”，再点“仍要运行”。
4. 安装中会问一个可选项：要不要用作者的配色。不确定就直接按回车（不用）。
   选了作者的配色时，安装程序会请你关闭 Antigravity，改完再自动打开。
5. 看到“安装完成”，按任意键关掉窗口就行。
6. Antigravity 原来就开着的话，不用关；装好后在 Antigravity 里按一次 Ctrl+R 刷新窗口，用量信息就会出现。
   （Antigravity 2.33.0 及以后：如果它这次启动没带调试端口参数，安装程序会问你，回车后自动重开一次。）

【快捷方式参数（Antigravity 2.33.0 起需要）】
- Antigravity 2.33.0 起，只有带启动参数 --remote-debugging-port=0 打开时，本工具才能连上它的窗口。
  安装程序会自动给开始菜单、桌面、任务栏上的 Antigravity 快捷方式加上这个参数，卸载时去掉。
- 请从这些快捷方式打开 Antigravity。直接双击 Antigravity.exe 打开时，界面会是英文。
- Antigravity 自动更新后可能重写快捷方式、或自己重新启动：注入程序会自动把参数补回去；
  如果 Antigravity 正开着但没带参数，右下角会弹出提醒，关掉 Antigravity 再从快捷方式打开即可。
- 这个参数会在本机 127.0.0.1 上打开一个调试端口（2.33.0 以前的 Antigravity 本来就默认打开）。
  本机上的其他程序可以通过它控制 Antigravity 窗口。介意的话不要使用本工具。

【配色开关（可选，默认不用）】
- 作者的配色是 Claude 风格的暖白配色：
  浅色主题 背景 #FAF9F5、文字 #141413、强调色 #D97757；深色主题 背景 #262624、文字 #FAF9F5、强调色 #D97757。
- 只改主题颜色，不改缩放、字体和对比度。换上前会记下你原来的颜色，换回或卸载时恢复。
- 想换上或换回：双击“配色开关.cmd”，按提示输入。换颜色时要先关闭 Antigravity，改完会自动重新打开。

【以前的“上下文开关”已经去掉】
- 旧版有一个可选的“解锁 512K 上下文”。2026 年 11 月起，Antigravity 官方默认的上下文上限已经提高
  （实测 Gemini 约 51.2 万 token，Claude Opus 5.5 约 84 万 token），再解锁反而会把 Claude 的上限压低，所以去掉了。
- 装过旧版的，用新版的“一键安装.cmd”装一次就会删掉旧设置。升级以后，旧文件夹里的“上下文开关.cmd”就不起作用了。

【刷新】
- 一般不用手动刷新：开机后注入程序会自动启动，Antigravity 刚打开时会自动刷新一次。
  如果输入框上方提示“Press Ctrl+R to reload this window”，按一下 Ctrl+R 就好。

【卸载】
双击“一键卸载.cmd”。用过作者的配色（或装过会改外观的旧版 v1.0.0）的，卸载时会问要不要恢复成原来的样子。
请保留这个文件夹，卸载、切换配色时都要用。

【说明】
- 不修改 Antigravity 本身的文件，Antigravity 自动更新后仍然有效。
- 安装位置：%LOCALAPPDATA%\\AgyZhPack（原来的配色记在 originals.json，今天的花费记在 cost-day.json，每天用量的历史记在 usage-history.json，只存数字和打码的邮箱；额度读数记在 quota-samples.json，保留 8 天；状态栏外观的选择记在 look.json）
- 开机自启项：计划任务“AgyZhPack”（登录后立刻在后台运行，约占 60 MB 内存）。
  电脑不允许建计划任务时，会改用“启动”文件夹里的 agy-zh-pack.vbs（开机后要等几分钟才生效）。
- 用量和额度是向本机的 Antigravity 后台查的。除了从 Google Fonts 在线加载状态栏的图标，不会连接其他网站。
- 自带的 node.exe 是 Node.js ${process.version} 官方程序，许可证见 app\\node-LICENSE.txt。
`;
fs.writeFileSync(path.join(OUT, '使用说明.txt'), '﻿' + readme.replace(/\n/g, '\r\n'), 'utf8');

// 压缩（PowerShell 7 的 Compress-Archive 用 UTF-8 文件名）
const zip = path.join(DIST, NAME + '.zip');
fs.rmSync(zip, { force: true });
execFileSync('pwsh', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath '${OUT.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`], { stdio: 'inherit' });
console.log('folder:', OUT);
console.log('zip:', zip, (fs.statSync(zip).size / 1024 / 1024).toFixed(1) + ' MB');
