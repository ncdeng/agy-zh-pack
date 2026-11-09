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
for (const f of ['inject.mjs', 'style.css', 'statusbar.js']) copy(path.join(SRC, f), f);
for (const f of ['translator.js', 'zh-CN.json', 'zh-CN.rules.json']) copy(path.join(SRC, 'i18n', f), path.join('i18n', f));

// node.exe 是 Node.js 官方程序（MIT 许可）。把 Node.js 的 LICENSE 放在 package\third_party\node-LICENSE.txt，
// 打包时会一起放进去；没有这个文件就提醒一下（公开发布前要补上）。
const NODE_LICENSE = path.join(HERE, 'third_party', 'node-LICENSE.txt');
if (fs.existsSync(NODE_LICENSE)) copy(NODE_LICENSE, 'node-LICENSE.txt');
else console.warn('注意：没有 package/third_party/node-LICENSE.txt，安装包里没带 Node.js 的许可证（公开发布前要补上）');

// 上下文上限：按 statusbar.js 里的 CTX_LIMIT 写使用说明（0 = 关闭）
const CTX_LIMIT = Number((/const CTX_LIMIT = (\d+)/.exec(fs.readFileSync(path.join(SRC, 'statusbar.js'), 'utf8')) || [])[1]) || 0;
const ctxText = CTX_LIMIT > 0
  ? `- 上下文上限从 256K 提高到 ${Math.round(CTX_LIMIT / 1000)}K（Gemini 和 Claude 模型）：长对话不会在 25 万 token 左右就被自动压缩。\n` +
    '  注意：上下文越长，每一轮消耗的额度越多。\n'
  : '';

const cmd = (action) => ['@echo off', 'chcp 65001 >nul', `"%~dp0app\\node.exe" "%~dp0app\\setup.mjs" ${action}`, 'echo.', 'pause', ''].join('\r\n');
fs.writeFileSync(path.join(OUT, '一键安装.cmd'), cmd('install'), 'ascii');
fs.writeFileSync(path.join(OUT, '一键卸载.cmd'), cmd('uninstall'), 'ascii');

const readme = `Antigravity 中文美化包

【装好以后的样子】
- 界面变成中文：菜单、设置、按钮、提示文字等。对话内容不翻译。
- 回复用 Claude 官方风格的字体：英文 Lora，中文宋体风格（Noto Serif SC），标题用 Poppins。
- Claude 风格的暖白配色，界面放大到 131%，对比度加强，字更清楚。
- 输入框上方有用量信息（两行）：
  第一行：模型（界面上的名字 + 接口实际返回的模型名，灰测版本会标黄）、上下文用量、缓存命中；
  第二行：首字时间、生成速度、这次的 token 数、5 小时额度和每周额度（已用比例、重置时间、和匀速用完的进度差）。
  子代理在跑时，每个子代理单独一行，跑完约 10 秒后自动收起；打开子代理窗口时，显示的是那个子代理自己的数据。
  鼠标停在任何一项上，会显示详细说明。
${ctxText}
【安装】
1. 先安装 Antigravity，并登录一次。
2. 把压缩包解压到任意位置（不要在压缩包里直接双击运行）。
3. 双击“一键安装.cmd”。
   如果弹出“Windows 已保护你的电脑”，点“更多信息”，再点“仍要运行”。
4. 如果 Antigravity 正开着，窗口里会提示，按回车后它会自动关闭，装好后再自动打开。
5. 看到“安装完成”，按任意键关掉窗口就行。

【调整】
- 字太大或太小：在 Antigravity 里按 Ctrl+= 放大，按 Ctrl+- 缩小。
- 一般不用手动刷新：开机后注入程序会自动启动，Antigravity 刚打开时会自动刷新一次。
  如果输入框上方提示“按 Ctrl+R 刷新一次窗口”，按一下就好。

【卸载】
双击“一键卸载.cmd”，按提示选择要不要把外观恢复成安装前的样子。
请保留这个文件夹，卸载时要用。

【说明】
- 不修改 Antigravity 本身的文件，Antigravity 自动更新后仍然有效。
- 安装位置：%LOCALAPPDATA%\\AgyZhPack
- 开机自启项：计划任务“AgyZhPack”（登录后立刻在后台运行，约占 60 MB 内存）。
  电脑不允许建计划任务时，会改用“启动”文件夹里的 agy-zh-pack.vbs（开机后要等几分钟才生效）。
- 只改界面显示${CTX_LIMIT > 0 ? '，以及发给 Antigravity 本机后台的上下文上限' : ''}；用量和额度是向本机后台查的。
  除了从 Google Fonts 在线加载字体和图标，不会连接其他网站。
`;
fs.writeFileSync(path.join(OUT, '使用说明.txt'), '﻿' + readme.replace(/\n/g, '\r\n'), 'utf8');

// 压缩（PowerShell 7 的 Compress-Archive 用 UTF-8 文件名）
const zip = path.join(DIST, NAME + '.zip');
fs.rmSync(zip, { force: true });
execFileSync('pwsh', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath '${OUT.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`], { stdio: 'inherit' });
console.log('folder:', OUT);
console.log('zip:', zip, (fs.statSync(zip).size / 1024 / 1024).toFixed(1) + ' MB');
