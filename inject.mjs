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
// 测试用环境变量：AGY_PORT_FILE（端口文件路径）、AGY_URL_PREFIX（要注入的页面地址前缀）。

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const CSS_FILE = path.join(DIR, 'style.css');
const LOG_FILE = path.join(DIR, 'inject.log');
const DEFAULT_PORT_FILE = IS_WIN
  ? path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort')
  : IS_MAC
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Antigravity', 'DevToolsActivePort');
const PORT_FILE = process.env.AGY_PORT_FILE || DEFAULT_PORT_FILE;
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

// ---------- 单实例：占用命名管道（Windows）或 Unix Socket（macOS/Linux），占不到说明已有实例在跑 ----------
const lock = net.createServer();
function onListening() {
  log(`started pid=${process.pid} platform=${process.platform}`);
  if (!IS_WIN) {
    const cleanup = () => {
      try { lock.close(); } catch {}
      try { fs.rmSync(PIPE, { force: true }); } catch {}
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
  main();
}
if (IS_WIN) {
  lock.on('error', () => process.exit(0));
  lock.listen(PIPE, onListening);
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
          lock.listen(PIPE, onListening);
        } else {
          process.exit(0);
        }
      });
      return;
    }
    process.exit(0);
  });
  lock.listen(PIPE, onListening);
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
  return { costDay: readCostBook(), history: recentHistory(), look: readLook() };
}

// ---------- 状态栏外观（2026-11-22 加） ----------
// look.json：{ pal 配色, skin 外形, bar 进度条, dense 信息密度, icons 图标, at 选择时间 }。
// 用户在每日用量面板的 Theme 页里选，页面记在 window.__agyStats.lookPick（页面的本地存储按端口分开，每次启动都换端口，存不住）；
// 注入程序每 30 秒读回来存进这个文件，再推给其他窗口（S.setLook(look, true)）；新注入时通过 CFG.look 交给状态栏。
// 选项的取值由状态栏校验（cleanLook），这里只挑出这几个字段、限制长度。
const LOOK_FILE = path.join(DIR, 'look.json');
let lookCache;
function readLook() {
  if (lookCache === undefined) {
    try { lookCache = JSON.parse(fs.readFileSync(LOOK_FILE, 'utf8')); } catch { lookCache = null; }
  }
  return lookCache;
}
function saveLook(pick) {
  const keep = {};
  for (const k of ['pal', 'skin', 'bar', 'dense']) if (typeof pick[k] === 'string') keep[k] = pick[k].slice(0, 24);
  if (typeof pick.icons === 'boolean') keep.icons = pick.icons;
  keep.at = +pick.at || Date.now();
  lookCache = keep;
  try { fs.writeFileSync(LOOK_FILE, JSON.stringify(keep)); log(`look saved: ${keep.pal} / ${keep.skin} / ${keep.bar} / ${keep.dense}`); }
  catch (e) { log(`write look.json failed: ${e.message}`); }
}

// ---------- 今天花费的账本（2026-11-16 加） ----------
// 状态栏把每个对话今天的花费记在页面的 window.__agyStats.costBook（{ day, by: { 对话 ID: 美元 } }）。
// 页面的本地存储按端口分开，Antigravity 每次启动都换端口，存在页面里的账本会丢；后台重启后对话摘要里也只剩打开过的对话。
// 所以注入程序每 30 秒把页面里的账本读出来，合并进同目录的 cost-day.json（同一个对话取较大的数，换了一天就清空），
// 注入时再交给状态栏。只存对话 ID、金额和按模型的调用数、token 数（det，2026-11-20 加）。
const COST_FILE = path.join(DIR, 'cost-day.json');
const COST_SYNC_MS = 30000;
const dayName = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
let costBook = null;
function readCostBook() {
  if (!costBook) {
    try { costBook = JSON.parse(fs.readFileSync(COST_FILE, 'utf8')); } catch { costBook = null; }
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
  try { fs.writeFileSync(COST_FILE, JSON.stringify(book)); } catch (e) { log(`write cost-day.json failed: ${e.message}`); }
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
let costSyncAt = 0;
// 每次同步：交给页面今天动过的对话和最近 31 天的历史，读回页面的账本和额度，再更新历史
const QUOTA_EXPR = `S.quota && Array.isArray(S.quota.groups) ? { at: S.quota.at, buckets: S.quota.groups.flatMap((g) => (g.buckets || []).map((b) =>
  ({ id: b.bucketId, w: b.window, rf: b.remainingFraction, reset: b.resetTime, dis: b.disabled, name: g.displayName }))) } : null`;
async function syncCost() {
  const ids = JSON.stringify(todayConversations());
  const hist = JSON.stringify(recentHistory());
  const look = readLook();
  const lookJs = JSON.stringify(look);
  let quota = null;
  let pick = null;
  let any = false;
  for (const s of sessions.values()) {
    try {
      const r = await s.send('Runtime.evaluate', {
        expression: `(() => { const S = window.__agyStats; if (!S) return null; S.todayIds = ${ids}; S.history = ${hist};
          if (S.setLook && ${lookJs}) S.setLook(${lookJs}, true);
          return JSON.stringify({ book: S.costBook || null, quota: ${QUOTA_EXPR}, pick: S.lookPick || null }); })()`,
        returnByValue: true,
      });
      const v = r && r.result && r.result.value;
      if (!v) continue;
      const o = JSON.parse(v);
      any = true;
      if (o.book) mergeCostBook(o.book);
      if (o.quota && (!quota || o.quota.at > quota.at)) quota = o.quota;
      if (o.pick && o.pick.at > 0 && (!pick || o.pick.at > pick.at)) pick = o.pick;
    } catch { /* 窗口刚关或还没注入：下次再读 */ }
  }
  if (any) updateHistory(readCostBook(), quotaBuckets(quota));
  // 某个窗口里换了外观：存下来，马上推给其他窗口，并更新登记给刷新后页面的脚本（见 reRegister）
  if (pick && pick.at > ((look && look.at) || 0)) {
    saveLook(pick);
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
// usage-history.json：{ v: 1, days: { 'YYYY-MM-DD': { usd, convs, models, quota } } }，保留 90 天，只存数字，不存对话内容。
//   models：{ 价目名: [美元, 调用数, 输入, 缓存读, 缓存写, 输出] }，由当天账本的 det 合计而来；
//   quota：{ 桶 ID: { n 组名, w 窗口, l 最近一次的已用比例, u 当天用掉的（只累计上涨）, m 当天最高, r 重置时间（毫秒） } }，比例 0～1。
// 状态栏的每日用量面板显示 u。（v1.4.0 的格式是 f 起点 / a 已累计，u = a + l − f；见 migrateQuota。）
const HISTORY_FILE = path.join(DIR, 'usage-history.json');
const HISTORY_KEEP_DAYS = 90;
const HISTORY_PUSH_DAYS = 31;
let history = null;
let historyJson = '';
function readHistory() {
  if (!history) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { history = null; }
    if (!history || !history.days || typeof history.days !== 'object') history = { v: 2, days: {} };
    historyJson = JSON.stringify(history);
    // liveFrom：从哪一天起是注入程序实时记的；更早的天数只能补算（见下面“补算以前的用量”）
    if (!history.liveFrom) history.liveFrom = Object.keys(history.days).filter((k) => !history.days[k].bf).sort()[0] || dayName();
    if (!(history.v >= 2)) migrateHistory(history); // 换算后下次 saveHistory 会写回文件
  }
  return history;
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
  try { fs.writeFileSync(HISTORY_FILE, json); } catch (e) { log(`write usage-history.json failed: ${e.message}`); }
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;
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
// 记一次额度观察。u = 当天用掉的部分 = 每个周期里“当天最后的值 − 当天开始时的值”之和。
//   s：这一段（当天、同一个周期）开始时的已用比例；c：当天前面几段（换周期以前）已经结算的用量；u = c + max(0, l − s)。
// 2026-11-22 改（v1.4.1 的“只累计上涨”会多算）：已用比例在同一个周期里会来回起伏，不只是往下降。
//   实测：同一个周期、正在生成回复，6 分钟里 Gemini 每周额度 1.699% → 1.594%、5 小时额度 1.907% → 1.487%；
//   11-22 这一天每周额度最高 3.93%、最后 1.53%，只累计上涨记成了 +7.07%（状态栏显示只用了 2%）。
//   原因没有官方说法（可能是请求开始时先按估算扣、结束后按实际退回）；按净变化算，起伏不会被重复计算。
// 换周期：重置时间前后差 1 小时以上（没用过的桶重置时间是“现在 + 7 天 / 5 小时”，跟着时间走，
//   Antigravity 关着超过 1 小时再打开也会判成换周期，那时前后都是 0，不影响结果）。
// 当天第一次见到某个桶：前面有记录、还在同一个周期里，就从那条记录最后的值接着算（中间没观察到的部分算到今天）；
//   周期已经换了就从 0 算；以前从没见过就从现在的值算（看不到之前用了多少）。
// v1.4.0 旧格式（f 起点 / a 已累计）和 v1.4.1 的格式（只有 u）在 migrateHistory 里一次性换算。
const migrateQuota = (q) => (+q.f === 0 && +q.a > 0 ? +q.a : Math.max(0, (+q.m || 0) - (+q.f || 0)) + (+q.a || 0));
const samePeriod = (r1, r2) => Math.abs((+r1 || 0) - (+r2 || 0)) < 3600e3;
function noteQuota(day, buckets, prev) {
  if (!day.quota || typeof day.quota !== 'object') day.quota = {};
  for (const b of buckets) {
    let q = day.quota[b.id];
    if (!q) {
      const p = prev(b.id);
      const s = p ? (samePeriod(p.r, b.reset) ? +p.l || 0 : 0) : b.used;
      q = day.quota[b.id] = { n: b.name, w: b.w, l: r4(b.used), m: r4(b.used), r: b.reset, s: r4(s), c: 0 };
    } else {
      if (q.s === undefined) { q.s = r4(Math.max(0, (+q.l || 0) - (+q.u || 0))); q.c = 0; } // 迁移漏掉的旧记录：保持原来的 u
      if (!samePeriod(q.r, b.reset)) { q.c = r4((+q.c || 0) + Math.max(0, (+q.l || 0) - q.s)); q.s = 0; } // 换周期：上一段结算，新一段从 0 起
    }
    q.l = r4(b.used);
    q.u = r4((+q.c || 0) + Math.max(0, q.l - q.s));
    q.m = r4(Math.max(+q.m || 0, b.used));
    q.r = b.reset;
    if (b.name) q.n = b.name;
    if (b.w) q.w = b.w;
  }
}
function updateHistory(book, buckets) {
  const h = readHistory();
  const today = book.day;
  const day = h.days[today] || (h.days[today] = {});
  const s = summarizeBook(book);
  if (!(day.usd > s.usd)) Object.assign(day, s); // 文件里今天的数更大（账本被重置过）就保留文件里的
  if (buckets && buckets.length) noteQuota(day, buckets, (id) => prevQuota(h, today, id));
  const keys = Object.keys(h.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_KEEP_DAYS))) delete h.days[k];
  saveHistory();
}
function recentHistory() {
  const h = readHistory();
  const days = {};
  for (const k of Object.keys(h.days).sort().slice(-HISTORY_PUSH_DAYS)) days[k] = h.days[k];
  return { at: Date.now(), days };
}

// ---------- 补算以前的用量（2026-11-20 加） ----------
// 实时记录从 liveFrom 那天才开始。更早的天数从 Antigravity 自己的对话库补算（只读打开，不写）：
//   ~/.gemini/antigravity/conversations/<对话 ID>.db（Windows 是 %USERPROFILE%\.gemini\...，macOS 是 /Users/<用户名>/.gemini/...），每个对话一个 SQLite 库。
//   gen_metadata 表每行是一次模型调用（protobuf）：字段 4 = executionId，1.19 = 模型名，
//     1.4 = token 用量（1.4.2 输入、1.4.3 输出含思考、1.4.4 缓存写入、1.4.5 缓存读取、1.4.9 思考、1.4.10 回复、1.4.11 请求 ID）；
//   steps 表的 metadata（protobuf）：字段 1 = 创建时间（Timestamp，1 = 秒），12 = executionId。
//   两张表按 executionId 对上，得到每次调用的时间、模型和 token。一个 executionId 里可能调用好几次，所以按请求 ID 去重
//   （子代理的调用可能在两个库里都有），没有请求 ID 才用 executionId + token 数。
// 按本地日期归到 liveFrom 之前的每一天，存成那一天的 raw = { 模型名: [调用数, 输入, 缓存读, 缓存写, 输出] }，
// 钱由状态栏按它的价目表算（价目表只放在 statusbar.js 一处）。只跑一次，结果记在 history.bf；删掉 bf 再重启注入程序会重新补算。
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
const dayOf = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
// 读一个对话库，把 before（不含）之前的调用加进 acc：{ 日期: { raw, convs: Set } }；返回 { calls, nodate }
function readConvDb(DatabaseSync, file, before, seen, acc) {
  const db = new DatabaseSync(file, { readOnly: true });
  let calls = 0, nodate = 0;
  try {
    const when = new Map();
    for (const r of db.prepare('select metadata from steps').iterate()) {
      if (!r.metadata) continue;
      const m = Buffer.from(r.metadata);
      const exec = pbGet(m, 12), ts = pbGet(m, 1);
      if (!Buffer.isBuffer(exec) || !Buffer.isBuffer(ts)) continue;
      const id = exec.toString('utf8');
      const sec = pbGet(ts, 1);
      if (!when.has(id) && sec > 0) when.set(id, sec * 1000);
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
      const at = when.get(id);
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
async function backfillHistory() {
  const h = readHistory();
  if (h.bf) return;
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { h.bf = { at: Date.now(), err: 'node:sqlite not available' }; saveHistory(); return; }
  let names = [];
  try { names = fs.readdirSync(CONV_DIR).filter((n) => /^[0-9a-f-]{36}\.db$/.test(n)); } catch {}
  const seen = new Set();
  const acc = {};
  let dbs = 0, calls = 0, nodate = 0, errors = 0;
  for (const n of names) {
    try {
      const r = readConvDb(DatabaseSync, path.join(CONV_DIR, n), h.liveFrom, seen, acc);
      calls += r.calls; nodate += r.nodate; dbs++;
    } catch { errors++; }
    await new Promise((r) => setImmediate(r)); // 每读完一个库让出一下，别长时间占住事件循环
  }
  let daysAdded = 0;
  for (const [day, d] of Object.entries(acc)) {
    if (day >= h.liveFrom || (h.days[day] && !h.days[day].bf)) continue;
    h.days[day] = { bf: 1, convs: d.convs.size, raw: d.raw };
    daysAdded++;
  }
  h.bf = { at: Date.now(), dbs, calls, nodate, errors, days: daysAdded };
  log(`usage backfill: ${dbs}/${names.length} conversation dbs, ${calls} calls before ${h.liveFrom}, ${daysAdded} days` +
    (nodate ? `, ${nodate} calls without time` : '') + (errors ? `, ${errors} dbs failed` : ''));
  const keys = Object.keys(h.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_KEEP_DAYS))) delete h.days[k];
  saveHistory();
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
      const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); // 去掉 UTF-8 BOM
      assets[key] = JSON_KEYS.has(key) ? JSON.parse(text) : text;
    } catch (e) {
      log(`read ${path.basename(file)} failed: ${e.message}`);
    }
  }
  return changed;
}
function pageScript() {
  // 在页面里执行：建一个固定 id 的 <style>，已有就只更新内容；再启动或更新翻译器
  const i18n = assets.dict && assets.translator
    ? `try { (${assets.translator})(${JSON.stringify(assets.dict)}, ${JSON.stringify(assets.rules || [])}); } catch (e) { console.warn('agy i18n', e); }`
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

// ---------- 与单个页面的 CDP 连接 ----------
const sessions = new Map(); // targetId -> { ws, send, scriptId }

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
    const p = m.id && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  };
  ws.onopen = async () => {
    try {
      await send('Page.enable'); // 不开 Page 域，addScriptToEvaluateOnNewDocument 在刷新后不生效（测试过）
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
  if (IS_MAC) { watchDebugPortMac(); return; }
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
      if (!m || notified.has(m[1])) continue;
      notified.add(m[1]);
      log(`Antigravity pid=${m[1]} was started without --remote-debugging-port, showing a notification`);
      spawn('powershell.exe', psArgs('-Mode', 'notify', '-Title', 'Antigravity 汉化暂时没生效',
        '-Text', '这次 Antigravity 启动时没带调试端口参数（多半是刚自动更新过）。关掉 Antigravity，再从开始菜单或桌面图标打开一次就好。'),
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  });
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

  let port;
  try {
    port = fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0].trim();
  } catch { watchDebugPort(); return; } // 应用没在运行，或这次启动没带调试端口参数
  if (!/^\d+$/.test(port)) return;

  let targets;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    targets = await res.json();
  } catch { watchDebugPort(); return; } // 端口文件是旧的，应用已退出

  for (const t of targets) {
    if (t.type !== 'page' || !t.url.startsWith(URL_PREFIX) || sessions.has(t.id)) continue;
    connect(t);
  }
}

function main() {
  loadAssets();
  setTimeout(() => { backfillHistory().catch((e) => log(`usage backfill failed: ${e.message}`)); }, 15000); // 启动 15 秒后补算一次（只跑一次）
  const loop = async () => {
    try { await tick(); } catch (e) { log(`tick error: ${e.message}`); }
    setTimeout(loop, POLL_MS);
  };
  loop();
}
