// agy-zh：Antigravity 中文插件（v2.0 起是 Antigravity 插件）：安装 / 卸载 / 配色开关。
// Windows 由“一键安装.cmd / 一键卸载.cmd / 配色开关.cmd”调用，macOS 由同名的 .command 调用；都用 Antigravity 自带的 Node 运行
// （Antigravity.exe / Antigravity 设 ELECTRON_RUN_AS_NODE=1），不用另装 Node.js：
//   setup.mjs install | uninstall | theme
//
// 安装做的事（缩放、字体、对比度一律不改；配色只在用户选择时才改）：
//   1. 核对安装包：按 plugin-manifest.json 校验作者签名和每个文件的 sha256。
//   2. Antigravity 开着但这次没带调试端口参数：问过用户后先关掉，装完再带参数打开。
//   3. 从 v1.x 迁移：停掉旧的注入程序，删掉开机自启（Windows 计划任务 AgyZhPack / “启动”文件夹，macOS LaunchAgent），
//      把账本、用量历史、外观、额度读数、配色原值、style.css 搬到新的数据目录，删掉旧的安装目录（Windows）。
//   4. 把插件文件复制到 ~/.gemini/config/plugins/agy-zh-pack/。Antigravity 几秒内会自动发现并启动它（不用重启）。
//   5. Windows：给 Antigravity 的快捷方式加上 --remote-debugging-port=0（debug-port.ps1）。
//      macOS：问要不要在 Antigravity 没带参数启动时自动重开（从程序坞打开时总是不带）。
//   6. 问要不要用作者的配色（默认不用）。改配色时要先关 Antigravity，原值记进数据目录的 originals.json。
// 数据目录：~/.gemini/antigravity/plugin_data/agy-zh-pack（插件更新时插件目录会被换掉，数据放在外面）。
// 卸载：删插件目录（Antigravity 一秒内停掉插件）、去掉快捷方式参数、按需恢复配色、问要不要删数据目录。
//
// 测试用：AGY_SETUP_TEST=1 跳过所有进程操作（不关、不开 Antigravity，不停注入程序，不动计划任务和 LaunchAgent）；
// 再设 AGY_SETUP_TEST_RUNNING=1 就假装 Antigravity 正开着。配合临时的 USERPROFILE / HOME / LOCALAPPDATA / APPDATA 在隔离目录里测。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 本程序靠 ELECTRON_RUN_AS_NODE=1 以 Node 模式运行；这个变量会被子进程继承，带着它打开的 Antigravity.exe 也会变成 Node、不出窗口。
// 启动后马上去掉（连同 NODE_OPTIONS 等），后面开的 PowerShell、Antigravity 都用干净的环境。
for (const k of Object.keys(process.env)) if (/^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|NODE_OPTIONS|NODE_PATH)$/i.test(k)) delete process.env[k];

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const PKG = path.dirname(fileURLToPath(import.meta.url)); // 安装包的 app 文件夹（插件文件和 plugin-manifest.json 在这里）
const TEST = process.env.AGY_SETUP_TEST === '1';
const HOME = os.homedir();
const GEMINI = path.join(HOME, '.gemini');
const PLUGIN_DIR = path.join(GEMINI, 'config', 'plugins', 'agy-zh-pack');
const DATA = path.join(GEMINI, 'antigravity', 'plugin_data', 'agy-zh-pack');
const SIDECAR_DATA = path.join(GEMINI, 'antigravity', 'sidecar_data', 'agy-zh-pack');
const CONFIG = path.join(GEMINI, 'config', 'config.json');
const ORIGINALS = path.join(DATA, 'originals.json');
const DEBUG_ARG = '--remote-debugging-port=0';
const LOCAL = process.env.LOCALAPPDATA || '';
const ROAMING = process.env.APPDATA || '';
const AGY_EXE = IS_WIN ? path.join(LOCAL, 'Programs', 'antigravity', 'Antigravity.exe') : '';
const AGY_APP = IS_MAC ? ['/Applications/Antigravity.app', path.join(HOME, 'Applications', 'Antigravity.app')].find((p) => fs.existsSync(p)) || '/Applications/Antigravity.app' : '';
const PORT_FILE = IS_WIN ? path.join(ROAMING, 'Antigravity', 'DevToolsActivePort') : path.join(HOME, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
const APP_STORAGE = path.join(ROAMING, 'Antigravity', 'app_storage.json'); // 只有 Windows 上装过 v1.0.0 才用到
// v1.x 的位置
const LEGACY_WIN = path.join(LOCAL, 'AgyZhPack');
const LEGACY_TASK = 'AgyZhPack';
const LEGACY_STARTUP = path.join(ROAMING, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'agy-zh-pack.vbs');
const LEGACY_PLIST = path.join(HOME, 'Library', 'LaunchAgents', 'com.ncdeng.agy-zh-pack.plist');
const DATA_FILES = ['cost-day.json', 'usage-history.json', 'look.json', 'quota-samples.json', 'originals.json', 'style.css'];

// ---------- 小工具 ----------
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; return 0; };
const say = (s = '') => console.log(s);
const ok = (s) => say('  [完成] ' + s);
const warn = (s) => say('  [注意] ' + s);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8'); };
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
}).then((a) => { if (!process.stdin.isTTY) say(a); return a; });
const closeInput = () => { if (rl) rl.close(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim();
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

// ---------- Antigravity 进程 ----------
const agyInstalled = () => (IS_WIN ? fs.existsSync(AGY_EXE) : IS_MAC ? fs.existsSync(AGY_APP) : false);
// Windows 上本安装程序自己就是 Node 模式的 Antigravity.exe，插件的 sidecar 也是（命令行里带 .mjs），都不能算成 Antigravity。
// 11-22 实测：原来按进程名 + 路径数，把安装程序自己也算进去了——Antigravity 关着也说“正开着”，
// 要关 Antigravity 时还会连自己一起强制结束。现在只认不带 --type=、不带 .mjs、不是本进程的那个主进程。
const WIN_AGY_QUERY = () => `@(Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object { $_.ExecutablePath -eq ${psq(AGY_EXE)} -and $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notmatch '\\.mjs' })`;
const agyRunning = () => {
  if (TEST) return process.env.AGY_SETUP_TEST_RUNNING === '1';
  if (IS_WIN) { try { return ps(`@(${WIN_AGY_QUERY()} | Where-Object { $_.CommandLine -notmatch '--type=' }).Count`) !== '0'; } catch { return false; } }
  return run('pgrep', ['-f', `${AGY_APP}/Contents/MacOS/Antigravity`]) !== null;
};
const closeAgy = async () => {
  if (TEST) return true;
  if (IS_WIN) ps(`${WIN_AGY_QUERY()} | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() } }`);
  else run('osascript', ['-e', `quit app "${AGY_APP}"`]);
  for (let i = 0; i < 16 && agyRunning(); i++) await sleep(500);
  if (agyRunning()) {
    if (IS_WIN) ps(`${WIN_AGY_QUERY()} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
    else run('pkill', ['-f', `${AGY_APP}/Contents/MacOS/Antigravity`]);
    for (let i = 0; i < 10 && agyRunning(); i++) await sleep(500);
  }
  return !agyRunning();
};
const startAgy = (withDebugPort = true) => {
  if (TEST || !agyInstalled()) return;
  // 工作目录设成 Antigravity 自己的目录：不然它继承安装包文件夹，Antigravity 开着时这个文件夹删不掉（11-22 实测）
  if (IS_WIN) spawn(AGY_EXE, withDebugPort ? [DEBUG_ARG] : [], { cwd: path.dirname(AGY_EXE), detached: true, stdio: 'ignore' }).unref();
  else spawn('open', ['-a', AGY_APP, ...(withDebugPort ? ['--args', DEBUG_ARG] : [])], { detached: true, stdio: 'ignore' }).unref();
};
// 调试端口开着没有：只看文件不够（Antigravity 被强制结束时文件会留下来），要真的连一下
const debugPortOpen = () => new Promise((resolve) => {
  let port = 0;
  try { port = Number(fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0]); } catch {}
  if (!port) return resolve(false);
  const sock = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
  sock.once('connect', () => { sock.destroy(); resolve(true); });
  sock.once('timeout', () => { sock.destroy(); resolve(false); });
  sock.once('error', () => resolve(false));
});
const ensureAgyClosed = async (what) => {
  if (!agyRunning()) return false;
  say('');
  say(`  Antigravity 正在运行。要${what}，需要先关闭它。`);
  say('  如果它正在帮你做事，请等它做完再继续。');
  await ask('  准备好了就按回车，我会自动关闭 Antigravity，改好后再帮你打开……');
  if (await closeAgy()) { ok('已关闭 Antigravity'); return true; }
  warn('没能关闭 Antigravity，请手动关掉它' + (IS_WIN ? '（包括右下角托盘里的图标）' : '') + '，再重新运行。');
  process.exit(1);
};

// ---------- 安装包核对：签名 + 每个文件的 sha256 ----------
async function checkPackage() {
  const { verifyManifest } = await import(pathToFileURL(path.join(PKG, 'lib', 'update.mjs')).href);
  const p = verifyManifest(fs.readFileSync(path.join(PKG, 'plugin-manifest.json'), 'utf8'));
  for (const [rel, hash, size] of p.files) {
    const buf = fs.readFileSync(path.join(PKG, rel));
    if (buf.length !== size || crypto.createHash('sha256').update(buf).digest('hex') !== hash) throw Error('安装包里的文件和签名清单对不上：' + rel + '（请重新下载安装包）');
  }
  return p;
}
const installedManifest = () => { try { return JSON.parse(readJson(path.join(PLUGIN_DIR, 'plugin-manifest.json')).payload); } catch { return null; } };

// ---------- 从 v1.x 迁移 ----------
function legacyDataDir() {
  if (IS_WIN) return fs.existsSync(path.join(LEGACY_WIN, 'inject.mjs')) || fs.existsSync(path.join(LEGACY_WIN, 'usage-history.json')) ? LEGACY_WIN : '';
  if (IS_MAC && fs.existsSync(LEGACY_PLIST)) { // 从源码运行的：LaunchAgent 里写着 inject.mjs 的位置
    const m = /<string>([^<]*inject\.mjs)<\/string>/.exec(fs.readFileSync(LEGACY_PLIST, 'utf8'));
    if (m) return path.dirname(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return '';
}
function stopLegacy() {
  let did = false;
  if (IS_WIN) {
    if (!TEST) {
      try { ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like ${psq('*' + LEGACY_WIN + '*inject.mjs*')} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`); } catch {}
      try { if (/removed/.test(ps(`if (Get-ScheduledTask -TaskName ${psq(LEGACY_TASK)} -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName ${psq(LEGACY_TASK)} -Confirm:$false; 'removed' }`))) did = true; } catch {}
    }
    if (fs.existsSync(LEGACY_STARTUP)) { fs.rmSync(LEGACY_STARTUP, { force: true }); did = true; }
  } else if (IS_MAC && fs.existsSync(LEGACY_PLIST)) {
    if (!TEST) {
      const domain = `gui/${process.getuid()}`;
      run('launchctl', ['bootout', domain, LEGACY_PLIST]);
      run('launchctl', ['unload', '-w', LEGACY_PLIST]);
    }
    fs.rmSync(LEGACY_PLIST, { force: true });
    did = true;
  }
  return did;
}
function migrateData(from) {
  const moved = [];
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of DATA_FILES) {
    const src = path.join(from, f), dst = path.join(DATA, f);
    if (!fs.existsSync(src)) continue;
    // 数据目录里可能已经有同名文件（装过 v2、卸载时留了数据、又退回 v1.x 用过一阵）：用修改时间较新的那份，
    // 较旧的那份改名留在数据目录里（例如 usage-history.v1-202611231005.json）。不能只留新的：
    // 退回 v1.x 后重新记的用量记录虽然新，却只有最近几天，更早的天在旧的那份里。
    if (fs.existsSync(dst)) {
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0'); // 本地时间，年月日时分
      const stamp = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes());
      const keepAs = (file, tag) => { try { fs.copyFileSync(file, path.join(DATA, f.replace(/(\.\w+)?$/, `.${tag}-${stamp}$1`))); } catch {} };
      if (fs.statSync(dst).mtimeMs > fs.statSync(src).mtimeMs) { keepAs(src, 'v1'); continue; }
      keepAs(dst, 'v2');
    }
    fs.copyFileSync(src, dst);
    moved.push(f);
  }
  return moved;
}

// ---------- 快捷方式参数（Windows） ----------
const shortcuts = (mode, dir = PLUGIN_DIR) => {
  if (!IS_WIN) return null;
  const script = path.join(dir, 'debug-port.ps1');
  if (!fs.existsSync(script)) return null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], { encoding: 'utf8', windowsHide: true });
    const m = /found=(\d+) changed=(\d+)/.exec(out);
    return m ? { found: +m[1], changed: +m[2] } : null;
  } catch { return null; }
};

// ---------- 作者的配色（可选，默认不用；和 v1.x 一样） ----------
const AUTHOR_THEME = {
  customThemeSeedsLight: { background: '#FAF9F5', foregroundOverride: '#141413', primary: '#D97757' },
  customThemeSeedsDark: { background: '#262624', foregroundOverride: '#FAF9F5', primary: '#D97757' },
};
const SEED_KEYS = ['background', 'foregroundOverride', 'primary'];
const sameSeed = (a, b) => !!a && SEED_KEYS.every((k) => String(a[k] || '').toLowerCase() === b[k].toLowerCase());
const readAgyConfig = () => { try { return readJson(CONFIG); } catch { return null; } };
const themeActive = () => { const u = (readAgyConfig() || {}).userSettings || {}; return Object.entries(AUTHOR_THEME).every(([k, v]) => sameSeed(u[k], v)); };
const readOriginals = () => { const o = fs.existsSync(ORIGINALS) ? readJson(ORIGINALS) : {}; return { appStorage: o.appStorage || {}, userSettings: o.userSettings || {} }; };
const saveOriginals = (o) => { if (!Object.keys(o.appStorage).length && !Object.keys(o.userSettings).length) fs.rmSync(ORIGINALS, { force: true }); else writeJson(ORIGINALS, o); };
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
  say('  浅色主题：背景 #FAF9F5、文字 #141413、强调色 #D97757；深色主题：背景 #262624、文字 #FAF9F5、强调色 #D97757。');
  say('  只改主题颜色，不改缩放、字体和对比度。原来的颜色会记下来，换回或卸载时恢复。换颜色时需要先关闭 Antigravity。');
};
const askTheme = async (current) => {
  const a = await ask(current ? '  现在用的是作者的配色。输入 n 回车=换回原来的颜色，直接回车=保持：' : '  现在用的是你自己的配色（默认）。输入 y 回车=换成作者的配色，直接回车=保持：');
  return current ? !/^n/i.test(a) : /^y/i.test(a);
};
const switchTheme = async (after) => {
  if (after === themeActive()) return { changed: false, reopen: false };
  if (!readAgyConfig()) { warn('没找到 Antigravity 的设置文件 ' + CONFIG + '，配色这次没改。请先打开 Antigravity 登录一次。'); return { changed: false, reopen: false }; }
  const reopen = await ensureAgyClosed('改配色');
  applyTheme(after);
  return { changed: true, reopen };
};

// 插件在 Antigravity 设置里被关掉了：Antigravity 关着时打开它（运行中改设置文件会被它写回）
function pluginDisabled() { const c = readAgyConfig(); return !!(c && c.plugins && c.plugins['agy-zh-pack'] && c.plugins['agy-zh-pack'].enabled === false); }

// ---------- 安装 ----------
async function install() {
  say('');
  say('  ===== agy-zh（Antigravity 中文插件）：安装 =====');
  say('');
  if (!agyInstalled()) {
    warn('没找到 Antigravity：' + (IS_WIN ? AGY_EXE : AGY_APP));
    warn('请先安装 Antigravity 并登录一次，再运行本安装程序。');
    process.exit(1);
  }
  const p = await checkPackage();
  ok(`安装包核对通过：v${p.version}，作者签名正确，${p.files.length} 个文件完整`);

  // 1. Antigravity 开着但没带调试端口：先关掉，装完带参数打开
  let reopen = false;
  if (agyRunning() && !(await debugPortOpen())) {
    say('');
    say('  Antigravity 正开着，但这次启动时没带调试端口参数（Antigravity 2.33.0 起需要），要重新打开一次才会变成中文。');
    say('  如果它正在帮你做事，请等它做完再继续。');
    const a = await ask('  直接回车=我来关闭、装完再带参数打开，输入 n=跳过（装完会弹框问你要不要重开）：');
    if (!/^n/i.test(a)) {
      if (await closeAgy()) { ok('已关闭 Antigravity'); reopen = true; }
      else warn('没能关闭 Antigravity，装完后请手动重新打开。');
    }
  }

  // 2. 从 v1.x 迁移
  const legacy = legacyDataDir();
  if (stopLegacy() || legacy) ok('已停掉旧版的注入程序和开机自启');
  if (legacy) {
    const moved = migrateData(legacy);
    if (moved.length) ok('旧版的数据已搬到 ' + DATA + '：' + moved.join('、'));
    if (IS_WIN && legacy === LEGACY_WIN) {
      for (let i = 0; fs.existsSync(LEGACY_WIN); i++) {
        try { fs.rmSync(LEGACY_WIN, { recursive: true, force: true }); } catch { if (i >= 10) { warn('旧版的安装目录没删干净：' + LEGACY_WIN); break; } await sleep(500); }
      }
      if (!fs.existsSync(LEGACY_WIN)) ok('已删除旧版的安装目录 ' + LEGACY_WIN);
    }
    if (IS_MAC) say('  旧版的源码文件夹 ' + legacy + ' 没动，确认插件正常后可以自己删掉。');
  }

  // 3. 复制插件文件（Antigravity 几秒内会自动发现并启动它）
  const old = installedManifest();
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  for (const [rel] of p.files) {
    const dst = path.join(PLUGIN_DIR, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(PKG, rel), dst + '.agy-new');
    fs.renameSync(dst + '.agy-new', dst);
  }
  if (old) { const keep = new Set(p.files.map((f) => f[0])); for (const [rel] of old.files) if (!keep.has(rel)) fs.rmSync(path.join(PLUGIN_DIR, rel), { force: true }); }
  fs.copyFileSync(path.join(PKG, 'plugin-manifest.json'), path.join(PLUGIN_DIR, 'plugin-manifest.json'));
  fs.mkdirSync(DATA, { recursive: true });
  ok((!old ? '插件已安装' : old.version === p.version ? `已重新安装 v${p.version}` : cmpVer(old.version, p.version) > 0 ? `已从 v${old.version} 换回 v${p.version}` : `已从 v${old.version} 升级到 v${p.version}`) + '：' + PLUGIN_DIR);
  if (pluginDisabled()) {
    if (!agyRunning()) { const c = readAgyConfig(); c.plugins['agy-zh-pack'].enabled = true; writeJson(CONFIG, c); ok('插件之前在 Antigravity 里被关掉了，已重新打开'); }
    else warn('插件之前在 Antigravity 里被关掉了：请到 Antigravity 设置的“插件”里把“agy-zh”打开。');
  }

  // 4. 调试端口参数
  if (IS_WIN) {
    const sc = shortcuts('add');
    if (!sc) warn('没能给快捷方式加启动参数。请手动给 Antigravity 的快捷方式加上参数 ' + DEBUG_ARG + '。');
    else if (!sc.found) warn('没找到 Antigravity 的开始菜单或桌面快捷方式。Antigravity 要带参数 ' + DEBUG_ARG + ' 启动，界面才会变成中文。');
    else if (sc.changed === 0) ok(`${sc.found} 个 Antigravity 快捷方式原来就带启动参数 ${DEBUG_ARG}，没有改动`);
    else ok(`已给 ${sc.changed} 个 Antigravity 快捷方式加上启动参数 ${DEBUG_ARG}` + (sc.changed < sc.found ? `（另外 ${sc.found - sc.changed} 个原来就有）` : ''));
  } else if (IS_MAC) {
    say('');
    say('  macOS 从程序坞或启动台打开 Antigravity 时不带调试端口参数，界面会是英文。插件发现后可以帮你关掉再带参数重开。');
    const a = await ask('  直接回车=以后自动重开（推荐），输入 n=每次先问我：');
    const file = path.join(DATA, 'settings.json');
    const s = fs.existsSync(file) ? readJson(file) : {};
    s.relaunch = /^n/i.test(a) ? 'ask' : 'auto';
    writeJson(file, s);
    ok(s.relaunch === 'auto' ? '已设为自动重开（侧边栏面板里可以改）' : '已设为每次先问（侧边栏面板里可以改）');
  }

  // 5. 配色
  say('');
  sayThemeInfo();
  const th = await switchTheme(await askTheme(themeActive()));
  ok(th.changed ? (themeActive() ? '已换成作者的配色' : '已换回原来的配色') : (themeActive() ? '配色保持不变（作者的配色）' : '配色保持不变（你自己的）'));
  reopen = reopen || th.reopen;

  // 6. 打开 Antigravity
  const running = agyRunning();
  if (!running) { startAgy(); ok('正在打开 Antigravity（带调试端口参数）'); }
  say('');
  say('  安装完成！');
  if (running && (await debugPortOpen())) {
    say('  Antigravity 正开着：几秒内插件会启动，界面变成中文；输入框上方的用量信息在刷新窗口（' + (IS_MAC ? 'Cmd' : 'Ctrl') + '+R）后出现。');
  } else if (running) {
    say('  Antigravity 还开着、没带调试端口参数：插件启动后会弹框问你要不要重开。');
  } else {
    say('  Antigravity 打开后几秒内会变成中文界面，输入框上方会出现用量信息。');
  }
  say('  插件的面板：Antigravity 右上角的“插件”菜单 → agy-zh（运行状态、在线更新、版本更新）。');
  say('  以后有新版本，在面板里点“更新”就行（装之前校验作者签名），不用再下载安装包。');
  say('  请保留这个文件夹：以后卸载、切换配色要用里面的脚本。');
  say('');
}

// ---------- 卸载 ----------
async function uninstall() {
  say('');
  say('  ===== agy-zh（Antigravity 中文插件）：卸载 =====');
  say('');
  // 快捷方式参数要在删插件目录之前去掉（脚本在里面；装包里也有一份）
  const sc = shortcuts('remove', fs.existsSync(path.join(PLUGIN_DIR, 'debug-port.ps1')) ? PLUGIN_DIR : PKG);
  if (sc && sc.changed) ok(`已去掉 ${sc.changed} 个快捷方式上的启动参数 ${DEBUG_ARG}`);
  if (fs.existsSync(PLUGIN_DIR)) {
    for (let i = 0; fs.existsSync(PLUGIN_DIR); i++) {
      try { fs.rmSync(PLUGIN_DIR, { recursive: true, force: true }); } catch { if (i >= 10) { warn('插件目录没删干净（有程序还占着它）：' + PLUGIN_DIR); warn('插件已经停用。请关掉 Antigravity 后手动删掉这个文件夹。'); break; } await sleep(500); }
    }
    if (!fs.existsSync(PLUGIN_DIR)) ok('已删除插件（Antigravity 会在一秒内停掉它）');
  }
  if (stopLegacy()) ok('已删掉旧版的开机自启');
  if (fs.existsSync(path.join(LEGACY_WIN, 'inject.mjs'))) { try { fs.rmSync(LEGACY_WIN, { recursive: true, force: true }); ok('已删除旧版的安装目录'); } catch {} }

  let reopen = false;
  if (fs.existsSync(ORIGINALS)) {
    const o = readOriginals();
    const what = [Object.keys(o.appStorage).length && '缩放、对比度、字体', Object.keys(o.userSettings).length && '配色'].filter(Boolean).join('和');
    say(`  本插件改过 Antigravity 的${what}，原来的样子记下来了。`);
    const a = await ask('  要恢复成原来的样子吗？直接回车=恢复，输入 n=保留现在的样子：');
    if (!/^n/i.test(a)) {
      reopen = await ensureAgyClosed('恢复' + what);
      if (fs.existsSync(APP_STORAGE)) {
        const store = readJson(APP_STORAGE);
        for (const [k, v] of Object.entries(o.appStorage)) { if (v === null) delete store[k]; else store[k] = v; }
        writeJson(APP_STORAGE, store);
      }
      const cfg = readAgyConfig();
      if (cfg) {
        cfg.userSettings = cfg.userSettings || {};
        for (const [k, v] of Object.entries(o.userSettings)) { if (v === null) delete cfg.userSettings[k]; else cfg.userSettings[k] = v; }
        writeJson(CONFIG, cfg);
      }
      fs.rmSync(ORIGINALS, { force: true });
      ok(what + '已恢复');
    }
  }
  // Antigravity 在设置文件里给插件记的条目（关着时才删，运行中改会被它写回）
  if (!agyRunning()) {
    const cfg = readAgyConfig();
    if (cfg && ((cfg.sidecars && cfg.sidecars['agy-zh-pack/core']) || (cfg.plugins && cfg.plugins['agy-zh-pack']))) {
      if (cfg.sidecars) delete cfg.sidecars['agy-zh-pack/core'];
      if (cfg.plugins) delete cfg.plugins['agy-zh-pack'];
      writeJson(CONFIG, cfg);
    }
  }
  if (fs.existsSync(DATA)) {
    // 选了“不恢复原来的样子”时 originals.json 还在里面：删掉就找不回用户原来的配色了，单独点明
    const a = await ask('  要连每天的用量记录和设置一起删掉吗？' +
      (fs.existsSync(ORIGINALS) ? '里面还有记下来的 Antigravity 外观原值（配色等），删掉就找不回来了。' : '') +
      '直接回车=删掉，输入 n=保留（以后重装还能接着用）：');
    if (!/^n/i.test(a)) { fs.rmSync(DATA, { recursive: true, force: true }); ok('已删除数据目录 ' + DATA); }
    else ok('数据目录保留：' + DATA);
  }
  fs.rmSync(SIDECAR_DATA, { recursive: true, force: true });
  if (reopen) { startAgy(false); ok('正在重新打开 Antigravity'); }
  say('');
  say('  卸载完成。如果 Antigravity 还开着，刷新一下窗口（' + (IS_MAC ? 'Cmd' : 'Ctrl') + '+R）就会变回英文界面。');
  say('');
}

// ---------- 配色开关 ----------
async function theme() {
  say('');
  say('  ===== agy-zh（Antigravity 中文插件）：配色开关 =====');
  say('');
  sayThemeInfo();
  say('');
  const want = await askTheme(themeActive());
  const th = await switchTheme(want);
  ok(th.changed ? (want ? '已换成作者的配色' : '已换回原来的配色') : '没有改动：' + (themeActive() ? '仍然是作者的配色' : '仍然是你自己的配色'));
  if (th.reopen) { startAgy(); ok('正在重新打开 Antigravity'); }
  say('');
}

const cmd = process.argv[2];
const actions = { install, uninstall, theme };
(actions[cmd] ? actions[cmd]() : Promise.reject(new Error('用法：setup.mjs install|uninstall|theme')))
  .catch((e) => { say(''); warn('出错了：' + (e && e.message)); say('  请截图保存这个窗口，反馈问题时附上。'); process.exitCode = 1; })
  .finally(closeInput);
