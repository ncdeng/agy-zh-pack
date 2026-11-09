// Antigravity 中文美化包：安装 / 卸载脚本。由“一键安装.cmd / 一键卸载.cmd”调用：
//   node.exe setup.mjs install
//   node.exe setup.mjs uninstall
//
// 安装做的事：
//   1. 把注入器和样式、汉化、状态栏文件复制到 %LOCALAPPDATA%\AgyZhPack\；
//   2. 改 Antigravity 的外观设置（缩放 131%、强对比度、系统字体、Claude 配色、上下文指示器），
//      改之前把原来的值记在 AgyZhPack\originals.json，卸载时按它恢复；
//   3. 开机自启：建一个登录时触发的计划任务 AgyZhPack（当前用户、普通权限），运行安装目录里的
//      agy-zh-pack.vbs，在后台隐藏启动注入器。不用“启动”文件夹，因为 Windows 会把那里的程序延后约 7 分钟，
//      这段时间打开的 Antigravity 是英文的；计划任务建不了时才退回“启动”文件夹；
//   4. 立即启动注入器，并重新打开 Antigravity。
// 外观设置只能在 Antigravity 关闭时写入，所以安装和卸载时会先提示关闭它。
//
// 测试用：设环境变量 AGY_SETUP_TEST=1，跳过所有进程操作（不关、不开 Antigravity，不启动注入器），也不建计划任务；
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
const ORIGINALS = path.join(INSTALL, 'originals.json');

// 要写入的外观设置
const APP_STORAGE_SET = {
  zoomLevel: '1.5', // 缩放约 131%
  'jetski.contrast': '2', // 对比度：强
  'jetski.typeface': 'system', // 字体：系统字体
  contextUsageIndicatorEnabled: 'true', // 发送按钮旁的上下文和额度指示器
};
const USER_SETTINGS_SET = {
  customThemeSeedsLight: { background: '#FAF9F5', foregroundOverride: '#141413', primary: '#D97757' },
  customThemeSeedsDark: { background: '#262624', foregroundOverride: '#FAF9F5', primary: '#D97757' },
};
const FILES = ['node.exe', 'inject.mjs', 'style.css', 'statusbar.js', 'i18n/translator.js', 'i18n/zh-CN.json', 'i18n/zh-CN.rules.json'];

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
const ask = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim();
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Antigravity 主程序是否在运行（按完整路径判断，不会误伤同名的其他程序）
const agyRunning = () => {
  if (TEST) return false;
  try { return ps(`@(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psq(AGY_EXE)} }).Count`) !== '0'; } catch { return false; }
};
const closeAgy = async () => {
  ps(`Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psq(AGY_EXE)} } | ForEach-Object { [void]$_.CloseMainWindow() }`);
  for (let i = 0; i < 16 && agyRunning(); i++) await sleep(500);
  if (agyRunning()) {
    ps(`Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psq(AGY_EXE)} } | Stop-Process -Force`);
    for (let i = 0; i < 10 && agyRunning(); i++) await sleep(500);
  }
  return !agyRunning();
};
// 需要时请用户关闭 Antigravity；返回 true 表示原来开着、稍后要重新打开
const ensureAgyClosed = async () => {
  if (!agyRunning()) return false;
  say('');
  say('  Antigravity 正在运行。要改外观设置，需要先关闭它。');
  say('  如果它正在帮你做事，请等它做完再继续。');
  await ask('  准备好了就按回车，我会自动关闭 Antigravity，装好后再帮你打开……');
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
  const reopen = await ensureAgyClosed();
  stopInjector();

  // 1. 复制文件
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
  ok('文件已复制到 ' + INSTALL);

  // 2. 外观设置（先记下原值）
  const originals = fs.existsSync(ORIGINALS) ? readJson(ORIGINALS) : { appStorage: {}, userSettings: {} };
  const firstTime = !fs.existsSync(ORIGINALS);

  let store = {};
  if (fs.existsSync(APP_STORAGE)) store = readJson(APP_STORAGE);
  else fs.mkdirSync(path.dirname(APP_STORAGE), { recursive: true });
  for (const [k, v] of Object.entries(APP_STORAGE_SET)) {
    if (firstTime) originals.appStorage[k] = k in store ? store[k] : null;
    store[k] = v;
  }
  writeJson(APP_STORAGE, store);
  ok('缩放 131%、强对比度、系统字体、上下文指示器已设置');

  if (fs.existsSync(CONFIG)) {
    const cfg = readJson(CONFIG);
    cfg.userSettings = cfg.userSettings || {};
    for (const [k, v] of Object.entries(USER_SETTINGS_SET)) {
      if (firstTime) originals.userSettings[k] = k in cfg.userSettings ? cfg.userSettings[k] : null;
      cfg.userSettings[k] = v;
    }
    writeJson(CONFIG, cfg);
    ok('Claude 配色已设置（浅色和深色主题）');
  } else {
    warn('没找到 ' + CONFIG + '，配色这次没设置。');
    warn('请打开 Antigravity 登录一次，关掉后再运行一次安装。');
  }
  if (firstTime) writeJson(ORIGINALS, originals);

  // 3. 开机自启：优先用计划任务（登录后立刻运行）；建不了才放“启动”文件夹（会延后几分钟）
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

  // 4. 启动
  startInjector();
  ok('后台注入程序已启动');
  if (reopen || !TEST) {
    startAgy();
    ok('正在打开 Antigravity');
  }
  say('');
  say('  安装完成！Antigravity 打开后几秒内会变成中文界面，并自动刷新一次，');
  say('  然后输入框上方会出现用量信息（模型、上下文、速度、5 小时和每周额度）。');
  say('  以后每次开机、每次打开 Antigravity 都会自动生效，不用再做什么。');
  say('  字太大或太小：在 Antigravity 里按 Ctrl+= 放大，Ctrl+- 缩小。');
  say('  请保留这个文件夹，以后卸载要用里面的“一键卸载”。');
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
    const a = await ask('  要把外观（缩放、对比度、字体、配色）恢复成安装前的样子吗？直接回车=恢复，输入 n=保留：');
    if (!/^n/i.test(a)) {
      reopen = await ensureAgyClosed();
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
      ok('外观已恢复');
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

const cmd = process.argv[2];
(cmd === 'install' ? install() : cmd === 'uninstall' ? uninstall() : Promise.reject(new Error('用法：setup.mjs install|uninstall')))
  .catch((e) => { say(''); warn('出错了：' + (e && e.message)); say('  请截图保存这个窗口，反馈问题时附上。'); process.exitCode = 1; });
