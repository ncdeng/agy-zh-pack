// Antigravity 中文美化包：安装 / 卸载 / 上下文开关 / 配色开关脚本。
// 由“一键安装.cmd / 一键卸载.cmd / 上下文开关.cmd / 配色开关.cmd”调用：
//   node.exe setup.mjs install
//   node.exe setup.mjs uninstall
//   node.exe setup.mjs context
//   node.exe setup.mjs theme
//
// 安装做的事（缩放、字体、对比度一律不改；配色只在用户选择时才改）：
//   1. 把注入器、汉化、状态栏文件复制到 %LOCALAPPDATA%\AgyZhPack\；
//   2. 开机自启：建一个登录时触发的计划任务 AgyZhPack（当前用户、普通权限），运行安装目录里的
//      agy-zh-pack.vbs，在后台隐藏启动注入器。不用“启动”文件夹，因为 Windows 会把那里的程序延后约 7 分钟，
//      这段时间打开的 Antigravity 是英文的；计划任务建不了时才退回“启动”文件夹；
//   3. 问用户要不要用作者的配色（默认不用）。要换颜色时才请用户关闭 Antigravity，原值记进 originals.json；
//   4. 问用户要不要解锁 512K 上下文（默认不解锁），结果写进 AgyZhPack\config.json；
//   5. 立即启动注入器。Antigravity 开着就提示按 Ctrl+R 刷新，没开（或刚为换配色关掉）就打开它。
// 上下文开关（context）只改 config.json，注入器发现文件变了会自动更新已打开的窗口，不用关 Antigravity。
// 配色开关（theme）改 Antigravity 自己的设置文件，只能在它关闭时改，所以会提示关闭、改完再打开。
//
// originals.json：换上作者配色前的原值；装过旧版（v1.0.0）的还有旧版改缩放、对比度、字体前的原值。
// 新版安装不动旧版记的那部分；卸载时如果有这个文件，问要不要恢复。
//
// 测试用：设环境变量 AGY_SETUP_TEST=1，跳过所有进程操作（不关、不开 Antigravity，不启动注入器），也不建计划任务；
// 再设 AGY_SETUP_TEST_RUNNING=1 就假装 Antigravity 正开着；
// 再设 AGY_SETUP_TEST_TASK=1 就真的建一个名叫 AgyZhPack-test 的计划任务（卸载时删掉），用来测建任务这一步。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const TEST = process.env.AGY_SETUP_TEST === '1';
const LOCAL = process.env.LOCALAPPDATA;
const ROAMING = process.env.APPDATA;
const INSTALL = path.join(LOCAL, 'AgyZhPack');
const STARTUP = path.join(ROAMING, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'agy-zh-pack.vbs'); // 旧版自启位置 / 计划任务建不了时的退路
const VBS_PATH = path.join(INSTALL, 'agy-zh-pack.vbs');
const TEST_TASK = TEST && process.env.AGY_SETUP_TEST_TASK === '1';
const TASK = TEST_TASK ? 'AgyZhPack-test' : 'AgyZhPack';
const AGY_EXE = path.join(LOCAL, 'Programs', 'antigravity', 'Antigravity.exe');
const APP_STORAGE = path.join(ROAMING, 'Antigravity', 'app_storage.json');
const CONFIG = path.join(os.homedir(), '.gemini', 'config', 'config.json');
const ORIGINALS = path.join(INSTALL, 'originals.json'); // 只有旧版（v1.0.0）装过才有：当时改外观前的原值
const USER_CONFIG = path.join(INSTALL, 'config.json'); // 用户设置：目前只有 contextLimit
const CTX_ON = 512000; // 解锁后的上下文上限，和 agy CLI 在 /model 里选 512K 时一样

const FILES = ['node.exe', 'inject.mjs', 'statusbar.js', 'i18n/translator.js', 'i18n/zh-CN.json', 'i18n/zh-CN.rules.json'];
const OBSOLETE = ['style.css']; // 旧版装过、新版不再带的文件：升级时删掉（回复字体随之恢复成 Antigravity 默认）

const VBS = [
  "' Antigravity Chinese pack: start the injector hidden at logon.",
  "' Files: %LOCALAPPDATA%\\AgyZhPack. Remove with the uninstaller in the pack.",
  'Set sh = CreateObject("WScript.Shell")',
  'dir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\AgyZhPack\\"',
  'sh.Run """" & dir & "node.exe"" """ & dir & "inject.mjs""", 0, False',
  '',
].join('\r\n');

// ---------- 小工具 ----------
const say = (s = '') => console.log(s);
const ok = (s) => say('  [完成] ' + s);
const warn = (s) => say('  [注意] ' + s);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8');
// 整个过程共用一个读取器，按行排队：一次问好几个问题时，提前输入（或管道送进来）的行不会丢；
// 输入结束（EOF）后的提问一律当作直接回车。
let rl = null;
let inputClosed = false;
const pendingLines = [];
const waiters = [];
const ask = (q) => new Promise((resolve) => {
  process.stdout.write(q);
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l.trim()); else pendingLines.push(l.trim()); });
    rl.on('close', () => { inputClosed = true; while (waiters.length) waiters.shift()(''); });
  }
  if (pendingLines.length) resolve(pendingLines.shift());
  else if (inputClosed) resolve('');
  else waiters.push(resolve);
}).then((a) => { if (!process.stdin.isTTY) say(a); return a; }); // 管道输入时把答案打出来，方便看日志
const closeInput = () => { if (rl) rl.close(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim();
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Antigravity 主程序是否在运行（按完整路径判断，不会误伤同名的其他程序）
const agyRunning = () => {
  if (TEST) return process.env.AGY_SETUP_TEST_RUNNING === '1';
  try { return ps(`@(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psq(AGY_EXE)} }).Count`) !== '0'; } catch { return false; }
};
const closeAgy = async () => {
  if (TEST) return true;
  ps(`Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psq(AGY_EXE)} } | ForEach-Object { [void]$_.CloseMainWindow() }`);
  for (let i = 0; i < 16 && agyRunning(); i++) await sleep(500);
  if (agyRunning()) {
    ps(`Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psq(AGY_EXE)} } | Stop-Process -Force`);
    for (let i = 0; i < 10 && agyRunning(); i++) await sleep(500);
  }
  return !agyRunning();
};
// 需要时请用户关闭 Antigravity；返回 true 表示原来开着、稍后要重新打开
const ensureAgyClosed = async (what = '外观设置') => {
  if (!agyRunning()) return false;
  say('');
  say(`  Antigravity 正在运行。要改${what}，需要先关闭它（它运行时会把设置文件写回去）。`);
  say('  如果它正在帮你做事，请等它做完再继续。');
  await ask('  准备好了就按回车，我会自动关闭 Antigravity，改好后再帮你打开……');
  if (await closeAgy()) { ok('已关闭 Antigravity'); return true; }
  warn('没能关闭 Antigravity，请手动关掉它（包括右下角托盘里的图标），再重新运行。');
  process.exit(1);
};
const stopInjector = () => {
  if (TEST) return;
  try {
    ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like ${psq('*' + INSTALL + '*inject.mjs*')} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
  } catch {}
};
const startInjector = () => {
  if (TEST) return;
  const vbs = fs.existsSync(VBS_PATH) ? VBS_PATH : STARTUP;
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
};
// 登录时自动运行 agy-zh-pack.vbs 的计划任务（当前用户、普通权限、不限运行时长、已在运行就不重复启动）。
// 成功返回 true；没权限等原因失败返回 false。
const registerTask = () => {
  if (TEST && !TEST_TASK) return false;
  try {
    const r = ps([
      '$u = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
      `$a = New-ScheduledTaskAction -Execute ($env:WINDIR + '\\System32\\wscript.exe') -Argument ('"' + ${psq(VBS_PATH)} + '"')`,
      '$t = New-ScheduledTaskTrigger -AtLogOn -User $u',
      '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew',
      '$p = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited',
      `Register-ScheduledTask -TaskName ${psq(TASK)} -Description 'Antigravity Chinese pack: start the injector at logon (AgyZhPack)' -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`,
      `if (Get-ScheduledTask -TaskName ${psq(TASK)} -ErrorAction SilentlyContinue) { 'ok' }`,
    ].join('; '));
    return /ok/.test(r);
  } catch { return false; }
};
const unregisterTask = () => {
  if (TEST && !TEST_TASK) return false;
  try {
    return /removed/.test(ps(`if (Get-ScheduledTask -TaskName ${psq(TASK)} -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName ${psq(TASK)} -Confirm:$false; 'removed' }`));
  } catch { return false; }
};
const startAgy = () => {
  if (TEST || !fs.existsSync(AGY_EXE)) return;
  spawn(AGY_EXE, [], { detached: true, stdio: 'ignore' }).unref();
};

// ---------- 上下文上限（可选，默认关闭） ----------
const readUserConfig = () => { try { return readJson(USER_CONFIG); } catch { return {}; } };
const ctxEnabled = () => Number(readUserConfig().contextLimit) > 256000;
const writeCtx = (on) => {
  const cfg = readUserConfig();
  cfg.contextLimit = on ? CTX_ON : 0;
  writeJson(USER_CONFIG, cfg);
};
const sayCtxRisk = () => {
  say('  【可选】解锁 512K 上下文');
  say('  Antigravity 默认在对话约 25.6 万 token 时自动压缩上下文（Gemini 和 Claude 模型）。');
  say('  解锁后，压缩线提高到 51.2 万 token，长对话能记住更多内容。');
  say('  请先了解风险：');
  say('    - 这项会改变 Antigravity 发给 Google 服务器的内容，和官方桌面端的默认行为不同。');
  say('      Antigravity 服务条款禁止干扰服务，违反可能导致账号被暂停。');
  say('    - 上下文越长，每一轮消耗的额度越多，额度会用得更快。');
  say('  不解锁的话，美化包只改本机的界面显示。');
  say('  以后想改，双击“上下文开关.cmd”就行。');
};
// 问一次要不要解锁；current = 现在的设置，直接回车保持不变（新装时 current 是 false，即默认不解锁）
const askCtx = async (current) => {
  const a = await ask(current
    ? '  现在是“已解锁”。输入 n 回车=关闭（恢复默认），直接回车=保持解锁：'
    : '  现在是“未解锁”（推荐）。输入 y 回车=解锁，直接回车=保持不解锁：');
  if (current) return !/^n/i.test(a);
  return /^y/i.test(a);
};

// ---------- 作者的配色（可选，默认不用） ----------
// 只改 ~/.gemini/config/config.json 里 userSettings 的两组主题颜色，不改缩放、字体、对比度。
// 第一次换上时把原来的值记进 originals.json，换回或卸载时按它恢复（原来没有就删掉这个键 = Antigravity 默认颜色）。
// 这个文件由 Antigravity 后台进程维护，运行中改会被写回，所以只在 Antigravity 关闭时改。
const AUTHOR_THEME = {
  customThemeSeedsLight: { background: '#FAF9F5', foregroundOverride: '#141413', primary: '#D97757' },
  customThemeSeedsDark: { background: '#262624', foregroundOverride: '#FAF9F5', primary: '#D97757' },
};
const SEED_KEYS = ['background', 'foregroundOverride', 'primary'];
const sameSeed = (a, b) => !!a && SEED_KEYS.every((k) => String(a[k] || '').toLowerCase() === b[k].toLowerCase());
const readAgyConfig = () => { try { return readJson(CONFIG); } catch { return null; } };
// 现在用的是不是作者的配色（按实际颜色判断，装过旧版的也能认出来）
const themeActive = () => {
  const u = (readAgyConfig() || {}).userSettings || {};
  return Object.entries(AUTHOR_THEME).every(([k, v]) => sameSeed(u[k], v));
};
const readOriginals = () => {
  const o = fs.existsSync(ORIGINALS) ? readJson(ORIGINALS) : {};
  return { appStorage: o.appStorage || {}, userSettings: o.userSettings || {} };
};
const saveOriginals = (o) => {
  if (!Object.keys(o.appStorage).length && !Object.keys(o.userSettings).length) fs.rmSync(ORIGINALS, { force: true });
  else writeJson(ORIGINALS, o);
};
// 换上（on = true）或换回原来的颜色；调用前要确保 Antigravity 已关闭。没有设置文件时返回 false。
const applyTheme = (on) => {
  const cfg = readAgyConfig();
  if (!cfg) return false;
  cfg.userSettings = cfg.userSettings || {};
  const o = readOriginals();
  for (const [k, v] of Object.entries(AUTHOR_THEME)) {
    if (on) {
      if (!(k in o.userSettings)) o.userSettings[k] = k in cfg.userSettings ? cfg.userSettings[k] : null;
      cfg.userSettings[k] = v;
    } else {
      const orig = k in o.userSettings ? o.userSettings[k] : null;
      if (orig === null) delete cfg.userSettings[k]; else cfg.userSettings[k] = orig;
      delete o.userSettings[k];
    }
  }
  writeJson(CONFIG, cfg);
  saveOriginals(o);
  return true;
};
const sayThemeInfo = () => {
  say('  【可选】使用作者的配色（Claude 风格的暖白配色）');
  say('  浅色主题：背景 #FAF9F5、文字 #141413、强调色 #D97757；');
  say('  深色主题：背景 #262624、文字 #FAF9F5、强调色 #D97757。');
  say('  只改主题颜色，不改缩放、字体和对比度。原来的颜色会记下来，换回或卸载时恢复。');
  say('  换颜色时需要先关闭 Antigravity，改完会自动重新打开。');
  say('  以后想改，双击“配色开关.cmd”就行。');
};
const askTheme = async (current) => {
  const a = await ask(current
    ? '  现在用的是作者的配色。输入 n 回车=换回原来的颜色，直接回车=保持：'
    : '  现在用的是你自己的配色（默认）。输入 y 回车=换成作者的配色，直接回车=保持：');
  if (current) return !/^n/i.test(a);
  return /^y/i.test(a);
};
// 按需切换配色：要改才关 Antigravity。返回 { changed, reopen }
const switchTheme = async (after) => {
  const before = themeActive();
  if (after === before) return { changed: false, reopen: false };
  if (!readAgyConfig()) {
    warn('没找到 Antigravity 的设置文件 ' + CONFIG + '，配色这次没改。');
    warn('请先打开 Antigravity 登录一次，关掉后再双击“配色开关.cmd”。');
    return { changed: false, reopen: false };
  }
  const reopen = await ensureAgyClosed('配色');
  applyTheme(after);
  return { changed: true, reopen };
};

// ---------- 安装 ----------
async function install() {
  say('');
  say('  ===== Antigravity 中文美化包：安装 =====');
  say('');
  if (!fs.existsSync(AGY_EXE)) {
    warn('没在默认位置找到 Antigravity：' + AGY_EXE);
    warn('请先安装 Antigravity 并登录一次，再运行本安装程序。');
    process.exit(1);
  }
  stopInjector();

  // 1. 复制文件（不改 Antigravity 的任何设置）
  fs.mkdirSync(path.join(INSTALL, 'i18n'), { recursive: true });
  for (const f of FILES) {
    const dst = path.join(INSTALL, f);
    for (let i = 0; ; i++) {
      try { fs.copyFileSync(path.join(PKG, f), dst); break; } catch (e) {
        if (i >= 10) throw e; // node.exe 刚被结束时可能还锁着，稍等重试
        await sleep(500);
      }
    }
  }
  for (const f of OBSOLETE) fs.rmSync(path.join(INSTALL, f), { force: true });
  ok('文件已复制到 ' + INSTALL);
  if (Object.keys(readOriginals().appStorage).length) {
    warn('旧版美化包（v1.0.0）改过 Antigravity 的缩放、对比度和字体，新版不再改这些，这次保持不动。');
    warn('想恢复成安装旧版之前的样子：运行“一键卸载”时选择恢复，再重新安装。');
  }

  // 2. 开机自启：优先用计划任务（登录后立刻运行）；建不了才放“启动”文件夹（会延后几分钟）
  fs.writeFileSync(VBS_PATH, VBS, 'ascii');
  if (registerTask()) {
    if (fs.existsSync(STARTUP)) fs.rmSync(STARTUP, { force: true }); // 旧版装在“启动”文件夹里的，删掉免得重复
    ok('已设置开机自动启动（计划任务 ' + TASK + '，登录后立刻运行）');
  } else {
    fs.mkdirSync(path.dirname(STARTUP), { recursive: true });
    fs.writeFileSync(STARTUP, VBS, 'ascii');
    ok('已设置开机自动启动（“启动”文件夹）');
    if (!TEST) warn('没能建计划任务，改用“启动”文件夹：开机后要等几分钟才生效，这之前打开的 Antigravity 是英文的。');
  }

  // 3. 配色：默认不用作者的；重装时默认保持现在的样子。要改颜色才会请用户关 Antigravity
  say('');
  sayThemeInfo();
  const themeWant = await askTheme(themeActive());
  const th = await switchTheme(themeWant);
  if (th.changed) ok(themeWant ? '已换成作者的配色' : '已换回原来的配色');
  else ok(themeActive() ? '配色保持不变（作者的配色）' : '配色保持不变（你自己的）');

  // 4. 上下文上限：默认不解锁；重装时默认保持原来的选择
  say('');
  sayCtxRisk();
  const ctxOn = await askCtx(ctxEnabled());
  writeCtx(ctxOn);
  ok(ctxOn ? '已解锁 512K 上下文' : '上下文保持默认（不解锁）');
  say('');

  // 5. 启动（换配色时关掉的 Antigravity 在这里重新打开）
  startInjector();
  ok('后台注入程序已启动');
  const running = !th.reopen && agyRunning(); // 为换配色关掉的，现在重新打开
  if (!running) {
    startAgy();
    ok('正在打开 Antigravity');
  }
  say('');
  say('  安装完成！');
  if (running) {
    say('  Antigravity 正开着：几秒内界面会变成中文；');
    say('  再在 Antigravity 里按一次 Ctrl+R 刷新窗口，输入框上方就会出现用量信息。');
  } else {
    say('  Antigravity 打开后几秒内会变成中文界面，并自动刷新一次，');
    say('  然后输入框上方会出现用量信息（模型、上下文、速度、5 小时和每周额度）。');
  }
  say('  以后每次开机、每次打开 Antigravity 都会自动生效，不用再做什么。');
  say('  请保留这个文件夹：以后卸载、切换配色和上下文，都要用里面的脚本。');
  say('');
}

// ---------- 卸载 ----------
async function uninstall() {
  say('');
  say('  ===== Antigravity 中文美化包：卸载 =====');
  say('');
  stopInjector();
  ok('后台注入程序已停止');
  const hadTask = unregisterTask();
  const hadStartup = fs.existsSync(STARTUP);
  if (hadStartup) fs.rmSync(STARTUP, { force: true });
  if (hadTask || hadStartup) ok('已取消开机自动启动');

  let reopen = false;
  if (fs.existsSync(ORIGINALS)) {
    // 用过作者的配色，或装过旧版（v1.0.0，旧版安装时改过缩放、对比度、字体、配色）才会有 originals.json
    const o = readOriginals();
    const what = [Object.keys(o.appStorage).length && '缩放、对比度、字体', Object.keys(o.userSettings).length && '配色'].filter(Boolean).join('和');
    say(`  美化包改过 Antigravity 的${what}，原来的样子记下来了。`);
    const a = await ask('  要恢复成原来的样子吗？直接回车=恢复，输入 n=保留现在的样子：');
    if (!/^n/i.test(a)) {
      reopen = await ensureAgyClosed(what);
      const originals = readJson(ORIGINALS);
      if (fs.existsSync(APP_STORAGE)) {
        const store = readJson(APP_STORAGE);
        for (const [k, v] of Object.entries(originals.appStorage || {})) {
          if (v === null) delete store[k]; else store[k] = v;
        }
        writeJson(APP_STORAGE, store);
      }
      if (fs.existsSync(CONFIG)) {
        const cfg = readJson(CONFIG);
        cfg.userSettings = cfg.userSettings || {};
        for (const [k, v] of Object.entries(originals.userSettings || {})) {
          if (v === null) delete cfg.userSettings[k]; else cfg.userSettings[k] = v;
        }
        writeJson(CONFIG, cfg);
      }
      ok(what + '已恢复');
    }
  }

  for (let i = 0; fs.existsSync(INSTALL); i++) {
    try { fs.rmSync(INSTALL, { recursive: true, force: true }); } catch (e) {
      if (i >= 10) { warn('有文件还被占用，没删干净：' + INSTALL + '，重启电脑后可以手动删掉。'); break; }
      await sleep(500);
    }
  }
  if (!fs.existsSync(INSTALL)) ok('已删除 ' + INSTALL);
  if (reopen) { startAgy(); ok('正在重新打开 Antigravity'); }
  say('');
  say('  卸载完成。如果 Antigravity 还开着，按 Ctrl+R 刷新一下就会变回英文界面。');
  say('');
}

// ---------- 上下文开关 ----------
async function context() {
  say('');
  say('  ===== Antigravity 中文美化包：上下文开关 =====');
  say('');
  if (!fs.existsSync(path.join(INSTALL, 'inject.mjs'))) {
    warn('还没安装美化包，请先双击“一键安装.cmd”。');
    process.exitCode = 1;
    return;
  }
  sayCtxRisk();
  say('');
  const before = ctxEnabled();
  const after = await askCtx(before);
  writeCtx(after);
  if (after === before) {
    ok('没有改动：' + (after ? '仍然是已解锁' : '仍然是默认（不解锁）'));
  } else if (after) {
    ok('已解锁 512K 上下文');
    say('  已打开的 Antigravity 窗口几秒内会自动更新，从下一条消息开始生效。');
    say('  想确认的话，看输入框上方状态栏的上下文一项：上限显示 512k 就是生效了。');
  } else {
    ok('已关闭，恢复默认上下文');
    say('  已打开的 Antigravity 窗口几秒内会自动更新，从下一条消息开始按默认上限计算。');
    say('  已经超过 25.6 万 token 的长对话，下一轮可能会被自动压缩。');
  }
  say('');
}

// ---------- 配色开关 ----------
async function theme() {
  say('');
  say('  ===== Antigravity 中文美化包：配色开关 =====');
  say('');
  if (!fs.existsSync(path.join(INSTALL, 'inject.mjs'))) {
    warn('还没安装美化包，请先双击“一键安装.cmd”。');
    process.exitCode = 1;
    return;
  }
  sayThemeInfo();
  say('');
  const want = await askTheme(themeActive());
  const th = await switchTheme(want);
  if (!th.changed) ok('没有改动：' + (themeActive() ? '仍然是作者的配色' : '仍然是你自己的配色'));
  else ok(want ? '已换成作者的配色' : '已换回原来的配色');
  if (th.reopen) { startAgy(); ok('正在重新打开 Antigravity'); }
  say('');
}

const cmd = process.argv[2];
const actions = { install, uninstall, context, theme };
(actions[cmd] ? actions[cmd]() : Promise.reject(new Error('用法：setup.mjs install|uninstall|context|theme')))
  .catch((e) => { say(''); warn('出错了：' + (e && e.message)); say('  请截图保存这个窗口，反馈问题时附上。'); process.exitCode = 1; })
  .finally(closeInput);
