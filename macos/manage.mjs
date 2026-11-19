#!/usr/bin/env node
// macOS 管理脚本：用于 agy-zh-pack 的登录自启（LaunchAgent）、启停、作者配色开关，
// 以及带 --remote-debugging-port=0 启动 Antigravity。
//
// 用法：
//   node macos/manage.mjs status
//   node macos/manage.mjs install-agent
//   node macos/manage.mjs uninstall-agent
//   node macos/manage.mjs start | stop
//   node macos/manage.mjs theme [on|off|toggle] [--force]
//   node macos/manage.mjs launch-agy [--restart]
//   node macos/manage.mjs uninstall

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 22) {
  console.error(`[错误] 需要 Node.js 22 或更高版本，当前为 v${process.versions.node}`);
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error(`[错误] 本脚本仅用于 macOS，当前平台为 ${process.platform}`);
  process.exit(1);
}

const MACOS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(MACOS_DIR);
const INJECT_PATH = path.join(ROOT_DIR, 'inject.mjs');
const ORIGINALS = path.join(ROOT_DIR, 'originals.json');
const DICT_PATH = path.join(ROOT_DIR, 'i18n', 'zh-CN.json');
const LOG_FILE = path.join(ROOT_DIR, 'inject.log');
const PIPE_UID = typeof process.getuid === 'function' ? process.getuid() : 'user';
const SOCKET_PATH = path.join('/tmp', `agy-zh-pack-${PIPE_UID}.sock`);

const HOME = os.homedir();
const AGY_APP = fs.existsSync('/Applications/Antigravity.app')
  ? '/Applications/Antigravity.app'
  : path.join(HOME, 'Applications', 'Antigravity.app');
const PORT_FILE = path.join(HOME, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
const AGY_CONFIG = path.join(HOME, '.gemini', 'config', 'config.json');

const AGENT_LABEL = 'com.ncdeng.agy-zh-pack';
const LAUNCH_AGENTS_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(LAUNCH_AGENTS_DIR, `${AGENT_LABEL}.plist`);
const DEBUG_ARG = '--remote-debugging-port=0';

const AUTHOR_THEME = {
  customThemeSeedsLight: { background: '#FAF9F5', foregroundOverride: '#141413', primary: '#D97757' },
  customThemeSeedsDark: { background: '#262624', foregroundOverride: '#FAF9F5', primary: '#D97757' },
};
const SEED_KEYS = ['background', 'foregroundOverride', 'primary'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n', 'utf8');

function runIgnore(bin, args) {
  try {
    return { ok: true, out: execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout || e.stderr || e.message || '').trim() };
  }
}

// 优先解析不随版本号变化的稳定符号链接（例如 Homebrew 的 /opt/homebrew/bin/node 或 /usr/local/bin/node），
// 避免把带版本号的 Cellar 路径写进 LaunchAgent，导致 brew upgrade 后自启失效。
function resolveStableNodeBin() {
  let realExec = process.execPath;
  try { realExec = fs.realpathSync(process.execPath); } catch {}
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node'];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.realpathSync(c) === realExec) return c;
    } catch {}
  }
  const which = runIgnore('which', ['node']);
  if (which.ok && which.out && !which.out.includes('/Cellar/')) {
    try {
      if (fs.realpathSync(which.out) === realExec) return which.out;
    } catch {}
  }
  return process.execPath;
}

const NODE_BIN = resolveStableNodeBin();

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(NODE_BIN)}</string>
    <string>${xmlEscape(INJECT_PATH)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(ROOT_DIR)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(ROOT_DIR, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(ROOT_DIR, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

function uid() {
  return typeof process.getuid === 'function' ? process.getuid() : Number(execFileSync('id', ['-u'], { encoding: 'utf8' }).trim());
}

function loadAgent(domain) {
  const res = runIgnore('launchctl', ['bootstrap', domain, PLIST_PATH]);
  if (res.ok) return { ok: true, out: res.out };
  const legacy = runIgnore('launchctl', ['load', '-w', PLIST_PATH]);
  return legacy.ok ? { ok: true, out: legacy.out } : { ok: false, out: res.out || legacy.out };
}

function isInjectorRunning() {
  return new Promise((resolve) => {
    const c = net.createConnection(SOCKET_PATH);
    c.once('connect', () => { c.destroy(); resolve(true); });
    c.once('error', () => resolve(false));
  });
}

function findAgyMainProcesses() {
  const res = runIgnore('ps', ['-axo', 'pid=,args=']);
  if (!res.ok) return [];
  const procs = [];
  for (const line of res.out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const args = m[2];
    if (!args.includes('/Antigravity.app/Contents/MacOS/Antigravity')) continue;
    if (args.includes('--type=')) continue;
    procs.push({ pid, args, hasDebugPort: /--remote-debugging-port(=|\s|$)/.test(args) });
  }
  return procs;
}

function sameSeed(a, b) {
  return !!a && SEED_KEYS.every((k) => String(a[k] || '').toLowerCase() === b[k].toLowerCase());
}

function readAgyConfig() {
  try { return readJson(AGY_CONFIG); } catch { return null; }
}

function themeActive() {
  const u = (readAgyConfig() || {}).userSettings || {};
  return Object.entries(AUTHOR_THEME).every(([k, v]) => sameSeed(u[k], v));
}

function readOriginals() {
  const o = fs.existsSync(ORIGINALS) ? readJson(ORIGINALS) : {};
  return { appStorage: o.appStorage || {}, userSettings: o.userSettings || {} };
}

function saveOriginals(o) {
  if (!Object.keys(o.appStorage).length && !Object.keys(o.userSettings).length) {
    fs.rmSync(ORIGINALS, { force: true });
  } else {
    writeJson(ORIGINALS, o);
  }
}

function applyTheme(on) {
  const cfg = readAgyConfig();
  if (!cfg) {
    console.error(`[错误] 未找到 Antigravity 配置文件：${AGY_CONFIG}`);
    console.error('       请先打开 Antigravity 并登录一次，退出后再试。');
    process.exitCode = 1;
    return false;
  }
  cfg.userSettings = cfg.userSettings || {};
  const o = readOriginals();
  for (const [k, v] of Object.entries(AUTHOR_THEME)) {
    if (on) {
      if (!(k in o.userSettings)) o.userSettings[k] = k in cfg.userSettings ? cfg.userSettings[k] : null;
      cfg.userSettings[k] = v;
    } else {
      const orig = k in o.userSettings ? o.userSettings[k] : null;
      if (orig === null) delete cfg.userSettings[k];
      else cfg.userSettings[k] = orig;
      delete o.userSettings[k];
    }
  }
  writeJson(AGY_CONFIG, cfg);
  saveOriginals(o);
  return true;
}

async function quitAntigravity() {
  if (!findAgyMainProcesses().length) return true;
  console.log('[进行中] 正在优雅退出 Antigravity...');
  runIgnore('osascript', ['-e', 'tell application "Antigravity" to quit']);
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (!findAgyMainProcesses().length) {
      console.log('[完成] Antigravity 已退出。');
      return true;
    }
  }
  console.error('[错误] 等待 Antigravity 退出超时，请手动按 Cmd+Q 退出后重试。');
  return false;
}

function launchAntigravity() {
  if (!fs.existsSync(AGY_APP)) {
    console.error(`[错误] 未找到 Antigravity 应用：${AGY_APP}`);
    process.exitCode = 1;
    return;
  }
  execFileSync('open', ['-a', AGY_APP, '--args', DEBUG_ARG]);
  console.log(`[完成] 已带调试端口参数启动 Antigravity（${DEBUG_ARG}）。`);
}

function installAgent() {
  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, buildPlist(), 'utf8');
  const domain = `gui/${uid()}`;
  runIgnore('launchctl', ['bootout', domain, PLIST_PATH]);
  const boot = loadAgent(domain);
  if (!boot.ok) {
    console.error(`[错误] 加载 LaunchAgent 失败：${boot.out}`);
    process.exitCode = 1;
    return;
  }
  runIgnore('launchctl', ['kickstart', '-k', `${domain}/${AGENT_LABEL}`]);
  console.log(`[完成] 已安装并启动登录自启服务：${PLIST_PATH}`);
  console.log(`       Node 路径：${NODE_BIN}`);
}

function uninstallAgent() {
  const domain = `gui/${uid()}`;
  runIgnore('launchctl', ['bootout', domain, PLIST_PATH]);
  runIgnore('launchctl', ['unload', '-w', PLIST_PATH]);
  if (fs.existsSync(PLIST_PATH)) {
    fs.rmSync(PLIST_PATH, { force: true });
    console.log(`[完成] 已卸载登录自启服务：${PLIST_PATH}`);
  } else {
    console.log('[提示] 未检测到已安装的 LaunchAgent。');
  }
}

function stopInjectorDirect() {
  const res = runIgnore('ps', ['-axo', 'pid=,args=']);
  if (!res.ok) return;
  for (const line of res.out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    if (m[2].includes(INJECT_PATH)) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
  try { fs.rmSync(SOCKET_PATH, { force: true }); } catch {}
}

async function startInjector() {
  if (fs.existsSync(PLIST_PATH)) {
    const domain = `gui/${uid()}`;
    const loaded = runIgnore('launchctl', ['print', `${domain}/${AGENT_LABEL}`]).ok;
    if (!loaded) {
      const boot = loadAgent(domain);
      if (!boot.ok) {
        console.error(`[错误] 加载 LaunchAgent 失败：${boot.out}`);
        process.exitCode = 1;
        return;
      }
    }
    const res = runIgnore('launchctl', ['kickstart', `${domain}/${AGENT_LABEL}`]);
    if (res.ok) {
      console.log('[完成] 已通过 LaunchAgent 启动后台注入程序。');
      return;
    }
    console.error(`[错误] 通过 LaunchAgent 启动失败：${res.out}`);
    process.exitCode = 1;
    return;
  }
  if (await isInjectorRunning()) {
    console.log('[提示] 后台注入程序已在运行中。');
    return;
  }
  const child = spawn(NODE_BIN, [INJECT_PATH], { cwd: ROOT_DIR, detached: true, stdio: 'ignore' });
  child.unref();
  await sleep(600);
  console.log(await isInjectorRunning() ? '[完成] 后台注入程序已启动。' : '[注意] 已尝试启动注入程序，请检查 inject.log。');
}

async function stopInjector() {
  const domain = `gui/${uid()}`;
  if (fs.existsSync(PLIST_PATH)) {
    runIgnore('launchctl', ['bootout', domain, PLIST_PATH]);
  }
  stopInjectorDirect();
  await sleep(300);
  console.log('[完成] 已停止后台注入程序。');
}

async function status() {
  const running = await isInjectorRunning();
  const agyProcs = findAgyMainProcesses();
  const hasPortFile = fs.existsSync(PORT_FILE);
  const portVal = hasPortFile ? fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0].trim() : '';
  const hasPlist = fs.existsSync(PLIST_PATH);
  const agentLoaded = runIgnore('launchctl', ['print', `gui/${uid()}/${AGENT_LABEL}`]).ok;

  console.log('=== agy-zh-pack (macOS) 状态 ===');
  console.log(`仓库目录        : ${ROOT_DIR}`);
  console.log(`Node.js         : ${NODE_BIN} (${process.version})`);
  console.log(`后台注入进程    : ${running ? '运行中' : '未运行'}`);
  console.log(`登录自启服务    : ${hasPlist ? (agentLoaded ? '已安装且已加载' : '已安装但未加载') : '未安装'} (${PLIST_PATH})`);
  console.log(`界面汉化        : ${fs.existsSync(DICT_PATH) ? '开启' : '关闭（缺少 i18n/zh-CN.json）'}`);
  console.log(`作者配色        : ${themeActive() ? '已启用' : '未启用（默认）'}`);
  console.log(`Antigravity 进程: ${agyProcs.length ? agyProcs.map((p) => `pid=${p.pid} (${p.hasDebugPort ? '带调试端口' : '无调试端口'})`).join(', ') : '未运行'}`);
  console.log(`调试端口文件    : ${hasPortFile ? `存在（端口 ${portVal}）` : '不存在'} (${PORT_FILE})`);
  console.log(`日志文件        : ${LOG_FILE}`);
}

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  const flags = new Set([arg1, arg2].filter(Boolean));

  switch (cmd) {
    case 'status':
      await status();
      break;
    case 'install-agent':
      installAgent();
      break;
    case 'uninstall-agent':
      uninstallAgent();
      break;
    case 'start':
      await startInjector();
      break;
    case 'stop':
      await stopInjector();
      break;
    case 'theme': {
      const mode = arg1 && !arg1.startsWith('--') ? arg1 : 'toggle';
      const next = mode === 'on' ? true : mode === 'off' ? false : !themeActive();
      if (findAgyMainProcesses().length && !flags.has('--force')) {
        console.error('[注意] Antigravity 正在运行，直接修改 ~/.gemini/config/config.json 会被应用写回覆盖。');
        console.error('       请先按 Cmd+Q 退出 Antigravity，再运行本命令。');
        process.exitCode = 1;
        return;
      }
      if (applyTheme(next)) {
        console.log(next ? '[完成] 已启用作者配色（原配色已备份至 originals.json）。' : '[完成] 已恢复原有配色。');
      }
      break;
    }
    case 'launch-agy': {
      const procs = findAgyMainProcesses();
      if (procs.length) {
        if (procs.some((p) => p.hasDebugPort) && !flags.has('--restart')) {
          console.log('[提示] Antigravity 已在运行且带有调试端口参数。如需刷新状态栏，请在窗口内按 Cmd+R。');
          return;
        }
        if (!flags.has('--restart')) {
          console.log('[提示] Antigravity 当前正在运行但未携带调试端口参数，正在退出并重新启动...');
        }
        if (!(await quitAntigravity())) {
          process.exitCode = 1;
          return;
        }
      }
      await startInjector();
      launchAntigravity();
      break;
    }
    case 'uninstall': {
      await stopInjector();
      uninstallAgent();
      if (fs.existsSync(ORIGINALS)) {
        if (findAgyMainProcesses().length) {
          console.log('[注意] 检测到 originals.json（配色备份），但 Antigravity 正在运行；请退出 Antigravity 后运行 `node macos/manage.mjs theme off` 恢复原配色。');
        } else if (applyTheme(false)) {
          console.log('[完成] 已恢复原有配色。');
        }
      }
      console.log(`[完成] 已停用并卸载后台服务。如需彻底删除文件，手动删除目录：${ROOT_DIR}`);
      break;
    }
    default:
      console.log([
        '用法：node macos/manage.mjs <命令>',
        '  status             查看运行状态与各项开关',
        '  install-agent      安装并启动 macOS 登录自启（LaunchAgent）',
        '  uninstall-agent    卸载登录自启',
        '  start / stop       启动或停止后台注入程序',
        '  theme [on|off]     启用/恢复/切换作者配色（默认关闭，需先退出 Antigravity）',
        '  launch-agy         带调试端口参数启动（或重启）Antigravity',
        '  uninstall          停止注入程序并卸载 LaunchAgent',
      ].join('\n'));
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error('[错误]', e && e.message ? e.message : e);
  process.exitCode = 1;
});
