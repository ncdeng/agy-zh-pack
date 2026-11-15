// Antigravity 桌面版注入器：
//   - 样式（可选）：同目录有 style.css 才注入，没有就不改任何样式。公开的安装包不带 style.css；
//   - 汉化：界面英文换成中文（i18n\ 下的 translator.js + zh-CN.json 词典 + zh-CN.rules.json 规则）；
//   - 状态栏：输入框上方显示模型、上下文、token、首字时间、速度、额度（statusbar.js）。
//   - 可选：上下文上限。同目录 config.json 里的 contextLimit（默认没有这个文件 = 0 = 关闭）传给状态栏，
//     见 statusbar.js 开头的说明。一键安装包在安装时问一次，以后用“上下文开关.cmd”改。
//
// 原理：Antigravity 主进程启动时总会打开 Chromium 远程调试端口（端口号写在
// %APPDATA%\Antigravity\DevToolsActivePort）。本脚本常驻后台，每 3 秒检查一次：
//   - 发现主窗口页面后连上去，用 Page.addScriptToEvaluateOnNewDocument 登记注入脚本
//     （刷新、跳转都会自动重新加样式），并立刻在当前页面加上样式；
//   - style.css、statusbar.js、config.json 或 i18n\ 下的文件改动后，自动更新所有已连接的窗口；
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CSS_FILE = path.join(DIR, 'style.css');
const LOG_FILE = path.join(DIR, 'inject.log');
const PORT_FILE = process.env.AGY_PORT_FILE || path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort');
const URL_PREFIX = process.env.AGY_URL_PREFIX || 'https://127.0.0.1:';
const PIPE = '\\\\.\\pipe\\agy-claude-style' + (process.env.AGY_PORT_FILE ? '-test' : '');
const POLL_MS = 3000;
const STYLE_ID = 'agy-claude-style';

// ---------- 日志（超过 200 KB 就清空重写） ----------
try { if (fs.statSync(LOG_FILE).size > 200 * 1024) fs.writeFileSync(LOG_FILE, ''); } catch {}
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

// ---------- 单实例：占用一个命名管道，占不到说明已有实例在跑 ----------
const lock = net.createServer();
lock.on('error', () => process.exit(0));
lock.listen(PIPE, () => { log(`started pid=${process.pid}`); main(); });

// ---------- 要注入的文件：样式 + 汉化（词典、规则、翻译器） ----------
// 删掉或改名 i18n\zh-CN.json 就关闭汉化（已打开的窗口刷新后恢复英文）。
const FILES = {
  css: CSS_FILE,
  dict: path.join(DIR, 'i18n', 'zh-CN.json'),
  rules: path.join(DIR, 'i18n', 'zh-CN.rules.json'),
  translator: path.join(DIR, 'i18n', 'translator.js'),
  statusbar: path.join(DIR, 'statusbar.js'),
  config: path.join(DIR, 'config.json'), // 用户设置，可以没有
};
const JSON_KEYS = new Set(['dict', 'rules', 'config']);
const assets = { css: '', dict: null, rules: [], translator: '', statusbar: '', config: {} };
const EMPTY = { dict: null, rules: [], config: {} };

// 传给状态栏的设置。contextLimit 只接受 0（关闭）或 256001～1000000 之间的整数，其他值一律按 0 处理。
// costDay：今天花费的账本（见下面“今天花费的账本”）。
function barConfig() {
  const n = Math.floor(Number(assets.config && assets.config.contextLimit));
  return { contextLimit: n > 256000 && n <= 1000000 ? n : 0, costDay: readCostBook() };
}

// ---------- 今天花费的账本（2026-11-16 加） ----------
// 状态栏把每个对话今天的花费记在页面的 window.__agyStats.costBook（{ day, by: { 对话 ID: 美元 } }）。
// 页面的本地存储按端口分开，Antigravity 每次启动都换端口，存在页面里的账本会丢；后台重启后对话摘要里也只剩打开过的对话。
// 所以注入程序每 30 秒把页面里的账本读出来，合并进同目录的 cost-day.json（同一个对话取较大的数，换了一天就清空），
// 注入时再交给状态栏。只存对话 ID 和金额。
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
  if (!costBook || costBook.day !== dayName() || !costBook.by || typeof costBook.by !== 'object') costBook = { day: dayName(), by: {} };
  return costBook;
}
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
  if (!changed) return;
  try { fs.writeFileSync(COST_FILE, JSON.stringify(book)); } catch (e) { log(`write cost-day.json failed: ${e.message}`); }
}
// 今天动过的对话：Antigravity 把每个对话存在 %USERPROFILE%\.gemini\antigravity\brain\<对话 ID>\，
// 对话记录 .system_generated\logs\transcript.jsonl 的修改时间在本地 0 点以后，就算今天动过。
// 交给状态栏（window.__agyStats.todayIds），它会向本机后台查这些对话的调用记录（后台没加载的会顺便加载，
// 加载不改对话的修改时间）。这样 Antigravity 重启后，今天早些时候的对话也能算进来。
const BRAIN_DIR = path.join(process.env.USERPROFILE || '', '.gemini', 'antigravity', 'brain');
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
async function syncCost() {
  const ids = JSON.stringify(todayConversations());
  for (const s of sessions.values()) {
    try {
      const r = await s.send('Runtime.evaluate', {
        expression: `(() => { const S = window.__agyStats; if (!S) return null; S.todayIds = ${ids}; return JSON.stringify(S.costBook || null); })()`,
        returnByValue: true,
      });
      const v = r && r.result && r.result.value;
      if (v) mergeCostBook(JSON.parse(v));
    } catch { /* 窗口刚关或还没注入：下次再读 */ }
  }
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
      if (key === 'config') assets.config = {}; // 设置文件写坏了就按默认（关闭）处理
    }
    if (key === 'config') log(`config: contextLimit=${barConfig().contextLimit}`);
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

// 状态栏的 fetch 包装要在应用脚本之前装好，用量信息（和打开时的 512K 上下文）才生效。注入器连上时如果窗口已经加载完
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

// ---------- 主循环 ----------
async function tick() {
  const changed = loadAssets();
  if (changed && sessions.size) {
    log('style/i18n/config files changed, updating open windows');
    for (const s of sessions.values()) apply(s).catch((e) => log(`update failed: ${e.message}`));
  }
  if (sessions.size && Date.now() - costSyncAt >= COST_SYNC_MS) {
    costSyncAt = Date.now();
    syncCost().catch(() => {});
  }

  let port;
  try {
    port = fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0].trim();
  } catch { return; } // 应用没在运行
  if (!/^\d+$/.test(port)) return;

  let targets;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    targets = await res.json();
  } catch { return; } // 端口文件是旧的，应用已退出

  for (const t of targets) {
    if (t.type !== 'page' || !t.url.startsWith(URL_PREFIX) || sessions.has(t.id)) continue;
    connect(t);
  }
}

function main() {
  loadAssets();
  const loop = async () => {
    try { await tick(); } catch (e) { log(`tick error: ${e.message}`); }
    setTimeout(loop, POLL_MS);
  };
  loop();
}
