// Antigravity 桌面版注入器：
//   - 样式（可选）：同目录有 style.css 才注入，没有就不改任何样式。公开的安装包不带 style.css；
//   - 汉化：界面英文换成中文（i18n\ 下的 translator.js + zh-CN.json 词典 + zh-CN.rules.json 规则）；
//   - 状态栏：输入框上方显示模型、上下文、token、首字时间、速度、额度（statusbar.js）。
//   （2026-11-09～11-20 还有一个可选的“解锁 512K 上下文”，读同目录 config.json 的 contextLimit。
//    11-20 实测官方默认已经提高，这个功能删掉了；旧版留下的 config.json 不再读取。）
//
// 原理：Antigravity 主进程打开 Chromium 远程调试端口（端口号写在 %APPDATA%\Antigravity\DevToolsActivePort）。
// 2.33.0 以前它总会打开；2.33.0 起只有带 --remote-debugging-port 启动才打开，所以要给快捷方式加这个参数
// （同目录 debug-port.ps1，见下面“调试端口参数”）。本脚本常驻后台，每 3 秒检查一次：
//   - 发现主窗口页面后连上去，用 Page.addScriptToEvaluateOnNewDocument 登记注入脚本
//     （刷新、跳转都会自动重新加样式），并立刻在当前页面加上样式；
//   - style.css、statusbar.js 或 i18n\ 下的文件改动后，自动更新所有已连接的窗口；
//   - 窗口关闭或应用退出后连接自然断开，下次启动再连。
//   - 连上一个刚打开、但状态栏晚到的窗口时，自动刷新一次（见 maybeReload）。
// 不修改 Antigravity 的安装文件，应用自动更新后仍然有效。
//
// 运行：node inject.mjs（常驻后台；已有一个在跑时，新启动的会自动退出）。
// 开机自启：一键安装包会建计划任务 AgyZhPack，登录时立刻运行安装目录里的 agy-zh-pack.vbs（见 package\app\setup.mjs）。
//   不放“启动”文件夹，因为 Windows 会把那里的程序排队延后，开机后约 7 分钟才跑。
// 停用：删掉计划任务（或“启动”文件夹里的 .vbs），并在任务管理器里结束运行 inject.mjs 的 node.exe。
//
// 插件模式（v2.0 起的安装方式）：Antigravity 插件 agy-zh-pack 的 sidecar（sidecars/core/main.mjs）设好环境变量后 import 本脚本，
//   由 Antigravity 的后台负责启停（Antigravity 开着才运行，退出后约 1～2 秒自动拉起），不再用计划任务 / LaunchAgent。
//   - AGY_ZH_PLUGIN=1；AGY_ZH_DATA_DIR = 数据目录（~/.gemini/antigravity/plugin_data/agy-zh-pack）。
//     插件目录更新时会整个换掉，所以账本、历史、外观、在线数据、日志、style.css 都放数据目录；不设就和本脚本同目录（源码运行、v1.x）。
//   - 端口文件取 Antigravity 给 sidecar 的 AGY_BROWSER_ACTIVE_PORT_FILE。
//   - 已经有一个注入程序在跑（比如还没卸载的 v1.x）：不退出（退出会被反复拉起），待命，每 20 秒再试一次。
//   - 没带调试端口启动时不弹通知，由 sidecar 弹框问要不要重开（lib/relaunch.mjs）；Windows 上照旧检查快捷方式参数。
//   - globalThis.__agyZh：交给 sidecar 的状态和操作（侧边栏面板、更新用），见文件末尾。
//
// 测试用环境变量：AGY_PORT_FILE（端口文件路径）、AGY_URL_PREFIX（要注入的页面地址前缀）。

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chooseSource } from './lib/remote-source.mjs';
import { r4, samePeriod, noteQuota, noteResetEvent, replayFromSamples } from './lib/quota.mjs';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = process.env.AGY_ZH_PLUGIN === '1';
const DATA = process.env.AGY_ZH_DATA_DIR || DIR; // 数据目录（见文件开头“插件模式”）
try { fs.mkdirSync(DATA, { recursive: true }); } catch {}
const CSS_FILE = path.join(DATA, 'style.css');
const LOG_FILE = path.join(DATA, 'inject.log');
const DEFAULT_PORT_FILE = IS_WIN
  ? path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort')
  : IS_MAC
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Antigravity', 'DevToolsActivePort');
const PORT_FILE = process.env.AGY_PORT_FILE || process.env.AGY_BROWSER_ACTIVE_PORT_FILE || DEFAULT_PORT_FILE;
const URL_PREFIX = process.env.AGY_URL_PREFIX || 'https://127.0.0.1:';
const PIPE_UID = typeof process.getuid === 'function' ? process.getuid() : 'user';
const PIPE = IS_WIN
  ? '\\\\.\\pipe\\agy-claude-style' + (process.env.AGY_PORT_FILE ? '-test' : '')
  : path.join('/tmp', `agy-zh-pack-${PIPE_UID}${process.env.AGY_PORT_FILE ? '-test' : ''}.sock`);
const POLL_MS = 3000;
const STYLE_ID = 'agy-claude-style';

// ---------- 日志（超过 200 KB 就清空重写） ----------
try { if (fs.statSync(LOG_FILE).size > 200 * 1024) fs.writeFileSync(LOG_FILE, ''); } catch {}
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

// ---------- 读写数据文件（2026-11-24 加） ----------
// 写：先写同目录的临时文件再改名替换，写到一半被结束（关 Antigravity、插件重启）也不会留下半个文件。
//   改名失败（Windows 上文件正被别的程序打开，比如杀毒软件在扫）就退回直接覆盖。
// 读：文件存在但不是合法的 JSON 时，先改名留底（<名字>.bad-年月日时分.json）再当没有文件处理，
//   免得下一次保存把它覆盖掉、连查原因的线索都没了。11-24 发现 Windows 的 quota-samples.json 丢了
//   11-22 23:00～11-24 00:12 的记录，当时直接覆盖写、读不出来就从空开始，原因没查清。
function writeFileSafe(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return;
  } catch {}
  try { fs.rmSync(tmp, { force: true }); } catch {}
  fs.writeFileSync(file, text);
}
function readJsonKeep(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { // 去掉 UTF-8 BOM
    const d = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const bad = `${file.replace(/\.json$/, '')}.bad-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}.json`;
    try { fs.renameSync(file, bad); log(`${path.basename(file)} unreadable (${e.message}), kept as ${path.basename(bad)}`); }
    catch (e2) { log(`${path.basename(file)} unreadable (${e.message}), could not keep it: ${e2.message}`); }
    return null;
  }
}

// ---------- 单实例：占用命名管道（Windows）或 Unix Socket（macOS/Linux），占不到说明已有实例在跑 ----------
const lock = net.createServer();
let lockHeld = false;
let lockServer = null; // 实际占着锁的 server
function onListening() {
  lockHeld = true;
  log(`started pid=${process.pid} platform=${process.platform} v${PACK_VERSION}` + (PLUGIN ? ' (plugin)' : ''));
  if (!IS_WIN) {
    const cleanup = () => {
      try { if (lockServer) lockServer.close(); } catch {}
      try { fs.rmSync(PIPE, { force: true }); } catch {}
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
  main();
}
// 插件模式拿锁：拿到就开始工作；已有注入程序在跑（比如还没卸载的 v1.x）就待命再试：头 30 秒每 2 秒试一次，以后每 20 秒。
// 头 30 秒试得勤，是因为 Antigravity 重启 sidecar（改了 sidecar.json、插件更新）时会先拉起新的、再结束旧的，
// 新的启动时锁还在旧的手里（11-22 Windows 实测），原来要等 20 秒才接上。
// 不能退出：Antigravity 会把退出的 sidecar 反复拉起。macOS / Linux 上套接字文件还在但没人听（上次没清掉）就删掉重来。
let standbyLogged = false;
const acquireStart = Date.now();
function acquire() {
  const l = net.createServer();
  const retry = () => {
    if (!standbyLogged) { standbyLogged = true; log(`another injector is running, standing by (pid=${process.pid})`); }
    setTimeout(acquire, Date.now() - acquireStart < 30000 ? 2000 : 20000);
  };
  l.on('error', (err) => {
    l.close();
    if (IS_WIN || err.code !== 'EADDRINUSE') { retry(); return; }
    const probe = net.createConnection(PIPE);
    probe.once('connect', () => { probe.destroy(); retry(); });
    probe.once('error', () => { try { fs.rmSync(PIPE, { force: true }); } catch {} setTimeout(acquire, 1000); });
  });
  l.listen(PIPE, () => { lockServer = l; onListening(); });
}
if (PLUGIN) {
  acquire();
} else if (IS_WIN) {
  lock.on('error', () => process.exit(0));
  lock.listen(PIPE, () => { lockServer = lock; onListening(); });
} else {
  let retried = false;
  lock.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !retried) {
      retried = true;
      const probe = net.createConnection(PIPE);
      probe.once('connect', () => { probe.destroy(); process.exit(0); });
      probe.once('error', (pe) => {
        if (pe.code === 'ECONNREFUSED' || pe.code === 'ENOENT') {
          try { fs.rmSync(PIPE, { force: true }); } catch {}
          lock.listen(PIPE, () => { lockServer = lock; onListening(); });
        } else {
          process.exit(0);
        }
      });
      return;
    }
    process.exit(0);
  });
  lock.listen(PIPE, () => { lockServer = lock; onListening(); });
}

// ---------- 要注入的文件：样式 + 汉化（词典、规则、翻译器） ----------
// 删掉或改名 i18n\zh-CN.json 就关闭汉化（已打开的窗口刷新后恢复英文）。
const FILES = {
  css: CSS_FILE,
  dict: path.join(DIR, 'i18n', 'zh-CN.json'),
  rules: path.join(DIR, 'i18n', 'zh-CN.rules.json'),
  translator: path.join(DIR, 'i18n', 'translator.js'),
  statusbar: path.join(DIR, 'statusbar.js'),
};
const JSON_KEYS = new Set(['dict', 'rules']);
const assets = { css: '', dict: null, rules: [], translator: '', statusbar: '' };
const EMPTY = { dict: null, rules: [] };

// 传给状态栏的参数。costDay：今天花费的账本（见下面“今天花费的账本”）；history：最近 31 天的用量（见“每天用量历史”）。
function barConfig() {
  return { costDay: readCostBook(), history: recentHistory(), look: readLook(), remote: remoteForPage() };
}

// ---------- 状态栏外观（2026-11-22 加） ----------
// look.json：{ pal 配色, skin 外形, bar 进度条, dense 信息密度, icons 图标整套（v1.5 是 true / false，v1.6 起是 material / outline / unicode / off）,
//   iconMap 每一项单独选的图标（v1.6 加）, at 选择时间 }。
// 用户在每日用量面板的 Theme 页里选，页面记在 window.__agyStats.lookPick（页面的本地存储按端口分开，每次启动都换端口，存不住）；
// 注入程序每 30 秒读回来存进这个文件，再推给其他窗口（S.setLook(look, true)）；新注入时通过 CFG.look 交给状态栏。
// 选项的取值由状态栏校验（cleanLook），这里只挑出这几个字段、限制长度。
const LOOK_FILE = path.join(DATA, 'look.json');
let lookCache;
function readLook() {
  if (lookCache === undefined) {
    lookCache = readJsonKeep(LOOK_FILE);
  }
  return lookCache;
}
function saveLook(pick) {
  const keep = {};
  for (const k of ['pal', 'skin', 'bar', 'dense', 'online']) if (typeof pick[k] === 'string') keep[k] = pick[k].slice(0, 24);
  if (typeof pick.icons === 'boolean' || typeof pick.icons === 'string') keep.icons = typeof pick.icons === 'string' ? pick.icons.slice(0, 24) : pick.icons;
  // v1.6：每一项单独选的图标 { 项目名: 图标名 }，最多 16 项
  if (pick.iconMap && typeof pick.iconMap === 'object') {
    keep.iconMap = {};
    for (const [k, v] of Object.entries(pick.iconMap).slice(0, 16)) if (typeof v === 'string') keep.iconMap[String(k).slice(0, 24)] = v.slice(0, 32);
  }
  keep.at = +pick.at || Date.now();
  lookCache = keep;
  try { writeFileSafe(LOOK_FILE, JSON.stringify(keep)); log(`look saved: ${keep.pal} / ${keep.skin} / ${keep.bar} / ${keep.dense}`); }
  catch (e) { log(`write look.json failed: ${e.message}`); }
}

// ---------- 今天花费的账本（2026-11-16 加） ----------
// 状态栏把每个对话今天的花费记在页面的 window.__agyStats.costBook（{ day, by: { 对话 ID: 美元 } }）。
// 页面的本地存储按端口分开，Antigravity 每次启动都换端口，存在页面里的账本会丢；后台重启后对话摘要里也只剩打开过的对话。
// 所以注入程序每 30 秒把页面里的账本读出来，合并进同目录的 cost-day.json（同一个对话取较大的数，换了一天就清空），
// 注入时再交给状态栏。只存对话 ID、金额和按模型的调用数、token 数（det，2026-11-20 加）。
const COST_FILE = path.join(DATA, 'cost-day.json');
const COST_SYNC_MS = 30000;
const dayName = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
let costBook = null;
function readCostBook() {
  if (!costBook) {
    costBook = readJsonKeep(COST_FILE);
  }
  if (!costBook || costBook.day !== dayName() || !costBook.by || typeof costBook.by !== 'object') costBook = { day: dayName(), by: {}, det: {} };
  if (!costBook.det || typeof costBook.det !== 'object') costBook.det = {};
  return costBook;
}
// det[对话 ID] = { 价目名: [美元, 调用数, 输入, 缓存读, 缓存写, 输出] }；同一个对话取调用数较多的那份
const detCalls = (d) => { let n = 0; for (const k in d || {}) n += +(d[k] && d[k][1]) || 0; return n; };
const validDet = (d) => !!d && typeof d === 'object' && !Array.isArray(d) && Object.entries(d).every(([k, r]) =>
  k.length <= 40 && Array.isArray(r) && r.length === 6 && r.every((x) => Number.isFinite(+x) && +x >= 0));
function mergeCostBook(b) {
  const book = readCostBook();
  if (!b || b.day !== book.day || !b.by || typeof b.by !== 'object') return;
  let changed = false;
  for (const [id, v] of Object.entries(b.by)) {
    const n = Number(v);
    if (!/^[0-9a-f-]{36}$/.test(id) || !(n >= 0) || book.by[id] >= n) continue;
    book.by[id] = n;
    changed = true;
  }
  if (b.det && typeof b.det === 'object') {
    for (const [id, d] of Object.entries(b.det)) {
      if (!/^[0-9a-f-]{36}$/.test(id) || !validDet(d)) continue;
      if (book.det[id] && detCalls(d) < detCalls(book.det[id])) continue;
      if (JSON.stringify(book.det[id]) === JSON.stringify(d)) continue;
      book.det[id] = d;
      changed = true;
    }
  }
  if (!changed) return;
  try { writeFileSafe(COST_FILE, JSON.stringify(book)); } catch (e) { log(`write cost-day.json failed: ${e.message}`); }
}
// 今天动过的对话：Antigravity 把每个对话存在 %USERPROFILE%\.gemini\antigravity\brain\<对话 ID>\，
// 对话记录 .system_generated\logs\transcript.jsonl 的修改时间在本地 0 点以后，就算今天动过。
// 交给状态栏（window.__agyStats.todayIds），它会向本机后台查这些对话的调用记录（后台没加载的会顺便加载，
// 加载不改对话的修改时间）。这样 Antigravity 重启后，今天早些时候的对话也能算进来。
const BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function todayConversations() {
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  let names = [];
  try { names = fs.readdirSync(BRAIN_DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!UUID_RE.test(n)) continue;
    let m = 0;
    try { m = fs.statSync(path.join(BRAIN_DIR, n, '.system_generated', 'logs', 'transcript.jsonl')).mtimeMs; } catch {}
    if (m >= d0.getTime()) out.push(n);
  }
  return out;
}
// 本机对话库文件清单（2026-11-22 加，v1.6，调用明细页用）：[[对话 ID, 创建时间毫秒, 最后修改毫秒], …]，只给最近 32 天改过的。
// 后台的对话摘要（GetAllCascadeTrajectories）只列一部分对话（11-22 实测：摘要 21 个，本机库文件 79 个），
// 没列出的对话按 ID 照样能取到调用记录，所以把文件清单交给页面，明细页按创建 / 修改时间挑出某一天动过的对话。
// 只读文件名和时间，不打开文件。60 秒内重复要就用上次的结果。
let convFilesCache = null, convFilesAt = 0;
function convFiles() {
  if (convFilesCache && Date.now() - convFilesAt < 60000) return convFilesCache;
  const out = [];
  const cut = Date.now() - 32 * 86400e3;
  let names = [];
  try { names = fs.readdirSync(CONV_DIR); } catch {}
  for (const f of names) {
    if (!f.endsWith('.db') || !UUID_RE.test(f.slice(0, -3))) continue;
    try {
      const st = fs.statSync(path.join(CONV_DIR, f));
      if (st.mtimeMs < cut) continue;
      out.push([f.slice(0, -3), Math.round(st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs), Math.round(st.mtimeMs)]);
    } catch {}
  }
  convFilesCache = out; convFilesAt = Date.now();
  return out;
}
let costSyncAt = 0;
// 每次同步：交给页面今天动过的对话和最近 31 天的历史，读回页面的账本和额度，再更新历史
const QUOTA_EXPR = `S.quota && Array.isArray(S.quota.groups) ? { at: S.quota.at, acct: S.account || null, buckets: S.quota.groups.flatMap((g) => (g.buckets || []).map((b) =>
  ({ id: b.bucketId, w: b.window, rf: b.remainingFraction, reset: b.resetTime, dis: b.disabled, name: g.displayName }))) } : null`;
async function syncCost() {
  const ids = JSON.stringify(todayConversations());
  const hist = JSON.stringify(recentHistory());
  const files = JSON.stringify(convFiles());
  const look = readLook();
  const lookJs = JSON.stringify(look);
  let quota = null;
  let pick = null;
  let any = false;
  for (const s of sessions.values()) {
    try {
      const r = await s.send('Runtime.evaluate', {
        expression: `(() => { const S = window.__agyStats; if (!S) return null; S.todayIds = ${ids}; S.history = ${hist}; S.convFiles = ${files};
          if (S.setLook && ${lookJs}) S.setLook(${lookJs}, true);
          const want = S.panelView === 'calls' && document.querySelector('.agy-usage-panel') ? S.cliWant || null : null;
          return JSON.stringify({ book: S.costBook || null, quota: ${QUOTA_EXPR}, pick: S.lookPick || null, want }); })()`,
        returnByValue: true,
      });
      const v = r && r.result && r.result.value;
      if (!v) continue;
      const o = JSON.parse(v);
      any = true;
      // 开着调用明细页：顺带把那天 CLI 的调用再交一次（__agyZhAsk 加不上时靠这个；今天的明细也借此每 30 秒更新）
      if (o.want) onPageAsk(s, JSON.stringify({ t: 'cli-calls', day: o.want })).catch(() => {});
      if (o.book) mergeCostBook(o.book);
      if (o.quota && (!quota || o.quota.at > quota.at)) quota = o.quota;
      if (o.pick && o.pick.at > 0 && (!pick || o.pick.at > pick.at)) pick = o.pick;
    } catch { /* 窗口刚关或还没注入：下次再读 */ }
  }
  if (any) updateHistory(readCostBook(), quotaBuckets(quota), quotaAcct(quota), quota && quota.at);
  // 某个窗口里换了外观：存下来，马上推给其他窗口，并更新登记给刷新后页面的脚本（见 reRegister）
  if (pick && pick.at > ((look && look.at) || 0)) {
    const wasOn = onlineOn();
    saveLook(pick);
    const nowOn = onlineOn();
    if (wasOn !== nowOn) { // 在线更新开关变了：自带词典 / 合并词典换一下，状态栏的在线价格也跟着换
      log(`online updates ${nowOn ? 'on' : 'off'}`);
      mergedCache = null;
      if (nowOn) remoteNextAt = Date.now() + 3000;
      for (const s of sessions.values()) apply(s).catch(() => {});
      return;
    }
    const js = JSON.stringify(readLook());
    for (const s of sessions.values()) {
      try {
        await s.send('Runtime.evaluate', { expression: `window.__agyStats && window.__agyStats.setLook && window.__agyStats.setLook(${js}, true)` });
        await reRegister(s);
      } catch {}
    }
  }
}

// ---------- 每天用量历史（2026-11-20 加） ----------
// usage-history.json：{ v: 3, days: { 'YYYY-MM-DD': { usd, convs, models, quota, qa } }, accts, cur }，保留 HISTORY_KEEP_DAYS 天（11-24 起 400 天，以前 90 天），只存数字，不存对话内容。
//   v3（2026-11-22，v1.6）：额度按账号分开记在 qa：{ 账号键: { 桶 ID: 额度记录 } }；账号键是邮箱的哈希（不存邮箱原文），
//   accts：{ 账号键: { m 打码的邮箱, t 套餐名, first / last 第一次 / 最近一次见到的日子 } }，cur：最近一次见到的账号。
//   quota 留着 v3 以前的记录（不知道是哪个账号的）；第一次见到某个账号时，重置时间对得上的旧记录归给它（见 adoptLegacy）。
//   钱和 token 不分账号（是这台电脑上的花费）。
//   models：{ 价目名: [美元, 调用数, 输入, 缓存读, 缓存写, 输出] }，由当天账本的 det 合计而来；
//   qa 里每个桶的额度记录见 lib/quota.mjs 开头（u = 当天用掉的，按周期分段算净变化）。
//   resets（2026-11-24 加）：谷歌提前重置每周额度的事件，[{ k 账号键, id 桶 ID, n 组名, w, at, after, from, was, flips }]，见 lib/quota.mjs 的 noteResetEvent。
//   qr（2026-11-24 加）：1 = 已经用细粒度采样把额度记录按分段算法回放过一次。
// 状态栏的每日用量面板显示 u。（v1.4.0 的格式是 f 起点 / a 已累计，u = a + l − f；见 migrateQuota。）
const HISTORY_FILE = path.join(DATA, 'usage-history.json');
const HISTORY_KEEP_DAYS = 400; // 2026-11-24：90 → 400 天（面板加了 all；每天只有几个数字，400 天约几百 KB）
const HISTORY_PUSH_DAYS = 31;
let history = null;
let historyJson = '';
function readHistory() {
  if (!history) {
    history = readJsonKeep(HISTORY_FILE);
    if (!history || !history.days || typeof history.days !== 'object') history = { v: 2, days: {} };
    historyJson = JSON.stringify(history);
    // liveFrom：从哪一天起是注入程序实时记的；更早的天数只能补算（见下面“补算以前的用量”）
    if (!history.liveFrom) history.liveFrom = Object.keys(history.days).filter((k) => !history.days[k].bf).sort()[0] || dayName();
    if (!(history.v >= 2)) migrateHistory(history); // 换算后下次 saveHistory 会写回文件
    // 2026-11-24：额度记录改成分段算（见 lib/quota.mjs）。采样覆盖整天的日子按新算法重算一次，顺带补出提前重置事件
    if (!(history.qr >= 1)) {
      const h = history;
      try {
        const ch = replayFromSamples(h.days, readSamples().a, (day, key, id) => prevQuotaOf(h, day, key, id), dayOf,
          (day) => new Date(day + 'T00:00:00').getTime(), (key, b, at, ev) => noteReset(h, key, b, at, ev));
        log(`usage history: quota records replayed from samples${ch.length ? ': ' + ch.join(', ') : ', no change'}`);
      } catch (e) { log(`usage history: quota replay failed: ${e.message}`); }
      h.qr = 1;
    }
  }
  return history;
}
// 记一次提前重置（只记每周额度；读数来回跳时同一次重置只记一条），太旧的删掉
function noteReset(h, key, b, at, ev) {
  const list = h.resets || (h.resets = []);
  const e = noteResetEvent(list, key, b, at, ev);
  if (e) {
    const t = (ms) => (ms ? new Date(ms).toISOString() : '?');
    log(`quota reset early: ${b.id} at ${t(e.at)} (last seen old period ${t(e.after)}), was ${(e.from * 100).toFixed(2)}% used, planned reset ${t(e.was)}`);
  }
  const cut = Date.now() - HISTORY_KEEP_DAYS * 86400e3;
  while (list.length && list[0].at < cut) list.shift();
}
// v1 → v2（2026-11-22）：额度记录换成按净变化算（见 noteQuota）。
// 每周额度按天重算：和前一条记录在同一个周期里，u = 当天最后的值 − 前一条的最后值；换了周期，u = 当天最后的值。
// 5 小时额度一天会换好几个周期，记录里只剩最后一个周期的值，没法重算，保持原来的 u（面板也不显示它）。
function migrateHistory(h) {
  const last = {};
  for (const k of Object.keys(h.days).sort()) {
    const qs = h.days[k] && h.days[k].quota;
    if (!qs || typeof qs !== 'object') continue;
    for (const [id, q] of Object.entries(qs)) {
      if (!q || typeof q !== 'object') continue;
      if (q.u === undefined) { q.u = r4(migrateQuota(q)); delete q.f; delete q.a; }
      const p = last[id];
      const l = +q.l || 0;
      if (q.w === 'weekly' && p) {
        q.s = samePeriod(p.r, q.r) ? +p.l || 0 : 0;
        q.c = 0;
        q.u = r4(Math.max(0, l - q.s));
      } else {
        q.s = r4(Math.max(0, l - (+q.u || 0))); // 保持原来的 u：u = c + (l − s)
        q.c = r4(Math.max(0, (+q.u || 0) - l));
      }
      last[id] = q;
    }
  }
  h.v = 2;
  log('usage history: quota records migrated to v2 (net change per period)');
}
function saveHistory() {
  const json = JSON.stringify(history);
  if (json === historyJson) return;
  historyJson = json;
  try { writeFileSafe(HISTORY_FILE, json); } catch (e) { log(`write usage-history.json failed: ${e.message}`); }
}
function summarizeBook(book) {
  const vals = Object.values(book.by || {}).map(Number).filter((v) => v >= 0);
  const models = {};
  for (const d of Object.values(book.det || {})) {
    for (const [name, r] of Object.entries(d || {})) {
      const m = models[name] || (models[name] = [0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < 6; i++) m[i] += +r[i] || 0;
    }
  }
  for (const m of Object.values(models)) m[0] = Math.round(m[0] * 1e6) / 1e6;
  return { usd: Math.round(vals.reduce((a, b) => a + b, 0) * 1e6) / 1e6, convs: vals.filter((v) => v > 0).length, models };
}
// 页面里的额度 → [{ id, w, used, reset, name }]；只认今天（本地 0 点以后）查到的。
// 查到得晚一点没关系：上涨的部分晚一点记，只是把用量算晚一点。
// 状态变了（有没有额度、几个桶）记一行日志，方便排查额度一栏为什么是空的。
let quotaNote = '';
function quotaBuckets(q) {
  const note = (s) => { if (s !== quotaNote) { quotaNote = s; log('usage history: ' + s); } };
  if (!q || !Array.isArray(q.buckets)) { note('no quota in page yet'); return null; }
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  if (!(q.at >= d0.getTime())) { note('quota in page is from before today'); return null; }
  const out = [];
  for (const b of q.buckets) {
    const rf = Number(b.rf);
    if (!b.id || b.dis || !(rf >= 0 && rf <= 1)) continue;
    const reset = Date.parse(String(b.reset || '').replace(/(\.\d{3})\d+/, '$1'));
    out.push({ id: String(b.id).slice(0, 80), w: String(b.w || '').slice(0, 20), used: 1 - rf, reset: reset > 0 ? reset : 0, name: String(b.name || '').slice(0, 60) });
  }
  note(`quota buckets ${out.length}/${q.buckets.length}: ${out.map((b) => b.id + '(' + b.w + ')').join(', ')}`);
  return out;
}
// 某个桶在今天以前最近的一条记录（最多往前找 14 天）
function prevQuota(h, today, id) {
  for (const k of Object.keys(h.days).filter((x) => x < today).sort().reverse().slice(0, 14)) {
    const q = h.days[k] && h.days[k].quota && h.days[k].quota[id];
    if (q) return q;
  }
  return null;
}
// 记一次额度观察：noteQuota 在 lib/quota.mjs（按周期分段算净变化，2026-11-24 拆出去）。
// 当天第一次见到某个桶：前面有记录、还在同一个周期里，就从那条记录最后的值接着算（中间没观察到的部分算到今天）；
//   周期已经换了就从 0 算；以前从没见过就从现在的值算（看不到之前用了多少）。
// v1.4.0 旧格式（f 起点 / a 已累计）和 v1.4.1 的格式（只有 u）在 migrateHistory 里一次性换算。
const migrateQuota = (q) => (+q.f === 0 && +q.a > 0 ? +q.a : Math.max(0, (+q.m || 0) - (+q.f || 0)) + (+q.a || 0));
// 页面给的账号：{ key 邮箱哈希, m 打码的邮箱, t 套餐名 }（见 statusbar.js 的 acctOf）。只认这几个字段、限制长度。
function quotaAcct(q) {
  const a = q && q.acct;
  if (!a || typeof a !== 'object' || !/^[0-9a-f]{6,16}$/.test(String(a.key || ''))) return null;
  return { key: String(a.key), m: String(a.m || '').slice(0, 80), t: String(a.t || '').slice(0, 60) };
}
// 某个账号的某个桶在今天以前最近的一条记录（最多往前找 14 天）
function prevQuotaOf(h, today, key, id) {
  for (const k of Object.keys(h.days).filter((x) => x < today).sort().reverse().slice(0, 14)) {
    const q = h.days[k] && h.days[k].qa && h.days[k].qa[key] && h.days[k].qa[key][id];
    if (q) return q;
  }
  return null;
}
// 第一次见到某个账号：最近 14 天里不知道账号的旧记录（day.quota），重置时间和这个账号现在的桶对得上（同一个周期），
// 就归给这个账号——同一个周期的重置时间是固定的，换了账号几乎不可能正好对上。对不上的留在 quota（面板里不显示）。
function adoptLegacy(h, key, buckets) {
  let n = 0;
  for (const k of Object.keys(h.days).sort().reverse().slice(0, 14)) {
    const day = h.days[k];
    if (!day || !day.quota) continue;
    for (const [id, q] of Object.entries(day.quota)) {
      const b = buckets.find((x) => x.id === id);
      if (!b || !q || !samePeriod(q.r, b.reset)) continue;
      ((day.qa || (day.qa = {}))[key] || (day.qa[key] = {}))[id] = q;
      delete day.quota[id];
      n++;
    }
    if (!Object.keys(day.quota).length) delete day.quota;
  }
  if (n) log(`usage history: ${n} earlier quota records matched the current account by reset time`);
}
function updateHistory(book, buckets, acct, quotaAt) {
  const h = readHistory();
  const today = book.day;
  const day = h.days[today] || (h.days[today] = {});
  const s = summarizeBook(book);
  if (!(day.usd > s.usd)) Object.assign(day, s); // 文件里今天的数更大（账本被重置过）就保留文件里的
  // 额度只在知道是哪个账号时才记（页面一般几秒内就拿到账号；拿到之前查到的额度跳过，下一次再记）
  if (buckets && buckets.length && acct) {
    const accts = h.accts || (h.accts = {});
    if (!accts[acct.key]) { adoptLegacy(h, acct.key, buckets); accts[acct.key] = { first: today }; }
    Object.assign(accts[acct.key], { m: acct.m, t: acct.t, last: today });
    if (h.cur !== acct.key) { if (h.cur) log('usage history: account changed'); h.cur = acct.key; }
    const qa = day.qa || (day.qa = {});
    const at = quotaAt > 0 ? quotaAt : Date.now();
    noteQuota(qa[acct.key] || (qa[acct.key] = {}), buckets, (id) => prevQuotaOf(h, today, acct.key, id), at,
      (b, ev) => noteReset(h, acct.key, b, at, ev));
    noteSamples(acct.key, buckets, quotaAt);
  }
  h.v = 3;
  const keys = Object.keys(h.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_KEEP_DAYS))) delete h.days[k];
  saveHistory();
}
// 推给页面的历史：每天的 quota 换成当前账号的那一份（不知道当前账号时用旧记录），带上账号、每周额度预估和当前账号的提前重置事件
// 每天的额度记录只推页面用得到的字段（分段明细 p 不推）
// n：推最近几天（默认 31 天，每 30 秒推一次）；面板选 all 时经 __agyZhAsk 要一次全部（见 onPageAsk）
function recentHistory(n = HISTORY_PUSH_DAYS) {
  const h = readHistory();
  const days = {};
  const slimQ = (qs) => {
    const out = {};
    for (const [id, q] of Object.entries(qs || {})) { if (q && typeof q === 'object') { const { p, c0, ...rest } = q; out[id] = rest; } }
    return out;
  };
  const keys = Object.keys(h.days).sort().slice(-n);
  for (const k of keys) {
    const d = h.days[k];
    const { qa, quota, ...rest } = d;
    days[k] = { ...rest, quota: slimQ(h.cur ? qa && qa[h.cur] : quota) };
  }
  const from = keys.length ? new Date(keys[0] + 'T00:00:00').getTime() : 0;
  const resets = h.cur ? (h.resets || []).filter((e) => e.k === h.cur && e.at >= from).map(({ k, ...e }) => e) : [];
  return { at: Date.now(), days, resets, acct: h.cur && h.accts ? { ...h.accts[h.cur], key: h.cur } : null, est: h.cur ? weeklyEstimate(h.cur) : null };
}

// ---------- 细粒度额度读数（2026-11-22 加，v1.6） ----------
// quota-samples.json：{ v: 1, a: { 账号键: [[时间毫秒, 桶 ID, 已用比例, 重置时间毫秒], …] } }，每个账号留最近 8 天。
// 页面大约每 3 分钟查一次额度，每查到一次（时间戳变了）记一笔，只记每周额度。用来算最近 24 小时的用量速度（预估用）。
// 每天的历史只有“当天用掉多少”，看不出一天里什么时候用的，所以另记这个。
const SAMPLES_FILE = path.join(DATA, 'quota-samples.json');
const SAMPLES_KEEP_MS = 8 * 86400e3;
let samples = null;
let samplesAt = {};
function readSamples() {
  if (!samples) {
    samples = readJsonKeep(SAMPLES_FILE);
    if (!samples || typeof samples.a !== 'object') samples = { v: 1, a: {} };
  }
  return samples;
}
function noteSamples(key, buckets, at) {
  if (!(at > 0) || samplesAt[key] === at) return;
  samplesAt[key] = at;
  const sm = readSamples();
  const list = sm.a[key] || (sm.a[key] = []);
  for (const b of buckets) if (b.w === 'weekly') list.push([at, b.id, r4(b.used), b.reset]);
  const cut = Date.now() - SAMPLES_KEEP_MS;
  while (list.length && list[0][0] < cut) list.shift();
  try { writeFileSafe(SAMPLES_FILE, JSON.stringify(sm)); } catch (e) { log(`write quota-samples.json failed: ${e.message}`); }
}

// ---------- 每周额度预估（2026-11-22 加，v1.6） ----------
// 每个每周额度桶：按这个周期到现在的平均速度，和最近 24 小时的速度，推到重置时大约用到多少。
//   周期开始 = 重置时间 − 7 天；这周到现在的平均速度 = 已用 ÷ 已过去的时间（这周过去不到 1 天时很不准，页面会标出来）。
//   最近 24 小时：取同一个周期里约 24 小时前的读数（至少隔 6 小时才算），速度 = 净增加 ÷ 间隔；已用比例会来回起伏，所以用净变化。
//   预估 > 100%：再算按这个速度哪天用完。
// 只有这个账号的额度只被这台电脑用时才准：和家人共享额度、或者在别的电脑上也用这个号，别人用掉的也会算进速度里。
function weeklyEstimate(key) {
  const list = (readSamples().a[key] || []);
  if (!list.length) return null;
  const now = Date.now();
  const out = {};
  const last = {};
  for (const x of list) last[x[1]] = x; // 每个桶最近一笔
  for (const [id, x] of Object.entries(last)) {
    const [at, , used, reset] = x;
    if (!(reset > now) || now - at > 6 * 3600e3) continue; // 已经重置或者太久没查到：不估
    const start = reset - 7 * 86400e3;
    const elapsed = Math.max(1, at - start);
    const left = reset - at;
    const e = { used, reset, at, elapsedH: r4(elapsed / 3600e3), projWeek: r4(used + used / elapsed * left) };
    // 最近 24 小时：同一个周期里、离现在最接近 24 小时（至少 6 小时）的那一笔
    let ref = null;
    for (const y of list) {
      if (y[1] !== id || !samePeriod(y[3], reset) || at - y[0] < 6 * 3600e3) continue;
      if (!ref || Math.abs(at - y[0] - 86400e3) < Math.abs(at - ref[0] - 86400e3)) ref = y;
    }
    if (ref) {
      const rate = Math.max(0, used - ref[2]) / (at - ref[0]);
      e.spanH = r4((at - ref[0]) / 3600e3);
      e.proj24 = r4(used + rate * left);
      if (rate > 0 && e.proj24 > 1) e.fullAt24 = Math.round(at + (1 - used) / rate);
    }
    if (e.projWeek > 1 && used > 0) e.fullAtWeek = Math.round(at + (1 - used) / (used / elapsed));
    out[id] = e;
  }
  return out;
}

// ---------- 补算以前的用量（2026-11-20 加） ----------
// 实时记录从 liveFrom 那天才开始。更早的天数从 Antigravity 自己的对话库补算（只读打开，不写）：
//   ~/.gemini/antigravity/conversations/<对话 ID>.db（Windows 是 %USERPROFILE%\.gemini\...，macOS 是 /Users/<用户名>/.gemini/...），每个对话一个 SQLite 库。
//   gen_metadata 表每行是一次模型调用（protobuf）：字段 4 = executionId，1.19 = 模型名，
//     1.4 = token 用量（1.4.2 输入、1.4.3 输出含思考、1.4.4 缓存写入、1.4.5 缓存读取、1.4.9 思考、1.4.10 回复、1.4.11 请求 ID）；
//   gen_metadata 字段 2 = 这次调用产生的步骤序号（packed，对应 steps.idx）；
//   steps 表的 metadata（protobuf）：字段 1 = 创建时间（Timestamp，1 = 秒），12 = executionId。
//   每次调用的时间 = 它的第一个步骤的创建时间（找不到这个步骤才用同一 executionId 第一个步骤的时间）。
//   不能只按 executionId 对时间：一个 executionId 是一轮，一轮可能跑一个多小时、跨过 0 点
//   （实测 11-17 23:54 开始的三轮干到 11-18 01:17，按一轮开始的时间算，11-18 的 349 次调用全记到了 11-17）。
//   一个 executionId 里可能调用好几次，所以按请求 ID 去重（子代理的调用可能在两个库里都有），没有请求 ID 才用 executionId + token 数。
// 按本地日期归到 liveFrom 之前的每一天，存成那一天的 raw = { 模型名: [调用数, 输入, 缓存读, 缓存写, 输出] }，
// 钱由状态栏按它的价目表算（价目表只放在 statusbar.js 一处）。只跑一次，结果记在 history.bf（v = 补算办法的版本）；
// 删掉 bf 再重启注入程序会重新补算。v1（11-20）按一轮开始的时间归日，v2（11-22）改成按每次调用自己的时间，v1 的记录会重算一次。
// 字段号是 2026-11-20 对着 Antigravity 2.33.0 的数据和状态栏算出的数核对出来的；存储格式变了就补不出来，不影响其他功能。
// 需要 Node.js 22.13 / 23.4 以上（node:sqlite 从这两个版本起不用加 --experimental-sqlite；22.5～22.12 要加参数才有）。
// Windows 安装包自带的 node.exe 满足；macOS 用系统装的 Node。版本不够时 import 失败，只跳过补算（history.bf.err 记原因）。
const CONV_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
// 最小的 protobuf 读取：返回第一个字段号为 f 的值（varint → 数字，长度型 → Buffer 片段），没有返回 undefined
function pbGet(buf, f) {
  let i = 0;
  const vi = () => { let x = 0, m = 1, c; do { c = buf[i++]; x += (c & 0x7f) * m; m *= 128; } while (c & 0x80 && i < buf.length); return x; };
  while (i < buf.length) {
    const key = vi();
    const k = Math.floor(key / 8), wt = key % 8;
    if (k === 0) return undefined;
    let v;
    if (wt === 0) v = vi();
    else if (wt === 2) { const n = vi(); v = buf.subarray(i, i + n); i += n; }
    else if (wt === 1) i += 8;
    else if (wt === 5) i += 4;
    else return undefined;
    if (k === f && v !== undefined) return v;
  }
  return undefined;
}
// packed 的一串 varint（比如 gen_metadata 字段 2 的步骤序号）
function pbVarints(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let x = 0, m = 1, c;
    do { c = buf[i++]; x += (c & 0x7f) * m; m *= 128; } while (c & 0x80 && i < buf.length);
    out.push(x);
  }
  return out;
}
const dayOf = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
// 读一个对话库，把 before（不含）之前的调用加进 acc：{ 日期: { raw, convs: Set } }；返回 { calls, nodate }
function readConvDb(DatabaseSync, file, before, seen, acc) {
  const db = new DatabaseSync(file, { readOnly: true });
  let calls = 0, nodate = 0;
  try {
    const stepAt = new Map(); // steps.idx → 创建时间（毫秒）
    const when = new Map(); // executionId → 这一轮第一个步骤的时间（找不到调用自己的步骤时才用）
    for (const r of db.prepare('select idx, metadata from steps').iterate()) {
      if (!r.metadata) continue;
      const m = Buffer.from(r.metadata);
      const ts = pbGet(m, 1);
      const sec = Buffer.isBuffer(ts) ? pbGet(ts, 1) : 0;
      if (!(sec > 0)) continue;
      stepAt.set(Number(r.idx), sec * 1000);
      const exec = pbGet(m, 12);
      if (!Buffer.isBuffer(exec)) continue;
      const id = exec.toString('utf8');
      if (!when.has(id)) when.set(id, sec * 1000);
    }
    const conv = path.basename(file, '.db');
    for (const r of db.prepare('select data from gen_metadata').iterate()) {
      if (!r.data) continue;
      const g = Buffer.from(r.data);
      const exec = pbGet(g, 4), cm = pbGet(g, 1);
      if (!Buffer.isBuffer(exec) || !Buffer.isBuffer(cm)) continue;
      const id = exec.toString('utf8');
      const u = pbGet(cm, 4);
      if (!Buffer.isBuffer(u)) continue;
      const inp = pbGet(u, 2) || 0, cw = pbGet(u, 4) || 0, cr = pbGet(u, 5) || 0;
      const out = Math.max(pbGet(u, 3) || 0, (pbGet(u, 9) || 0) + (pbGet(u, 10) || 0));
      if (!inp && !cr && !cw && !out) continue; // token 全是 0：多半是失败的请求
      // 去重：一轮（一个 executionId）里可能调用模型好几次，所以用每次调用自己的请求 ID（1.4.11），没有才用 executionId + token 数
      const rid = pbGet(u, 11);
      const key = Buffer.isBuffer(rid) && rid.length ? rid.toString('utf8') : id + ':' + inp + ':' + cr + ':' + out;
      if (seen.has(key)) continue;
      seen.add(key);
      const steps = pbGet(g, 2);
      let at = 0;
      for (const i of Buffer.isBuffer(steps) ? pbVarints(steps) : typeof steps === 'number' ? [steps] : []) if ((at = stepAt.get(i) || 0)) break;
      if (!at) at = when.get(id) || 0;
      if (!(at > 0)) { nodate++; continue; }
      const day = dayOf(at);
      if (before && day >= before) continue;
      const model = Buffer.isBuffer(pbGet(cm, 19)) ? pbGet(cm, 19).toString('utf8').slice(0, 60) : 'unknown';
      const d = acc[day] || (acc[day] = { raw: {}, convs: new Set() });
      const x = d.raw[model] || (d.raw[model] = [0, 0, 0, 0, 0]);
      x[0]++; x[1] += inp; x[2] += cr; x[3] += cw; x[4] += out;
      d.convs.add(conv);
      calls++;
    }
  } finally { db.close(); }
  return { calls, nodate };
}
// 这一天有没有桌面版的用量记录（实时的 models / usd，或补算的 raw）。只有 CLI 用量（cli）或只有额度记录的天不算，
// 补算时照样补（2026-11-24：CLI 的用量可能先于补算写进某一天，原来按“有记录就是实时记的”判断会跳过那天）
const deskRec = (rec) => !!rec && (rec.models != null || rec.usd != null || rec.raw != null);
const BACKFILL_V = 3; // v3（11-24）：历史改成留 400 天，重新补一次 90 天以前的日子（以前补完会被删掉）
// 读全部对话库，算到昨天为止每一天的调用：
// - liveFrom 之前（没有实时记录的日子）：补算出来的（bf）和没有记录的，换成新算的；有实时记录的不动。
//   新算时找不到的日子不删（对话被删掉了，库就没了；留着原来补算的数）。
// - liveFrom 以后（实时记录的日子）：只在新算的调用次数比原来记的多 2% 以上时才换。v1.6 以前页面的今天账本
//   只算后台摘要里列出的对话和注入程序从磁盘找到的今天的对话，摘要只列一部分（实测 21 个，本机库文件 79 个），可能漏算。
//   换的时候去掉 models / usd（钱由状态栏按价目表从 raw 算），额度记录（quota / qa）不动，原来的金额留在 liveUsd，记 fix = 1。
//   11-22 Windows 上实测实时记录的日子没有漏算；这一段是保险。
async function backfillHistory() {
  const h = readHistory();
  if (h.bf && h.bf.v === BACKFILL_V) return;
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { h.bf = { v: BACKFILL_V, at: Date.now(), err: 'node:sqlite not available' }; saveHistory(); return; }
  let names = [];
  try { names = fs.readdirSync(CONV_DIR).filter((n) => /^[0-9a-f-]{36}\.db$/.test(n)); } catch {}
  const today = dayName();
  const seen = new Set();
  const acc = {};
  let dbs = 0, calls = 0, nodate = 0, errors = 0;
  for (const n of names) {
    try {
      const r = readConvDb(DatabaseSync, path.join(CONV_DIR, n), today, seen, acc);
      calls += r.calls; nodate += r.nodate; dbs++;
    } catch { errors++; }
    await new Promise((r) => setImmediate(r)); // 每读完一个库让出一下，别长时间占住事件循环
  }
  const sumCalls = (raw) => Object.values(raw || {}).reduce((t, r) => t + (Array.isArray(r) ? +r[0] || 0 : 0), 0);
  let daysAdded = 0;
  const fixed = [];
  for (const [day, d] of Object.entries(acc)) {
    const rec = h.days[day];
    if (day < h.liveFrom) {
      if (deskRec(rec) && !rec.bf) continue;
      h.days[day] = { ...(rec || {}), bf: 1, convs: d.convs.size, raw: d.raw };
      daysAdded++;
      continue;
    }
    if (!deskRec(rec) || rec.bf) continue;
    const live = rec.models ? Object.values(rec.models).reduce((t, m) => t + (+m[1] || 0), 0) : sumCalls(rec.raw);
    const db = sumCalls(d.raw);
    if (!(db > live * 1.02 + 1)) continue;
    const { models, usd, ...rest } = rec;
    h.days[day] = { ...rest, raw: d.raw, convs: Math.max(+rec.convs || 0, d.convs.size), fix: 1, liveUsd: rec.liveUsd != null ? rec.liveUsd : usd };
    fixed.push(day + ' ' + live + '→' + db);
  }
  h.bf = { v: BACKFILL_V, at: Date.now(), dbs, calls, nodate, errors, days: daysAdded, fixed: fixed.length };
  log(`usage backfill v${BACKFILL_V}: ${dbs}/${names.length} conversation dbs, ${calls} calls before ${today}, ${daysAdded} days before ${h.liveFrom}` +
    (fixed.length ? `, live days fixed: ${fixed.join(', ')}` : '') + (nodate ? `, ${nodate} calls without time` : '') + (errors ? `, ${errors} dbs failed` : ''));
  const keys = Object.keys(h.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_KEEP_DAYS))) delete h.days[k];
  saveHistory();
}

// ---------- agy CLI 的用量（2026-11-24 加） ----------
// 别的工具（其他 agent）直接调 agy CLI 时，用的是同一个账号：额度百分比本来就含 CLI 用掉的（谷歌按账号算），
// 但花费、调用次数、token 原来只算桌面版。CLI 的对话库在 ~/.gemini/antigravity-cli/conversations/<对话 ID>.db，
// 格式和桌面版一样（11-24 实测，字段号同上面“补算以前的用量”），另有 chatModel 的 11 = 首字时间、12 = 生成用时
// （Duration：1 秒、2 纳秒；11-24 对着桌面后台接口的 timeToFirstToken / streamingDuration 逐条核对过）、21 = 界面上的模型名。
// - 按天汇总存进 usage-history.json 每天的 cli = { raw: { 模型名: [调用数, 输入, 缓存读, 缓存写, 输出] }, convs, calls }，
//   钱由状态栏按价目表算（和补算的天一样）。
// - 第一次（history.cliBf 没有或版本不对）读 HISTORY_KEEP_DAYS（400）天内改过的全部库（11-24 Windows 实测 167 个、1.7 GB、约 7 秒），
//   以后每 30 秒只重读改过的库，只重算“上次扫描那天和昨天里较早的那天”到今天；今天的汇总变了就马上推一次历史给页面。
// - 每次调用的明细（调用明细页用）留在内存里，只留最近 32 天改过的库；页面打开某一天的明细时经 __agyZhAsk 来要（见 onPageAsk）。
// - 只读打开，不写 CLI 的文件；库正被 CLI 写着读不了时（BUSY），留着上次读到的，这次不改那几天的汇总。
const CLI_ROOT = path.join(os.homedir(), '.gemini', 'antigravity-cli');
const CLI_CONV_DIR = path.join(CLI_ROOT, 'conversations');
const CLI_TITLE_FILE = path.join(CLI_ROOT, 'cache', 'conversation_metadata.json');
const CLI_BF_V = 2; // v2（11-24）：历史改成留 400 天，重新读一次全部 CLI 对话库
const CLI_SCAN_MS = 30000;
const CLI_CALLS_KEEP_MS = 32 * 86400e3;
const cliCache = new Map(); // 文件名 → { mtime, calls: [[时间, 模型名, 输入, 缓存读, 缓存写, 输出, 首字秒, 生成秒, 界面名, 请求 ID]] }
let cliBusy = false;
let cliScanAt = Date.now() - CLI_SCAN_MS + 20000; // 启动 20 秒后第一次扫
const pbDur = (b) => (Buffer.isBuffer(b) ? (pbGet(b, 1) || 0) + (pbGet(b, 2) || 0) / 1e9 : 0);
function readCliDb(DatabaseSync, file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const calls = [];
  try {
    const stepAt = new Map();
    const when = new Map();
    for (const r of db.prepare('select idx, metadata from steps').iterate()) {
      if (!r.metadata) continue;
      const m = Buffer.from(r.metadata);
      const ts = pbGet(m, 1);
      const sec = Buffer.isBuffer(ts) ? pbGet(ts, 1) : 0;
      if (!(sec > 0)) continue;
      stepAt.set(Number(r.idx), sec * 1000);
      const exec = pbGet(m, 12);
      if (Buffer.isBuffer(exec) && !when.has(exec.toString('utf8'))) when.set(exec.toString('utf8'), sec * 1000);
    }
    for (const r of db.prepare('select data from gen_metadata').iterate()) {
      if (!r.data) continue;
      const g = Buffer.from(r.data);
      const exec = pbGet(g, 4), cm = pbGet(g, 1);
      if (!Buffer.isBuffer(cm)) continue;
      const u = pbGet(cm, 4);
      if (!Buffer.isBuffer(u)) continue;
      const inp = pbGet(u, 2) || 0, cw = pbGet(u, 4) || 0, cr = pbGet(u, 5) || 0;
      const out = Math.max(pbGet(u, 3) || 0, (pbGet(u, 9) || 0) + (pbGet(u, 10) || 0));
      if (!inp && !cr && !cw && !out) continue;
      const steps = pbGet(g, 2);
      let at = 0;
      for (const i of Buffer.isBuffer(steps) ? pbVarints(steps) : typeof steps === 'number' ? [steps] : []) if ((at = stepAt.get(i) || 0)) break;
      if (!at && Buffer.isBuffer(exec)) at = when.get(exec.toString('utf8')) || 0;
      if (!(at > 0)) continue;
      const str = (b, n) => (Buffer.isBuffer(b) ? b.toString('utf8').slice(0, n) : '');
      const rid = pbGet(u, 11);
      calls.push([at, str(pbGet(cm, 19), 60) || 'unknown', inp, cr, cw, out,
        Math.round(pbDur(pbGet(cm, 11)) * 1000) / 1000, Math.round(pbDur(pbGet(cm, 12)) * 1000) / 1000, str(pbGet(cm, 21), 60), str(rid, 80)]);
    }
  } finally { db.close(); }
  return calls;
}
// 同一次调用可能在两个库里都有（子代理），按请求 ID 去重；没有请求 ID 用 对话 + 时间 + token 数
const cliCallKey = (id, c) => c[9] || `${id}:${c[0]}:${c[2]}:${c[5]}`;
const dayMs = (day) => new Date(day + 'T00:00:00').getTime();
async function scanCli() {
  if (cliBusy) return;
  cliBusy = true;
  try {
    let names;
    try { names = fs.readdirSync(CLI_CONV_DIR).filter((n) => /^[0-9a-f-]{36}\.db$/.test(n)); } catch { return; } // 没装 CLI
    let DatabaseSync;
    try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return; }
    SqliteDb = DatabaseSync;
    const h = readHistory();
    const full = !(h.cliBf && h.cliBf.v === CLI_BF_V);
    const now = Date.now();
    const today = dayName();
    const yest = dayOf(now - 86400e3);
    const fromDay = full ? dayOf(now - (HISTORY_KEEP_DAYS - 1) * 86400e3)
      : [yest, dayOf(+h.cliBf.at || now)].sort()[0];
    const from = dayMs(fromDay);
    const keepFrom = now - CLI_CALLS_KEEP_MS;
    let read = 0, stale = 0, missing = 0;
    const present = new Set(names);
    for (const n of [...cliCache.keys()]) if (!present.has(n)) cliCache.delete(n); // 对话被删了
    for (const n of names) {
      const f = path.join(CLI_CONV_DIR, n);
      let mt = 0;
      try { mt = fs.statSync(f).mtimeMs; } catch { continue; }
      try { mt = Math.max(mt, fs.statSync(f + '-wal').mtimeMs); } catch {} // WAL 模式时新写的在 -wal 里
      if (mt < Math.min(from, keepFrom)) continue;
      const old = cliCache.get(n);
      if (old && old.mtime === mt) continue;
      try {
        cliCache.set(n, { mtime: mt, calls: readCliDb(DatabaseSync, f) });
        read++;
      } catch {
        if (old) stale++; else if (mt >= from) missing++; // 读不了：有旧的就先用旧的
      }
      await new Promise((r) => setImmediate(r));
    }
    // 按天汇总 fromDay ～ 今天
    const agg = {};
    const seen = new Set();
    for (const [n, e] of cliCache) {
      if (e.mtime < from) continue;
      const id = n.slice(0, -3);
      for (const c of e.calls) {
        if (c[0] < from) continue;
        const k = cliCallKey(id, c);
        if (seen.has(k)) continue;
        seen.add(k);
        const d = dayOf(c[0]);
        const a = agg[d] || (agg[d] = { raw: {}, convs: new Set(), calls: 0 });
        const x = a.raw[c[1]] || (a.raw[c[1]] = [0, 0, 0, 0, 0]);
        x[0]++; x[1] += c[2]; x[2] += c[3]; x[3] += c[4]; x[4] += c[5];
        a.convs.add(id);
        a.calls++;
      }
    }
    let changed = 0;
    if (!missing) { // 有该读的库一个都没读到：这次不改汇总，下次再试
      for (let t = from + 43200e3; dayOf(t) <= today; t += 86400e3) { // 从中午起算，不怕夏令时那天少一小时
        const d = dayOf(t);
        const a = agg[d];
        const rec = h.days[d];
        const next = a ? { raw: a.raw, convs: a.convs.size, calls: a.calls } : null;
        if (JSON.stringify(rec && rec.cli || null) === JSON.stringify(next)) continue;
        if (next) (h.days[d] || (h.days[d] = {})).cli = next;
        else if (rec) { delete rec.cli; if (!Object.keys(rec).length) delete h.days[d]; }
        changed++;
        if (d === today) costSyncAt = 0; // 今天的 CLI 用量变了：下一次轮询（3 秒内）就把历史推给页面
      }
      if (full || changed || now - (+h.cliBf.at || 0) > 600000) {
        h.cliBf = { v: CLI_BF_V, at: now, ...(full ? { first: dayOf(now), dbs: names.length } : { first: h.cliBf.first, dbs: h.cliBf.dbs }) };
      }
    }
    if (full) {
      const calls = Object.values(agg).reduce((t, a) => t + a.calls, 0);
      const days = Object.keys(agg).sort();
      log(`cli usage: ${read}/${names.length} cli conversation dbs read, ${calls} calls on ${days.length} days` +
        (days.length ? ` (${days[0]} .. ${days[days.length - 1]})` : '') + (stale || missing ? `, ${stale + missing} dbs busy` : ''));
      if (!missing) for (const [n, e] of cliCache) if (e.mtime < keepFrom) cliCache.delete(n); // 明细只留最近 32 天的（没扫完时留着，下次不用重读）
    } else if (missing) log(`cli usage: ${missing} cli conversation dbs busy, will retry`);
    if (changed || full) {
      const keys = Object.keys(h.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_KEEP_DAYS))) delete h.days[k];
      saveHistory();
    }
  } finally {
    cliBusy = false;
  }
}
// CLI 对话的标题（2026-11-24 改）：先查 CLI 自己的对话摘要库 conversation_summaries.db（title；没有就用 preview =
// 第一条消息的开头，去掉开头的 /plan 这类命令，留 60 字），再查 cache/conversation_metadata.json（summary.Title）。
// 原来只查那个 JSON，它不是每次都更新（11-24 实测最后更新在 11-23 00:26，之后的对话都没有标题）；
// 别的工具调起来的 CLI 对话一般没有 title，只有 preview。文件改了才重读；只读打开。
const CLI_SUMMARY_DB = path.join(CLI_ROOT, 'conversation_summaries.db');
let SqliteDb = null; // node:sqlite 的 DatabaseSync，scanCli 第一次加载后记在这里
let cliTitleCache = { key: '', map: {} };
const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const cleanPreview = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/^\/[\w-]+\s+/, '').slice(0, 60);
function cliTitles() {
  const key = [mtimeOf(CLI_TITLE_FILE), mtimeOf(CLI_SUMMARY_DB), mtimeOf(CLI_SUMMARY_DB + '-wal')].join('|');
  if (key === cliTitleCache.key) return cliTitleCache.map;
  const map = {};
  const j = readJsonKeepless(CLI_TITLE_FILE);
  for (const [id, c] of Object.entries((j && j.conversations) || {})) {
    const t = c && c.summary && c.summary.Title;
    if (UUID_RE.test(id) && typeof t === 'string' && t) map[id] = t.slice(0, 80);
  }
  if (SqliteDb && mtimeOf(CLI_SUMMARY_DB)) {
    let db = null;
    try {
      db = new SqliteDb(CLI_SUMMARY_DB, { readOnly: true });
      for (const r of db.prepare('select conversation_id id, title, preview from conversation_summaries').iterate()) {
        if (!UUID_RE.test(String(r.id))) continue;
        const t = String(r.title || '').trim().slice(0, 80) || cleanPreview(r.preview);
        if (t) map[r.id] = t;
      }
    } catch { /* 库正被 CLI 写着或格式变了：只用 JSON 里的 */ } finally { try { db && db.close(); } catch {} }
  }
  cliTitleCache = { key, map };
  return map;
}
// 读别的程序的 JSON（不留底、不改名，读不出来就当没有）
function readJsonKeepless(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}
// 某一天 CLI 的每次调用，给调用明细页：{ day, rows: [[时间, 对话 ID, 模型名, 输入, 缓存读, 缓存写, 输出, 首字秒, 生成秒, 界面名]], convs: { 对话 ID: 标题 } }
function cliCallsFor(day) {
  const d0 = dayMs(day), d1 = d0 + 86400e3;
  const rows = [];
  const seen = new Set();
  const convs = {};
  for (const [n, e] of cliCache) {
    if (e.mtime < d0) continue;
    const id = n.slice(0, -3);
    for (const c of e.calls) {
      if (c[0] < d0 || c[0] >= d1) continue;
      const k = cliCallKey(id, c);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push([c[0], id, c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]]);
      convs[id] = '';
    }
  }
  const titles = cliTitles();
  for (const id of Object.keys(convs)) convs[id] = titles[id] || '';
  rows.sort((a, b) => b[0] - a[0]);
  return { day, rows, convs, at: Date.now() };
}
// 页面经 Runtime.addBinding 加的 window.__agyZhAsk(JSON) 来要数据（2026-11-24 加）。只认两种：
//   { t: 'cli-calls', day: 'YYYY-MM-DD' } → 调页面的 S.setCliCalls（某一天 CLI 的调用明细）；
//   { t: 'history-all' } → 调页面的 S.setHistoryAll（全部历史，面板选 all 时要一次）。
// 页面里任何脚本都能调这个函数，所以只给只读的用量数字和 CLI 对话标题，别的一律不理。
async function onPageAsk(sess, payload) {
  let q;
  try { q = JSON.parse(String(payload || '').slice(0, 200)); } catch { return; }
  let expr = '';
  if (q && q.t === 'cli-calls' && /^\d{4}-\d{2}-\d{2}$/.test(String(q.day))) {
    expr = `window.__agyStats && window.__agyStats.setCliCalls && window.__agyStats.setCliCalls(${JSON.stringify(cliCallsFor(q.day))})`;
  } else if (q && q.t === 'history-all') {
    expr = `window.__agyStats && window.__agyStats.setHistoryAll && window.__agyStats.setHistoryAll(${JSON.stringify(recentHistory(HISTORY_KEEP_DAYS))})`;
  } else return;
  try { await sess.send('Runtime.evaluate', { expression: expr }); } catch {}
}
const mtimes = {};
function loadAssets() {
  let changed = false;
  for (const [key, file] of Object.entries(FILES)) {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch {}
    if (mtime === mtimes[key]) continue;
    mtimes[key] = mtime;
    changed = true;
    if (!mtime) {
      assets[key] = key in EMPTY ? EMPTY[key] : '';
      continue;
    }
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); // 去掉 UTF-8 BOM
      assets[key] = JSON_KEYS.has(key) ? JSON.parse(text) : text;
    } catch (e) {
      log(`read ${path.basename(file)} failed: ${e.message}`);
    }
  }
  return changed;
}
function pageScript() {
  // 在页面里执行：建一个固定 id 的 <style>，已有就只更新内容；再启动或更新翻译器
  const i18 = i18nData();
  const i18n = i18.dict && assets.translator
    ? `try { (${assets.translator})(${JSON.stringify(i18.dict)}, ${JSON.stringify(i18.rules || [])}); } catch (e) { console.warn('agy i18n', e); }`
    : `window.__agyI18n && window.__agyI18n.disable();`;
  // 状态栏：删掉 statusbar.js 就不再加载（已打开的窗口要刷新才会消失）
  const bar = assets.statusbar
    ? `try { (${assets.statusbar})(${JSON.stringify(barConfig())}); } catch (e) { console.warn('agy statusbar', e); }`
    : '';
  return `(() => {
    ${bar}
    const ID = ${JSON.stringify(STYLE_ID)};
    const CSS = ${JSON.stringify(assets.css)};
    const put = () => {
      let s = document.getElementById(ID);
      if (!CSS) { if (s) s.remove(); return; } // 没有 style.css：不加样式（以前加过的也去掉）
      if (!s) {
        s = document.createElement('style');
        s.id = ID;
        (document.head || document.documentElement).appendChild(s);
      }
      if (s.textContent !== CSS) s.textContent = CSS;
    };
    if (document.documentElement) put();
    document.addEventListener('DOMContentLoaded', put, { once: true });
    ${i18n}
  })()`;
}

// ---------- 在线更新：词典、规则、价格、最新版本号（2026-11-22 加，v1.7） ----------
// 安装包自带的词典和单价会过时（Antigravity 更新后新加的界面文字、Google 调价），所以注入程序每 6 小时
// 从 GitHub 仓库（经 jsDelivr）取四个文件：
//   i18n/zh-CN.json（词典）、i18n/zh-CN.rules.json（规则）、
//   data/prices.json（价格，GitHub Actions 每天按官方价格页更新，见 tools/update-prices.mjs）、data/meta.json（最新版本号，发版时改）。
// - 只取数据，不取代码：词典和规则只被翻译器当文字用（填进文字节点和 placeholder / title 属性，不当 HTML），价格只是数字。
//   inject.mjs、statusbar.js、translator.js 不会自动更新；有新版本时每日面板上提示，由用户自己下载安装包。
// - 请求从 Antigravity 的页面里发（Runtime.evaluate 里 fetch），走 Antigravity 自己的网络和代理设置
//   （Node.js 不读系统代理，国内直连 jsDelivr 不一定通）。不带 cookie、不带 Referer，只是普通的 GET。
//   jsDelivr 的几个域名和 raw.githubusercontent.com 依次试，记住上次能用的那个。
// - 每个文件先校验（格式、条数、长度、数值范围），通过了才存进安装目录的 remote/，再交给页面；不通过就继续用原来的。
//   词典和规则：在线的覆盖安装包自带的同名条目，自带的其他条目照用；删掉了自带词典（只要状态栏、不要汉化）时在线的也不用。
//   价格：交给状态栏，在线价格表里有的模型用在线的价，没有的用内置的。
// - Theme 页的 updates 选 off（look.json 的 online = 'off'）：不再联网，也不用 remote/ 里存的，只用安装包自带的。
// - 换了版本（安装了新的安装包）以后，remote/ 里存的词典和规则先不用，等下一次取到再用（新安装包里的可能更新）。
// - 测试：环境变量 AGY_REMOTE_BASE 换成别的地址（例如本机起的 http://127.0.0.1:端口/），只试这一个地址。
const PACK_VERSION = '2.0.5';
const REMOTE_DIR = path.join(DATA, 'remote');
const REMOTE_STATE = path.join(REMOTE_DIR, 'state.json');
const REMOTE_BASES = process.env.AGY_REMOTE_BASE ? [process.env.AGY_REMOTE_BASE] : [
  'https://cdn.jsdelivr.net/gh/ncdeng/agy-zh-pack@main/',
  'https://fastly.jsdelivr.net/gh/ncdeng/agy-zh-pack@main/',
  'https://gcore.jsdelivr.net/gh/ncdeng/agy-zh-pack@main/',
  'https://raw.githubusercontent.com/ncdeng/agy-zh-pack/main/',
];
// 问 main 分支最新提交的地址：按提交下载，哪个镜像给的都一样新（见 lib/remote-source.mjs）
const REMOTE_REF_URL = 'https://api.github.com/repos/ncdeng/agy-zh-pack/git/ref/heads/main';
const REMOTE_FILES = [['meta', 'data/meta.json'], ['prices', 'data/prices.json'], ['dict', 'i18n/zh-CN.json'], ['rules', 'i18n/zh-CN.rules.json']];
const REMOTE_EVERY_MS = 6 * 3600e3; // 成功以后隔多久再查
const REMOTE_RETRY_MS = 30 * 60e3; // 失败以后隔多久重试
const REMOTE_FIRST_MS = 60e3; // 注入程序启动后多久第一次查（让 Antigravity 先加载完）
const remote = { dict: null, rules: null, prices: null, meta: null, state: {} };
let remoteNextAt = 0;
let remoteBusy = false;
let mergedCache = null;
const onlineOn = () => { const l = readLook(); return !(l && l.online === 'off'); };
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// 校验：不通过就抛错（带原因），通过就返回清理过的对象
function checkDict(o) {
  if (!isObj(o)) throw Error('not an object');
  const out = {};
  for (const [k, v] of Object.entries(o)) if (k && typeof v === 'string' && k.length <= 2000 && v.length <= 2000) out[k] = v;
  const local = isObj(assets.dict) ? Object.keys(assets.dict).length : 0;
  const n = Object.keys(out).length;
  if (n < 500 || n < local * 0.8) throw Error(`only ${n} entries (bundled ${local})`); // 防止取到半截文件
  return out;
}
function checkRules(a) {
  if (!Array.isArray(a) || a.length > 2000) throw Error('not a list');
  const out = [];
  for (const r of a) {
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'string' || typeof r[1] !== 'string' || r[0].length > 300 || r[1].length > 300) continue;
    try { new RegExp(r[0]); } catch { continue; }
    out.push([r[0], r[1]]);
  }
  const local = Array.isArray(assets.rules) ? assets.rules.length : 0;
  if (out.length < 10 || out.length < local * 0.8) throw Error(`only ${out.length} rules (bundled ${local})`);
  return out;
}
function checkPrices(o) {
  if (!isObj(o) || o.schema !== 1 || !isObj(o.models) || !DAY_RE.test(String(o.updated))) throw Error('bad format');
  const models = {};
  for (const [id, e] of Object.entries(o.models).slice(0, 300)) {
    if (!/^[a-z0-9][a-z0-9.-]{2,60}$/.test(id) || !isObj(e) || !Array.isArray(e.t) || !e.t.length || e.t.length > 12) continue;
    let ok = true;
    let prev = '';
    const t = e.t.map((x, i) => {
      if (!Array.isArray(x) || x.length !== 2 || !isObj(x[1])) { ok = false; return null; }
      const [u, p] = x;
      if (i === e.t.length - 1 ? u !== null : !(typeof u === 'string' && DAY_RE.test(u) && u > prev)) ok = false;
      if (typeof u === 'string') prev = u;
      const q = {};
      for (const k of ['in', 'cache', 'out', 'cw']) {
        if (k === 'cw' && p[k] === undefined) continue;
        if (typeof p[k] === 'number' && p[k] >= 0 && p[k] <= 1000) q[k] = p[k]; else ok = false;
      }
      return [u, q];
    });
    if (ok) models[id] = { title: String(e.title || id).slice(0, 60), t };
  }
  if (Object.keys(models).length < 3) throw Error('too few models');
  return { updated: o.updated, models };
}
function checkMeta(o) {
  if (!isObj(o) || o.schema !== 1 || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(o.latest))) throw Error('bad format');
  return { latest: o.latest, date: DAY_RE.test(String(o.date)) ? o.date : '' };
}
const REMOTE_CHECK = { dict: checkDict, rules: checkRules, prices: checkPrices, meta: checkMeta };
const WITH_SCHEMA = new Set(['prices', 'meta']); // 这两种文件要求 schema: 1
const remoteFile = (rel) => path.join(REMOTE_DIR, path.basename(rel));
function saveRemoteState() {
  try { fs.mkdirSync(REMOTE_DIR, { recursive: true }); fs.writeFileSync(REMOTE_STATE, JSON.stringify(remote.state)); } catch (e) { log(`write remote state failed: ${e.message}`); }
}
// 启动时读 remote/ 里存的（要在 loadAssets 之后调用：校验词典条数时要和自带的比）
function loadRemoteCache() {
  try { remote.state = JSON.parse(fs.readFileSync(REMOTE_STATE, 'utf8')); } catch { remote.state = {}; }
  if (!isObj(remote.state)) remote.state = {};
  const samePack = remote.state.pack === PACK_VERSION;
  for (const [key, rel] of REMOTE_FILES) {
    remote[key] = null;
    if (!samePack && (key === 'dict' || key === 'rules')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(remoteFile(rel), 'utf8'));
      // v1.7.0～2.0.0 测试版存的是校验后的对象，没带 schema，重启后校验不过、价格表退回内置的（11-22 修）。旧缓存补上再校验
      if (isObj(o) && o.schema === undefined && WITH_SCHEMA.has(key)) o.schema = 1;
      remote[key] = REMOTE_CHECK[key](o);
    } catch {}
  }
  mergedCache = null;
  const st = remote.state;
  const now = Date.now();
  remoteNextAt = !samePack ? now + REMOTE_FIRST_MS
    : Math.max(now + REMOTE_FIRST_MS, (st.okAt || 0) + REMOTE_EVERY_MS, st.at > (st.okAt || 0) ? st.at + REMOTE_RETRY_MS : 0);
}
// 交给翻译器的词典和规则：自带的 + 在线的（在线的覆盖同名条目）
function i18nData() {
  const on = onlineOn();
  const c = mergedCache;
  if (c && c.d === assets.dict && c.r === assets.rules && c.rd === remote.dict && c.rr === remote.rules && c.on === on) return c;
  let dict = assets.dict;
  let rules = assets.rules || [];
  if (on && assets.dict) {
    if (remote.dict) dict = { ...assets.dict, ...remote.dict };
    if (remote.rules) {
      const seen = new Set(remote.rules.map((r) => r[0]));
      rules = [...remote.rules, ...(assets.rules || []).filter((r) => !seen.has(r[0]))];
    }
  }
  mergedCache = { d: assets.dict, r: assets.rules, rd: remote.dict, rr: remote.rules, on, dict, rules };
  return mergedCache;
}
// 交给状态栏的：版本号、开关、在线价格表、最新版本号、检查情况
function remoteForPage() {
  const on = onlineOn();
  const st = remote.state || {};
  return {
    version: PACK_VERSION, on,
    prices: on ? remote.prices : null,
    meta: on ? remote.meta : null,
    st: {
      at: st.at || 0, okAt: st.okAt || 0, host: st.host ? new URL(st.host).host : '', err: st.err || '', changedAt: st.changedAt || 0,
      dictN: on && remote.dict ? Object.keys(remote.dict).length : 0, rulesN: on && remote.rules ? remote.rules.length : 0,
    },
  };
}
// 在页面里取一个文件，返回文字；取不到抛错。除了在线更新的词典/价格（都是小 JSON），代码更新下载插件文件也走这里，
// 所以上限和 lib/update.mjs 的 MAX_FILE 一样（字符数不会超过字节数，清单里合法的 UTF-8 文本文件都取得回来）
async function pageFetch(sess, url) {
  const expr = `(async () => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(${JSON.stringify(url)}, { cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer', signal: c.signal });
      if (!r.ok) return JSON.stringify({ s: r.status });
      const text = await r.text();
      return JSON.stringify({ s: r.status, text: text.length > 5 * 1024 * 1024 ? null : text });
    } catch (e) { return JSON.stringify({ s: 0, e: String((e && e.message) || e).slice(0, 120) }); }
    finally { clearTimeout(t); }
  })()`;
  const r = await sess.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r && r.result && r.result.value;
  if (typeof v !== 'string') throw Error('no result');
  const o = JSON.parse(v);
  if (o.s !== 200 || typeof o.text !== 'string') throw Error(o.e || `HTTP ${o.s}`);
  return o.text;
}
async function checkRemote() {
  const sess = [...sessions.values()].find((s) => s.ws && s.ws.readyState === 1 && s.scriptId);
  if (remoteBusy || !sess) return;
  remoteBusy = true;
  const st = remote.state;
  st.at = Date.now();
  const problems = [];
  try {
    // 选镜像和版本（见 lib/remote-source.mjs）：先问 GitHub 最新提交、按提交下载；问不到就按分支下载、用 meta.json 最新的镜像。
    // 以前“上次能用的镜像排最前”，会一直粘在缓存过时的镜像上（11-23 实测 gcore 给了好几个小时的旧词典和旧版本号）
    const src = await chooseSource({
      bases: REMOTE_BASES, preferred: st.host, refUrl: process.env.AGY_REMOTE_BASE ? '' : REMOTE_REF_URL,
      fetchText: (u) => pageFetch(sess, u), checkMeta,
    });
    const base = src.base;
    const got = { meta: src.metaText };
    for (const [key, rel] of REMOTE_FILES) {
      if (key === 'meta') continue;
      try { got[key] = await pageFetch(sess, src.fileBase + rel); } catch (e) { problems.push(`${key}: ${e.message}`); }
    }
    const changed = [];
    for (const [key, rel] of REMOTE_FILES) {
      if (typeof got[key] !== 'string') continue;
      let val;
      try { val = REMOTE_CHECK[key](JSON.parse(got[key].replace(/^\uFEFF/, ''))); }
      catch (e) { problems.push(`${key} rejected: ${e.message}`); continue; }
      if (JSON.stringify(val) === JSON.stringify(remote[key])) continue;
      remote[key] = val;
      fs.mkdirSync(REMOTE_DIR, { recursive: true });
      fs.writeFileSync(remoteFile(rel), JSON.stringify(WITH_SCHEMA.has(key) ? { schema: 1, ...val } : val)); // 带上 schema，下次启动读缓存时校验得过
      changed.push(key);
    }
    Object.assign(st, { okAt: Date.now(), host: base, ref: src.ref || '', err: problems.join('; ').slice(0, 300), pack: PACK_VERSION });
    if (changed.length) st.changedAt = Date.now();
    remoteNextAt = Date.now() + REMOTE_EVERY_MS;
    const how = src.ref ? ` @${src.ref.slice(0, 7)}` : ` (branch${src.notes.length ? ': ' + src.notes.join('; ').slice(0, 200) : ''})`;
    log(`remote update via ${new URL(base).host}${how}: ${changed.length ? 'changed ' + changed.join(', ') : 'no change'}` +
      (remote.dict ? `, dict ${Object.keys(remote.dict).length}` : '') + (remote.rules ? `, rules ${remote.rules.length}` : '') +
      (remote.prices ? `, prices ${remote.prices.updated}` : '') + (remote.meta ? `, latest ${remote.meta.latest}` : '') +
      (problems.length ? `; problems: ${st.err}` : ''));
    saveRemoteState();
    await pushRemote(changed.includes('dict') || changed.includes('rules'));
  } catch (e) {
    st.err = String(e.message || e).slice(0, 300);
    remoteNextAt = Date.now() + REMOTE_RETRY_MS;
    log(`remote update failed: ${st.err}`);
    saveRemoteState();
    pushRemote(false).catch(() => {});
  } finally {
    remoteBusy = false;
  }
}
// 把在线数据交给已打开的窗口。词典或规则变了要重新注入（翻译器换词典再翻一遍）；只变了价格、版本号、检查情况就只推给状态栏。
// 两种都更新登记给“刷新后页面”的脚本（reRegister / apply 里带着新的 CFG）。
async function pushRemote(i18nChanged) {
  mergedCache = null;
  const js = JSON.stringify(remoteForPage());
  for (const s of sessions.values()) {
    try {
      if (i18nChanged) { await apply(s); continue; }
      await s.send('Runtime.evaluate', { expression: `window.__agyStats && window.__agyStats.setRemote && window.__agyStats.setRemote(${js})` });
      await reRegister(s);
    } catch {}
  }
}

// ---------- 与单个页面的 CDP 连接 ----------
const sessions = new Map(); // targetId -> { ws, send, scriptId }
const ASK_BINDING = '__agyZhAsk';

function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const sess = { ws, send, scriptId: null };
  sessions.set(target.id, sess);

  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Runtime.bindingCalled' && m.params && m.params.name === ASK_BINDING) { onPageAsk(sess, m.params.payload).catch(() => {}); return; }
    const p = m.id && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  };
  ws.onopen = async () => {
    try {
      await send('Page.enable'); // 不开 Page 域，addScriptToEvaluateOnNewDocument 在刷新后不生效（测试过）
      // 页面向注入程序要数据的通道（2026-11-24 加，CLI 调用明细用）：页面调 window.__agyZhAsk(JSON) → 这里收到 Runtime.bindingCalled。
      // 刷新后仍在。加不上也不要紧：syncCost 每 30 秒会看页面的 S.cliWant 补答一次
      try { await send('Runtime.addBinding', { name: ASK_BINDING }); } catch {}
      await apply(sess);
      log(`injected into ${target.id.slice(0, 8)} ${target.url.slice(0, 60)}`);
      await maybeReload(sess, target);
    } catch (e) {
      log(`inject failed: ${e.message}`);
      ws.close();
    }
  };
  ws.onclose = () => {
    sessions.delete(target.id);
    for (const p of pending.values()) p.reject(new Error('closed'));
  };
  ws.onerror = () => {};
}

// 状态栏的 fetch 包装要在应用脚本之前装好，用量信息才生效。注入器连上时如果窗口已经加载完
// （包装晚到了，例如开机后先打开了 Antigravity、注入器后启动），而且窗口是刚打开的（2 分钟内），就自动刷新一次；
// 刷新后由 addScriptToEvaluateOnNewDocument 提前注入。开了很久的窗口不刷新，以免打断正在用的人，
// 状态栏会提示手动按 Ctrl+R。每个窗口最多自动刷新一次。
const RELOAD_IF_YOUNGER_MS = 120000;
async function maybeReload(sess, target) {
  if (!assets.statusbar || sess.reloaded) return;
  const r = await sess.send('Runtime.evaluate', {
    expression: '(() => { const S = window.__agyStats; return { early: S ? S.early : null, age: performance.now() }; })()',
    returnByValue: true,
  });
  const v = r && r.result && r.result.value;
  if (!v || v.early !== false || v.age > RELOAD_IF_YOUNGER_MS) return;
  sess.reloaded = true;
  log(`reloading ${target.id.slice(0, 8)}: statusbar was injected late (page age ${Math.round(v.age / 1000)}s)`);
  await sess.send('Page.reload', {});
}

async function apply(sess) {
  const source = pageScript();
  if (sess.scriptId) {
    await sess.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sess.scriptId }).catch(() => {});
  }
  const r = await sess.send('Page.addScriptToEvaluateOnNewDocument', { source });
  sess.scriptId = r.identifier;
  await sess.send('Runtime.evaluate', { expression: source });
}
// 只换掉登记给“刷新后页面”的脚本，不在当前页面里重新执行（2026-11-22 加）。
// 登记的脚本里带着当时的 CFG（look.json 等），换了外观不重新登记的话，刷新窗口后要等下一次 30 秒同步才变回所选外观。
// 先登记新的再去掉旧的，中间不会出现没有脚本的空档。
async function reRegister(sess) {
  const r = await sess.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript() });
  if (sess.scriptId) await sess.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sess.scriptId }).catch(() => {});
  sess.scriptId = r.identifier;
}

// ---------- 调试端口参数（2026-11-19 加，Antigravity 2.33.0 起需要） ----------
// 2.33.0 起不带 --remote-debugging-port 启动就没有调试端口，本脚本连不上，汉化和状态栏都不出现。
// 安装时已给快捷方式加了参数（debug-port.ps1 add）。Antigravity 自动更新可能重写快捷方式，
// 所以找不到可用的端口时，每 2 分钟跑一次 debug-port.ps1 watch：参数没了就补回；
// Antigravity 正开着却没带参数（例如更新后自动重启，或从别的入口打开），就弹一次系统通知，每个进程只弹一次。
// 2026-11-20：Antigravity 没在运行时不再跑（原来关着时也每 2 分钟拉起一次 PowerShell，一次约 16 秒）。
// 判断依据：主进程开着时 %APPDATA%\Antigravity\lockfile 一直存在（Chromium 的单实例锁，被独占写打开）。
// 只看文件在不在，不去打开它，免得 Antigravity 启动的那一刻和它抢锁。
const PORT_SCRIPT = path.join(DIR, 'debug-port.ps1');
const LOCK_FILE = path.join(path.dirname(PORT_FILE), 'lockfile');
const WATCH_MS = 2 * 60 * 1000;
let watchAt = 0;
let watching = false;
let agySeen = null;
const notified = new Set();
const psArgs = (...a) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PORT_SCRIPT, ...a];
function watchDebugPortMac() {
  watching = true;
  watchAt = Date.now();
  execFile('ps', ['-axo', 'pid=,args='], { timeout: 10000 }, (err, out) => {
    watching = false;
    if (err) { log(`debug-port watch (macOS) failed: ${String(err.message).split('\n')[0]}`); return; }
    const lines = String(out).split(/\r?\n/);
    for (const line of lines) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const [, pid, cmd] = m;
      if (!cmd.includes('/Antigravity.app/Contents/MacOS/Antigravity')) continue;
      if (cmd.includes('--type=')) continue;
      if (/--remote-debugging-port(=|\s|$)/.test(cmd)) continue;
      if (notified.has(pid)) continue;
      notified.add(pid);
      log(`Antigravity pid=${pid} was started without --remote-debugging-port, showing a macOS notification`);
      const script = 'display notification "这次 Antigravity 启动时没带调试端口参数，请关闭后使用 macos/launch-agy.command 重新打开。" with title "Antigravity 汉化暂时没生效"';
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}
function watchDebugPort() {
  if (process.env.AGY_PORT_FILE || watching || Date.now() - watchAt < WATCH_MS) return;
  if (IS_MAC) { if (!PLUGIN) watchDebugPortMac(); return; }
  if (!IS_WIN || !fs.existsSync(PORT_SCRIPT)) return;
  const running = fs.existsSync(LOCK_FILE);
  if (running !== agySeen) { agySeen = running; log(running ? 'Antigravity lockfile present, debug-port watch on' : 'Antigravity not running (no lockfile), debug-port watch paused'); }
  if (!running) return;
  watching = true;
  watchAt = Date.now();
  execFile('powershell.exe', psArgs('-Mode', 'watch'), { windowsHide: true, timeout: 60000 }, (err, out) => {
    watching = false;
    if (err) { log(`debug-port watch failed: ${String(err.message).split('\n')[0]}`); return; }
    const lines = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const added = lines.filter((s) => s.startsWith('added'));
    if (added.length) log(`shortcut flag re-added: ${added.join(' | ')}`);
    for (const l of lines) {
      const m = /^nodebug=(\d+)$/.exec(l);
      if (PLUGIN || !m || notified.has(m[1])) continue; // 插件模式：由 sidecar 弹框（lib/relaunch.mjs）
      notified.add(m[1]);
      log(`Antigravity pid=${m[1]} was started without --remote-debugging-port, showing a notification`);
      spawn('powershell.exe', psArgs('-Mode', 'notify', '-Title', 'Antigravity 汉化暂时没生效',
        '-Text', '这次 Antigravity 启动时没带调试端口参数（多半是刚自动更新过）。关掉 Antigravity，再从开始菜单或桌面图标打开一次就好。'),
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  });
}

// 调试端口的情况：ok 能连上；since 这个状态从什么时候开始（给侧边栏面板和“没带调试端口就问要不要重开”用）
const portState = { ok: null, since: Date.now(), okAt: 0 };
function portSeen(ok) {
  if (ok) portState.okAt = Date.now();
  if (ok !== portState.ok) { portState.ok = ok; portState.since = Date.now(); }
}

// ---------- 主循环 ----------
async function tick() {
  const changed = loadAssets();
  if (changed && sessions.size) {
    log('style/i18n/statusbar files changed, updating open windows');
    for (const s of sessions.values()) apply(s).catch((e) => log(`update failed: ${e.message}`));
  }
  if (sessions.size && Date.now() - costSyncAt >= COST_SYNC_MS) {
    costSyncAt = Date.now();
    syncCost().catch(() => {});
  }
  if (!cliBusy && Date.now() - cliScanAt >= CLI_SCAN_MS) {
    cliScanAt = Date.now();
    scanCli().catch((e) => log(`cli usage scan failed: ${e.message}`));
  }
  if (sessions.size && !remoteBusy && Date.now() >= remoteNextAt && onlineOn()) checkRemote().catch((e) => log(`remote update failed: ${e.message}`));

  let port;
  try {
    port = fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0].trim();
  } catch { portSeen(false); watchDebugPort(); return; } // 应用没在运行，或这次启动没带调试端口参数
  if (!/^\d+$/.test(port)) { portSeen(false); return; }

  let targets;
  try {
    // 4 秒：电脑很忙时本机连接偶尔要 1 秒多（11-23 实测），原来 1.5 秒会把还开着的端口误判成连不上
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) });
    targets = await res.json();
  } catch { portSeen(false); watchDebugPort(); return; } // 端口文件是旧的，应用已退出
  portSeen(true);

  for (const t of targets) {
    if (t.type !== 'page' || !t.url.startsWith(URL_PREFIX) || sessions.has(t.id)) continue;
    connect(t);
  }
  fixStuckPanels(targets).catch((e) => log(`panel check failed: ${e.message}`));
}

// ---------- 插件面板停在 “plugin unavailable” 时重新加载（v2.0.3） ----------
// 插件重启（版本更新、覆盖安装、被结束）后，Antigravity 会重新打开插件面板：一个 iframe，地址是 plugin://agy-zh-pack--core-<面板端口>/。
// 打开的那一下如果没连上面板端口（插件还没开始监听，或者电脑很忙、本机连接一时变慢），Antigravity 就显示 “plugin unavailable”，
// 之后不会自己重试，要关掉面板再打开才好（11-23 Windows 上从 v2.0.0 更新到 v2.0.1 后遇到过）。
// 这里每次轮询时看一下我们的面板：页面里没有我们的内容就重新加载。正常的面板 30 秒看一次；
// 重新加载以后等 10 秒再看，没好就等 20、40、80、160 秒再试，最多 6 次；连不上 iframe 时 10 秒后再看。只管连着这次面板端口的 iframe（端口对不上的是旧的，Antigravity 会换掉）。
const PANEL_URL_RE = /^plugin:\/\/agy-zh-pack--[^/]*?-(\d+)\//;
const PANEL_CHECK_MS = 30e3;
const PANEL_MAX_TRIES = 6;
const panelChecks = new Map(); // iframe 的 targetId -> { at: 上次看的时间, tries: 已经重新加载了几次 }
let panelBusy = false;
async function fixStuckPanels(targets) {
  const port = globalThis.__agyZh && globalThis.__agyZh.panelPort; // 面板开始监听以后才有（lib/panel.mjs）
  if (!port || panelBusy) return;
  panelBusy = true;
  try {
    const seen = new Set();
    for (const t of targets) {
      const m = t.type === 'iframe' && t.webSocketDebuggerUrl ? PANEL_URL_RE.exec(String(t.url)) : null;
      if (!m) continue;
      seen.add(t.id);
      if (Number(m[1]) !== port) continue;
      const c = panelChecks.get(t.id) || { at: 0, tries: 0, failed: false };
      panelChecks.set(t.id, c);
      const wait = c.tries ? Math.min(10e3 * 2 ** (c.tries - 1), 160e3) : c.failed ? 10e3 : c.at ? PANEL_CHECK_MS : 0;
      if (Date.now() - c.at < wait) continue;
      c.at = Date.now();
      const v = await evalOnce(t.webSocketDebuggerUrl,
        `JSON.stringify({ ok: !!document.getElementById('s-run'), ready: document.readyState, text: (document.body ? document.body.innerText : '').trim().slice(0, 60) })`).catch(() => null);
      let s = null;
      try { s = typeof v === 'string' ? JSON.parse(v) : null; } catch {}
      c.failed = !isObj(s);
      if (c.failed) continue; // 连不上这个 iframe（本机连接一时变慢也会这样）：10 秒后再看
      if (s.ok) { c.tries = 0; continue; }
      if (s.ready !== 'complete') { c.failed = true; continue; } // 还在加载：10 秒后再看
      if (c.tries >= PANEL_MAX_TRIES) continue; // 已经试够了次数，不再重新加载
      c.tries++;
      log(`plugin panel is not showing the panel page (${JSON.stringify(s.text)}), reloading it (try ${c.tries})`);
      await evalOnce(t.webSocketDebuggerUrl, 'location.reload()').catch(() => {});
    }
    for (const id of panelChecks.keys()) if (!seen.has(id)) panelChecks.delete(id);
  } finally {
    panelBusy = false;
  }
}
// 连上一个页面（或 iframe），求值一个表达式就断开；5 秒没结果算失败
function evalOnce(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    let ws;
    const timer = setTimeout(() => { try { ws && ws.close(); } catch {} reject(Error('timeout')); }, 5000);
    try { ws = new WebSocket(wsUrl); } catch (e) { clearTimeout(timer); reject(e); return; }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
    };
    ws.onerror = () => { clearTimeout(timer); reject(Error('websocket error')); };
  });
}

function main() {
  loadAssets();
  loadRemoteCache();
  setTimeout(() => { backfillHistory().catch((e) => log(`usage backfill failed: ${e.message}`)); }, 15000); // 启动 15 秒后补算一次（每个版本只跑一次）
  const loop = async () => {
    try { await tick(); } catch (e) { log(`tick error: ${e.message}`); }
    setTimeout(loop, POLL_MS);
  };
  loop();
}

// ---------- 交给插件 sidecar 的状态和操作（v2.0） ----------
// sidecar（sidecars/core/main.mjs）和本脚本在同一个进程里；侧边栏面板、在线更新、代码更新都通过这里拿状态、做操作。
globalThis.__agyZh = {
  version: PACK_VERSION,
  dataDir: DATA,
  log,
  status: () => ({
    version: PACK_VERSION, plugin: PLUGIN, lockHeld, pid: process.pid,
    windows: sessions.size, port: { ...portState, file: PORT_FILE },
    online: onlineOn(), remote: remoteForPage(),
    i18n: !!assets.dict, statusbar: !!assets.statusbar, style: !!assets.css,
  }),
  // 在线更新：马上查一次
  checkRemoteNow: () => { remoteNextAt = 0; },
  // 在线更新开关（和 Theme 页的 updates 一样，存在 look.json）
  setOnline: (on) => {
    const l = readLook() || {};
    if ((l.online !== 'off') === !!on) return;
    saveLook({ ...l, online: on ? 'auto' : 'off', at: Date.now() });
    mergedCache = null;
    if (on) remoteNextAt = Date.now() + 1000;
    for (const s of sessions.values()) apply(s).catch(() => {});
  },
  // 从 Antigravity 页面里取一个文件（走 Antigravity 的网络和代理）；没有连上的窗口时抛错
  fetchText: async (url) => {
    const sess = [...sessions.values()].find((x) => x.ws && x.ws.readyState === 1 && x.scriptId);
    if (!sess) throw Error('no Antigravity window connected');
    return pageFetch(sess, url);
  },
  remoteBases: () => REMOTE_BASES.slice(),
  lastGoodBase: () => (remote.state && remote.state.host) || '',
};
