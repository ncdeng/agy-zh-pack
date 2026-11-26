// 验收探针（维护用，2026-11-25 加）：经调试端口连上正在运行的 Antigravity，像人一样打开面板、读界面上的文字和悬停说明、
// 截图、调插件面板的接口。单元测试（tests/）只管函数算得对不对；这里看功能在真的 Antigravity 里有没有显示出来、显示得对不对。
//
//   node tools/dev/probe.mjs <命令> [参数] [--shot <目录>] [--ssh <主机>] [--port-file <DevToolsActivePort 文件>]
//
// 命令：
//   all                 发版前用：依次跑 status、plugin、bar、panel、calls（都是只读的），最后列出每项 OK / WARN / FAIL
//   plugin              插件面板（agy-zh）本身：顶部状态、横幅、“今天”四个格子和当前对话、状态栏预览（只在关掉状态栏时有）、最近 7 天、设置项的开关、“高级”的摘要（要先打开插件面板）
//   status              插件面板接口：版本、最新版本、完整性、在线更新、没翻译的文字条数（要先打开插件面板：右上角插件菜单 → agy-zh）
//   missing             插件面板接口：列出记下的没翻译的界面文字（补词典用）
//   check               插件面板的“立即检查”，15 秒后再读一次 status
//   update [版本]        插件面板的“更新”：装最新版（或指定版本），20 秒后再读一次 status。会换掉插件文件
//   bar                 状态栏每一项的文字和悬停说明的第一行
//   panel               打开每日用量面板：KPI、今天那一行、底部几行（花费、缓存没命中、每周额度）和悬停说明
//   calls [日子|most]   打开某一天的调用明细（默认今天；日子写 11-22 或 2026-11-22；most = 调用最多的那天）：
//                       合计、筛选按钮、很贵的调用和缓存没命中各几行、第一条没命中的说明
//   speed               每日用量面板的 speed 页（30 天速度走势：图里几条线、多少个点，表里每个模型的速度）和今天调用明细的 by model（v2.0.15）
//   miss                点每日面板底部的 “cache miss today” 进今天的明细（只看没命中的），读合计和一条说明
//   ckpt                点状态栏上的压缩徽章 ↻N×，读压缩查看器
//   english             在屏幕外放一个测试文字，合成 Ctrl+Alt+E 切到英文、再切回中文（屏幕上会闪两次提示）
//   english-scan        列出主窗口里还是英文的界面文字（跳过对话内容、代码、输入框、插件自己的界面）
//   swarm               列出 Swarm 面板框架里看得见的英文文字（要先打开 Swarm 面板）
//   eval <表达式>        在主窗口里求值并打印结果（调试用）
//
//   --shot <目录>    plugin / panel / calls / speed / miss / ckpt / bar 顺便截图，存成 <目录>/<win|mac>-<命令>.png
//   --ssh <主机>     在另一台 macOS 上跑：把这个脚本复制到对方的 /tmp，用 Antigravity 自带的 Node（ELECTRON_RUN_AS_NODE）运行；
//                    有 --shot 时把截图拷回本机的那个目录。需要能免密 ssh / scp 到那台电脑
//   --port-file      DevToolsActivePort 文件的位置（默认：Windows 在 %APPDATA%\Antigravity\，macOS 在 ~/Library/Application Support/Antigravity/）
//
// 除了 check、update、english，都是只读的：只打开、关闭面板（用完按 Esc 关掉），不改设置和数据。
// Antigravity 要带 --remote-debugging-port=0 启动（插件的“带参数重启”就是这个）。
// 打印的内容里有对话标题和花费，只在终端里显示，不写进仓库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const takeOpt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const SSH = takeOpt('--ssh');
const SHOT = takeOpt('--shot');
const PORT_FILE = takeOpt('--port-file') || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort'));
const [CMD, ...ARGS] = argv;
const PLAT = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
const MAC_NODE = '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(...a);

// ---------- 在另一台 macOS 上跑 ----------
if (SSH) {
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const REMOTE = '/tmp/agy-probe.mjs', RSHOT = '/tmp/agy-probe-shots';
  let r = spawnSync('scp', ['-q', SELF, `${SSH}:${REMOTE}`], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('复制脚本到 ' + SSH + ' 失败'); process.exit(1); }
  const rest = argv.concat(SHOT ? ['--shot', RSHOT] : []);
  const cmd = (SHOT ? `mkdir -p ${RSHOT} && ` : '') + `cd /tmp && ELECTRON_RUN_AS_NODE=1 ${q(MAC_NODE)} ${REMOTE} ${rest.map(q).join(' ')}`;
  r = spawnSync('ssh', [SSH, cmd], { encoding: 'utf8', maxBuffer: 64 << 20 });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (SHOT) {
    fs.mkdirSync(SHOT, { recursive: true });
    for (const m of (r.stdout || '').matchAll(/^shot (\/tmp\/agy-probe-shots\/[\w.-]+\.png)$/gm)) {
      const local = path.join(SHOT, path.basename(m[1]));
      if (spawnSync('scp', ['-q', `${SSH}:${m[1]}`, local]).status === 0) say('copied ' + local);
    }
  }
  process.exit(r.status == null ? 1 : r.status);
}

// ---------- 连调试端口 ----------
async function targets() {
  let port;
  try { port = fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0].trim(); } catch { throw Error('读不到 ' + PORT_FILE + '：Antigravity 没开，或者没带 --remote-debugging-port=0 启动'); }
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}
const isMain = (t) => t.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\//.test(t.url);
const isPluginPanel = (t) => t.type === 'iframe' && t.url.startsWith('plugin://agy-zh-pack');
const isSwarm = (t) => t.type === 'iframe' && t.url.startsWith('plugin://swarm');
async function connect(pred, what) {
  const t = (await targets()).find(pred);
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(Error('连不上' + what)); });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) throw Error('页面里出错：' + ((ex.exception && ex.exception.description) || ex.text));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { ev, send, close: () => ws.close() };
}
async function main() {
  const c = await connect(isMain, ' Antigravity 主窗口');
  if (!c) throw Error('没找到 Antigravity 主窗口');
  return c;
}
// 每隔 step 毫秒在页面里求一次 expr，直到结果为真或超时；返回最后一次的结果
async function until(c, expr, ms, step = 500) {
  const end = Date.now() + ms;
  let v;
  while (!(v = await c.ev(expr)) && Date.now() < end) await wait(step);
  return v;
}
// 截某个元素所在的区域（最高 maxH 像素）。截图坐标是设备无关像素，页面坐标要乘 Antigravity 的界面缩放：
// 缩放 = outerWidth / innerWidth（Windows 上实测 2560 / 2133 = 1.2；Mac 上 1.0）。不能用 devicePixelRatio 或
// getLayoutMetrics 的 layoutViewport，它们还乘了屏幕缩放（Retina 是 2），在 Mac 上截出来的位置会偏
async function shot(c, sel, name, maxH = 640) {
  if (!SHOT) return;
  const r = await c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: Math.min(b.height, ${maxH}), k: Math.round(window.outerWidth / window.innerWidth * 100) / 100 }; })()`);
  if (!r) return;
  const k = r.k > 0.3 && r.k < 5 ? r.k : 1;
  const s = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x * k, y: r.y * k, width: r.w * k, height: r.h * k, scale: 1 } });
  if (!s.result || !s.result.data) return;
  fs.mkdirSync(SHOT, { recursive: true });
  const file = path.join(SHOT, PLAT + '-' + name + '.png').replace(/\\/g, '/');
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  say('shot ' + file);
}

// ---------- 用量面板 ----------
const PANEL = '.agy-usage-panel';
const closePanel = (c) => c.ev(`(() => { if (document.querySelector('${PANEL}')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
// 从每日用量页开始：开着别的页（例如压缩查看器）就先关掉再开。状态栏上的压缩徽章也带 p-open，要跳过
async function openPanel(c) {
  await closePanel(c);
  await wait(300);
  const r = await c.ev(`(() => { const o = document.querySelector('.agy-usage-bar .p-open:not(.comp)'); if (!o) return false; o.click(); return true; })()`);
  if (!r) throw Error('状态栏上没有今天花费那一项（打开一个对话再试）');
  if (!(await until(c, `!!document.querySelector('${PANEL} .p-foot')`, 10000))) throw Error('每日用量面板没打开');
}
const tipHead = (n) => `((e) => (e && e.getAttribute('data-agy-tip') || '').split('\\n').map((l) => l.trim()).filter(Boolean).slice(0, ${n}).join(' / '))`;
// 调用明细打开以后：等表格出来（第一次取可能要几十秒），读合计、筛选按钮、各种行数
async function readCalls(c, ms = 120000) {
  const ok = await until(c, `(() => { const p = document.querySelector('${PANEL}'); if (!p) return false; const st = p.querySelector('.p-empty'); return p.querySelectorAll('.p-table.calls tbody tr').length > 0 || (st && !st.hidden && /no calls|failed/.test(st.textContent)); })()`, ms, 1000);
  if (!ok) return null;
  return c.ev(`(() => {
    const p = document.querySelector('${PANEL}');
    const sum = p.querySelector('.p-range');
    const st = p.querySelector('.p-empty');
    const miss = p.querySelectorAll('.p-table.calls td.h.miss');
    return { title: (p.querySelector('.p-title') || {}).textContent, sum: sum && sum.textContent, sumTip: ${tipHead(3)}(sum),
      tools: [...p.querySelectorAll('.p-tools .p-btn')].map((b) => (b.classList.contains('on') ? '*' : '') + b.textContent).join(' | '),
      rows: p.querySelectorAll('.p-table.calls tbody tr').length, costly: p.querySelectorAll('.p-table.calls td.c.costly').length, miss: miss.length,
      missTip: miss[0] ? miss[0].getAttribute('data-agy-tip') : '', empty: st && !st.hidden ? st.textContent : '', note: (p.querySelector('.p-note') || {}).textContent || '' };
  })()`);
}
function printCalls(v) {
  say('  ' + v.title + ' · ' + v.sum);
  if (v.sumTip) say('  合计悬停：' + v.sumTip);
  say('  筛选：' + v.tools);
  say(`  表格 ${v.rows} 行，很贵的 ${v.costly} 行，缓存没命中 ${v.miss} 行` + (v.empty ? '；' + v.empty : ''));
  if (v.missTip) say('  第一条没命中：' + v.missTip.replace(/\n/g, ' / '));
  if (v.note) say('  说明：' + v.note);
}

// ---------- 命令 ----------
const CMDS = {};

// 插件面板（agy-zh）里调它自己的接口：页面地址带 ?token=…，接口要带这个令牌
async function pluginApi(p, body) {
  const c = await connect(isPluginPanel, '插件面板');
  if (!c) throw Error('没找到插件面板：先打开 Antigravity 右上角的插件菜单 → agy-zh');
  const hdr = `{ 'Content-Type': 'application/json', 'x-sidecar-token': new URLSearchParams(location.search).get('token') }`;
  const init = body ? `{ method: 'POST', headers: ${hdr}, body: ${JSON.stringify(JSON.stringify(body))} }` : `{ headers: ${hdr} }`;
  try { return await c.ev(`fetch(${JSON.stringify(p)}, ${init}).then(async (r) => ({ status: r.status, text: await r.text() }))`); } finally { c.close(); }
}
async function statusObj() {
  const r = await pluginApi('/api/status');
  if (r.status !== 200) throw Error('插件面板接口返回 ' + r.status);
  return JSON.parse(r.text);
}
CMDS.status = async () => {
  const o = await statusObj();
  const u = o.update || {}, rm = (o.st && o.st.remote) || {};
  say(`  版本 ${u.current}，最新 ${u.latest}${u.available ? '（有新版本）' : ''}；上次安装：${u.state ? u.state.status + ' ' + (u.state.version || '') + (u.state.from ? '（从 ' + u.state.from + '）' : '') : '—'}`);
  say(`  完整性：${u.integrity ? u.integrity.status + (u.integrity.changed && u.integrity.changed.length ? '，不一致的文件 ' + u.integrity.changed.join(', ') : '') : '—'}`);
  say(`  在线更新：${rm.on === false ? '关闭' : '开'}，${rm.st && rm.st.host ? '上次从 ' + rm.st.host : '还没检查成功过'}${rm.st && rm.st.err ? '，问题：' + rm.st.err : ''}；没翻译的文字 ${o.missing ? o.missing.count : '—'} 条`);
  const ok = u.integrity && u.integrity.status === 'ok' && !u.available;
  return { ok: ok ? 'OK' : 'WARN', note: ok ? 'v' + u.current : (u.available ? '有新版本 v' + u.latest : '完整性 ' + (u.integrity ? u.integrity.status : '?')) };
};
CMDS.missing = async () => {
  const r = await pluginApi('/api/status');
  const m = JSON.parse(r.text).missing;
  if (!m) { say('  这个版本的插件没有记录没翻译的文字'); return { ok: 'WARN' }; }
  say(`  ${m.count} 条（文件 ${m.file}），最近见到的 ${m.items.length} 条：`);
  for (const e of m.items) say(`  ${String(e.n).padStart(4)}× ${JSON.stringify(e.t)}`);
  return { ok: 'OK', note: m.count + ' 条' };
};
// 插件面板（v2.0.15 起的页面）：读各块的文字，开关和分段按钮读当前选中的；截图截整个面板（iframe 自己截，不用算缩放）
CMDS.plugin = async () => {
  const c = await connect(isPluginPanel, '插件面板');
  if (!c) throw Error('没找到插件面板：先打开 Antigravity 右上角的插件菜单 → agy-zh');
  try {
    const v = await until(c, `(() => { const n = document.getElementById('s-now'); if (!n || !n.textContent.trim()) return null;
      const q = (s) => [...document.querySelectorAll(s)], tx = (e) => (e ? e.textContent.trim() : '');
      return { pill: tx(document.getElementById('pill')), banners: q('.banner .t b').map(tx), conv: [tx(n.querySelector('.conv .ttl')), tx(n.querySelector('.conv .run'))].filter(Boolean).join(' · '), nums: tx(n.querySelector('.conv .nums')),
        barRows: n.querySelectorAll('.sbwrap .ln').length, barCss: document.getElementById('barcss').textContent.length, noicons: !!n.querySelector('.sbwrap.noicons'),
        tiles: q('#s-now .tile').map((e) => (e.classList.contains('warn') ? '[黄] ' : '') + tx(e.querySelector('.k')) + ' ' +
          (e.querySelector('.v') ? tx(e.querySelector('.v')) : [...e.querySelectorAll('.q2 > *')].map(tx).filter(Boolean).join(' '))), empty: tx(n.querySelector('.empty')),
        week: q('#s-week .week button').length, wsum: tx(document.querySelector('#s-week .wsum')),
        items: q('#s-set .item').map((e) => { const w = e.querySelector('.sw'), g = e.querySelector('.seg button.on');
          return tx(e.querySelector('.tx b')) + (w ? (w.classList.contains('on') ? ' [开]' : ' [关]') : g ? ' [' + tx(g) + ']' : ''); }),
        adv: tx(document.getElementById('adv-sum')), kv: q('#s-adv .kv').map((e) => tx(e.firstElementChild) + '：' + tx(e.lastElementChild)) }; })()`, 8000);
    if (!v) return { ok: 'FAIL', note: '面板页面没有 #s-now（还是 v2.0.15 以前的面板？）' };
    say('  顶部：' + v.pill + (v.banners.length ? '；横幅：' + v.banners.join(' / ') : ''));
    say('  ' + (v.conv || '当前对话') + (v.empty ? '：' + v.empty : '') + (v.nums ? '：' + v.nums : ''));
    if (v.barRows) say(`  状态栏预览 ${v.barRows} 行（样式表 ${v.barCss} 字符${v.noicons ? '，图标字体没加载' : ''}）`);
    if (v.tiles.length) say('  ' + v.tiles.join(' · '));
    say(`  最近 7 天：${v.week} 根柱子；${v.wsum}`);
    for (const it of v.items) say('  · ' + it);
    say('  ' + v.adv);
    for (const k of v.kv) say('    ' + k);
    if (SHOT) {
      const s = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (s.result && s.result.data) {
        fs.mkdirSync(SHOT, { recursive: true });
        const file = path.join(SHOT, PLAT + '-plugin.png').replace(/\\/g, '/');
        fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
        say('shot ' + file);
      }
    }
    // 方案 A（v2.0.15）：状态栏开着时不放预览，有数据时“今天”是四个格子
    const bad = !v.empty && v.tiles.length < 4;
    return { ok: bad ? 'WARN' : 'OK', note: bad ? '“今天”只有 ' + v.tiles.length + ' 个格子' : v.pill };
  } finally { c.close(); }
};
CMDS.check = async () => {
  const r = await pluginApi('/api/action', { action: 'check-data' });
  say('  立即检查：' + r.status + ' ' + r.text + '，15 秒后再看');
  await wait(15000);
  return CMDS.status();
};
CMDS.update = async (ver) => {
  const o = await statusObj();
  const want = ver || (o.update && o.update.latest);
  if (!ver && !(o.update && o.update.available)) { say('  已经是最新版 v' + o.update.current + '（先跑 check 让插件检查一次？）'); return { ok: 'OK' }; }
  const r = await pluginApi('/api/action', { action: 'install', version: want });
  say('  更新到 v' + want + '：' + r.status + ' ' + r.text + '，插件重启，20 秒后再看');
  await wait(20000);
  return CMDS.status();
};

CMDS.bar = async () => {
  const c = await main();
  try {
    const bars = await c.ev(`[...document.querySelectorAll('.agy-usage-bar')].map((b) => [...b.querySelectorAll('.seg')].map((s) => {
      const x = s.cloneNode(true); x.querySelectorAll('.ic').forEach((i) => i.remove());
      return { t: x.textContent.replace(/\\s+/g, ' ').trim(), tip: (s.getAttribute('data-agy-tip') || '').split('\\n')[0] };
    }))`);
    if (!bars.length) { say('  没有状态栏（打开一个对话再试）'); return { ok: 'FAIL', note: '没有状态栏' }; }
    say(`  ${bars.length} 条状态栏，第一条 ${bars[0].length} 项：`);
    for (const s of bars[0]) say('  ' + s.t.padEnd(40) + (s.tip ? '  ← ' + s.tip.slice(0, 90) : ''));
    await shot(c, '.agy-usage-bar', 'bar', 120);
    return { ok: bars[0].length >= 3 ? 'OK' : 'WARN', note: bars[0].length + ' 项' };
  } finally { c.close(); }
};

CMDS.panel = async () => {
  const c = await main();
  try {
    await openPanel(c);
    await until(c, `!!document.querySelector('${PANEL} .p-foot .k-miss')`, 20000, 1000); // 缓存没命中那一行要等后台取完；今天没有没命中就不出现
    const v = await c.ev(`(() => {
      const p = document.querySelector('${PANEL}');
      const today = p.querySelector('tr.today');
      return { kpi: [...p.querySelectorAll('.p-kpi .kc')].map((k) => k.innerText.replace(/\\s+/g, ' ').trim()),
        today: today ? [...today.querySelectorAll('td')].map((td) => td.textContent.trim()).join(' | ') : '',
        foot: [...p.querySelectorAll('.p-foot > div')].map((d) => ({ t: d.textContent, tip: ${tipHead(2)}(d) })) };
    })()`);
    say('  KPI：' + v.kpi.join('  ·  '));
    say('  今天：' + (v.today || '（表格里没有今天）'));
    for (const f of v.foot) say('  底部：' + f.t + (f.tip ? '\n        ← ' + f.tip.slice(0, 160) : ''));
    await shot(c, PANEL, 'panel');
    return { ok: v.foot.length ? 'OK' : 'FAIL', note: v.foot.length + ' 行底部' + (v.foot.some((f) => /cache miss/.test(f.t)) ? '（含缓存没命中）' : '') };
  } finally { await closePanel(c); c.close(); }
};

CMDS.calls = async (day) => {
  const c = await main();
  try {
    await openPanel(c);
    await until(c, `!!document.querySelector('${PANEL} tr.clk')`, 8000);
    const md = day && day !== 'most' ? day.replace(/^\d{4}-/, '') : '';
    const picked = await c.ev(`(() => {
      const trs = [...document.querySelectorAll('${PANEL} tr.clk')];
      let tr = null;
      if (${JSON.stringify(day)} === 'most') { let n = -1; for (const x of trs) { const v = parseInt((x.querySelectorAll('td')[3] || {}).textContent, 10) || 0; if (v > n) { n = v; tr = x; } } }
      else if (${JSON.stringify(md)}) tr = trs.find((x) => x.querySelector('td').textContent.trim().startsWith(${JSON.stringify(md)}));
      else tr = document.querySelector('${PANEL} tr.today.clk') || trs[0];
      if (!tr) return null;
      tr.click();
      return tr.querySelector('td').textContent.trim();
    })()`);
    if (!picked) { say('  每日表格里没有 ' + (day || '今天')); return { ok: 'WARN', note: '没有这一天' }; }
    say('  打开 ' + picked + ' 的明细');
    const v = await readCalls(c);
    if (!v) { say('  2 分钟内没取到明细'); return { ok: 'FAIL', note: '明细没出来' }; }
    printCalls(v);
    await shot(c, PANEL, 'calls');
    return { ok: v.rows > 0 || /no calls/.test(v.empty) ? 'OK' : 'FAIL', note: v.rows + ' 行' + (v.miss ? '，没命中 ' + v.miss : '') };
  } finally { await closePanel(c); c.close(); }
};

// speed 页和 by model（v2.0.15）
CMDS.speed = async () => {
  const c = await main();
  try {
    await openPanel(c);
    const ok = await c.ev(`(() => { const b = [...document.querySelectorAll('${PANEL} .p-head .p-btn')].find((x) => /speed/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
    if (!ok) return { ok: 'FAIL', note: '每日面板标题行没有 speed 按钮（还是旧版本的状态栏？）' };
    await until(c, `!!document.querySelector('${PANEL} .p-spd, ${PANEL} .p-empty')`, 8000);
    const v = await c.ev(`(() => {
      const p = document.querySelector('${PANEL}');
      const tx = (e) => (e ? e.textContent.trim() : '');
      return { title: tx(p.querySelector('.p-title')), range: tx(p.querySelector('.p-range')), empty: tx(p.querySelector('.p-empty')),
        lines: [...p.querySelectorAll('.p-spd .sl')].map((g) => g.getAttribute('data-m').replace(/^Gemini \\d+ /, '') + ' ' + g.querySelectorAll('.pt').length + ' 个点'),
        legend: [...p.querySelectorAll('.p-legend > span')].map(tx),
        rows: [...p.querySelectorAll('.p-table tbody tr')].map((tr) => [...tr.children].map(tx).join(' | ')),
        firstTip: ((p.querySelector('.p-spd .hit') || { getAttribute: () => '' }).getAttribute('data-agy-tip') || '').replace(/\\n/g, ' / '),
        note: tx(p.querySelector('.p-note')) };
    })()`);
    say('  ' + v.title + ' · ' + v.range + (v.empty ? '；' + v.empty : ''));
    if (v.lines.length) say('  图：' + v.lines.join('；'));
    if (v.firstTip) say('  第一个点：' + v.firstTip);
    say('  表（Model | Today | 7d | 30d | TTFT 7d | Calls 30d）：');
    for (const r of v.rows) say('    ' + r);
    if (v.note) say('  说明：' + v.note);
    await shot(c, PANEL, 'speed');
    // 今天调用明细的 by model
    await c.ev(`(() => { const b = [...document.querySelectorAll('${PANEL} .p-head .p-btn')].find((x) => /usage/.test(x.textContent)); if (b) b.click(); return true; })()`);
    await until(c, `!!document.querySelector('${PANEL} tr.clk')`, 8000);
    await c.ev(`(() => { const tr = document.querySelector('${PANEL} tr.today.clk') || document.querySelector('${PANEL} tr.clk'); if (tr) tr.click(); return true; })()`);
    const cv = await readCalls(c);
    if (!cv) return { ok: 'WARN', note: 'speed 页 ' + v.rows.length + ' 个模型；今天的明细 2 分钟内没出来' };
    await c.ev(`(() => { const b = [...document.querySelectorAll('${PANEL} .p-tools .p-btn')].find((x) => x.textContent === 'by model'); if (b) b.click(); return !!b; })()`);
    await wait(500);
    const mv = await c.ev(`(() => {
      const p = document.querySelector('${PANEL}');
      const tx = (e) => (e ? e.textContent.trim() : '');
      return { sum: tx(p.querySelector('.p-range')), heads: [...p.querySelectorAll('.p-table thead th')].map(tx).join(' | '),
        rows: [...p.querySelectorAll('.p-table tbody tr')].map((tr) => [...tr.children].map(tx).join(' | ')) };
    })()`);
    say('  今天的 by model · ' + mv.sum);
    say('    ' + mv.heads);
    for (const r of mv.rows) say('    ' + r);
    await shot(c, PANEL, 'models');
    const good = v.rows.length > 0 && mv.rows.length > 0;
    return { ok: good ? 'OK' : 'WARN', note: 'speed 页 ' + v.rows.length + ' 个模型，by model ' + mv.rows.length + ' 行' };
  } finally { await closePanel(c); c.close(); }
};

CMDS.miss = async () => {
  const c = await main();
  try {
    await openPanel(c);
    const line = await until(c, `(() => { const l = document.querySelector('${PANEL} .p-foot .k-miss'); return l ? { t: l.textContent, tip: l.getAttribute('data-agy-tip') } : null; })()`, 40000, 1000);
    if (!line) { say('  底部没有 “cache miss today” 一行（今天没有调用，或者没有没命中的）'); return { ok: 'OK', note: '今天没有没命中' }; }
    say('  底部：' + line.t);
    say('  悬停：' + line.tip.split('\n\n')[0].replace(/\n\s*/g, ' / '));
    await shot(c, PANEL + ' .p-foot', 'miss-foot', 200);
    await c.ev(`document.querySelector('${PANEL} .p-foot .k-miss').click()`);
    const v = await readCalls(c);
    if (!v) { say('  明细没出来'); return { ok: 'FAIL' }; }
    printCalls(v);
    await shot(c, PANEL, 'miss');
    return { ok: v.rows > 0 && v.rows === v.miss ? 'OK' : 'WARN', note: v.rows + ' 行，标黄 ' + v.miss };
  } finally { await closePanel(c); c.close(); }
};

CMDS.ckpt = async () => {
  const c = await main();
  try {
    await closePanel(c);
    await wait(300);
    const b = await c.ev(`(() => { const b = document.querySelector('.agy-usage-bar .comp.clk'); if (!b) return null; b.click(); return b.textContent; })()`);
    if (!b) { say('  状态栏上没有压缩徽章（当前对话没压缩过）'); return { ok: 'OK', note: '没压缩过' }; }
    say('  点了 ' + b);
    await until(c, `!!document.querySelector('${PANEL} .p-ckpt, ${PANEL} .p-empty')`, 8000);
    await wait(800);
    const v = await c.ev(`(() => { const p = document.querySelector('${PANEL}'); if (!p) return null;
      return { title: (p.querySelector('.p-title') || {}).textContent, meta: (p.querySelector('.p-range') || {}).textContent, note: (p.querySelector('.p-note') || {}).textContent,
        sumLen: (p.querySelector('.p-ckpt') || { textContent: '' }).textContent.length, path: (p.querySelector('.p-path') || {}).textContent, empty: (p.querySelector('.p-empty') || {}).textContent }; })()`);
    if (!v) { say('  压缩查看器没打开'); return { ok: 'FAIL' }; }
    say(`  ${v.title} · ${v.meta || ''}`);
    if (v.note) say('  ' + v.note.slice(0, 160));
    say(`  摘要 ${v.sumLen} 字` + (v.path ? '；完整记录：' + v.path : '') + (v.empty ? '；' + v.empty : ''));
    await shot(c, PANEL, 'ckpt');
    return { ok: v.sumLen > 0 ? 'OK' : 'WARN', note: '摘要 ' + v.sumLen + ' 字' };
  } finally { await closePanel(c); c.close(); }
};

CMDS.english = async () => {
  const c = await main();
  try {
    const v = await c.ev(`(async () => {
      const I = window.__agyI18n;
      if (!I) return null;
      const s = document.createElement('span');
      s.style.cssText = 'position:fixed; left:-9999px; top:0';
      s.textContent = 'Leaving Soon';
      document.body.append(s);
      await new Promise((r) => setTimeout(r, 800));
      const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, altKey: true, bubbles: true }));
      const before = s.textContent;
      key();
      await new Promise((r) => setTimeout(r, 300));
      const en = s.textContent, pausedOn = I.paused;
      const toast = [...document.querySelectorAll('div[data-agy-no-i18n]')].map((d) => d.textContent).find((t) => /英文/.test(t)) || '';
      await new Promise((r) => setTimeout(r, 1500));
      key();
      await new Promise((r) => setTimeout(r, 500));
      const back = s.textContent, pausedOff = I.paused;
      s.remove();
      return { version: I.version, before, en, pausedOn, toast, back, pausedOff };
    })()`);
    if (!v) { say('  页面里没有翻译器'); return { ok: 'FAIL' }; }
    say(`  翻译器 v${v.version}：${v.before} → 按键 → ${v.en}（暂停 ${v.pausedOn}）→ 再按 → ${v.back}（暂停 ${v.pausedOff}）`);
    say('  提示：' + v.toast);
    const ok = v.en === 'Leaving Soon' && v.pausedOn === true && v.back === v.before && v.pausedOff === false && v.before !== v.en;
    return { ok: ok ? 'OK' : 'FAIL' };
  } finally { c.close(); }
};

CMDS['english-scan'] = async () => {
  const c = await main();
  try {
    const items = await c.ev(`(() => {
      const SKIP = '[role=article], [data-quotable], pre, code, textarea, input, [contenteditable=true], [class*=agy-], [data-testid=conversation-row-sidebar], [role=tree], [data-agy-no-i18n]';
      const out = new Map();
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (t.length < 3 || !/[A-Za-z]{3}/.test(t) || /[\\u4e00-\\u9fff]/.test(t)) continue;
        const el = n.parentElement;
        if (!el || el.closest(SKIP)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        out.set(t, (out.get(t) || 0) + 1);
      }
      return [...out].slice(0, 150);
    })()`);
    say(`  看得见的英文 ${items.length} 段（不一定都该翻：模型名、文件名、功能名也在里面）：`);
    for (const [t, n] of items) say(`  ${String(n).padStart(3)}× ${JSON.stringify(t.slice(0, 100))}`);
    return { ok: 'OK', note: items.length + ' 段' };
  } finally { c.close(); }
};

CMDS.swarm = async () => {
  const c = await connect(isSwarm, ' Swarm 面板');
  if (!c) { say('  没找到 Swarm 面板的框架（先在 Antigravity 里打开 Swarm 面板）'); return { ok: 'WARN' }; }
  try {
    const v = await c.ev(`(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const s = n.nodeValue.trim();
        if (s.length < 2 || !/[A-Za-z]{2}/.test(s)) continue;
        const el = n.parentElement;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const tid = el.closest('[data-testid]');
        out.push([s.slice(0, 70), el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : ''), tid ? tid.getAttribute('data-testid') : '']);
      }
      return { title: document.title, n: out.length, items: out.slice(0, 100) };
    })()`);
    say(`  ${v.title}：看得见的英文 ${v.n} 段（智能体写的目标、任务、消息本来就保持原文）`);
    for (const [s, tag, tid] of v.items) say('  ' + JSON.stringify(s).padEnd(50) + ' ' + tag.slice(0, 36).padEnd(36) + ' ' + tid);
    return { ok: 'OK', note: v.n + ' 段' };
  } finally { c.close(); }
};

CMDS.eval = async (...expr) => {
  const c = await main();
  try { say(JSON.stringify(await c.ev(expr.join(' ')), null, 1)); return { ok: 'OK' }; } finally { c.close(); }
};

CMDS.all = async () => {
  const res = [];
  for (const name of ['status', 'plugin', 'bar', 'panel', 'calls']) {
    say('== ' + name);
    let r;
    try { r = (await CMDS[name]()) || { ok: 'OK' }; } catch (e) { say('  出错：' + e.message); r = { ok: name === 'status' && /插件面板/.test(e.message) ? 'WARN' : 'FAIL', note: e.message }; }
    res.push([name, r]);
  }
  say('\n== 结果（' + PLAT + '）');
  for (const [name, r] of res) say(`  ${r.ok.padEnd(5)} ${name.padEnd(7)} ${r.note || ''}`);
  return { ok: res.some(([, r]) => r.ok === 'FAIL') ? 'FAIL' : 'OK' };
};

// ---------- 运行 ----------
const help = () => { const src = fs.readFileSync(SELF, 'utf8').split(/\r?\n/); say(src.slice(0, src.findIndex((l) => l.startsWith('import'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); };
if (!CMD || CMD === 'help' || CMD === '--help' || !CMDS[CMD]) {
  if (CMD && !CMDS[CMD] && CMD !== 'help' && CMD !== '--help') console.error('不认识的命令：' + CMD + '\n');
  help();
  process.exit(CMD && !CMDS[CMD] && CMD !== 'help' && CMD !== '--help' ? 2 : 0);
}
try {
  if (CMD !== 'all') say('== ' + CMD + '（' + PLAT + '）');
  const r = await CMDS[CMD](...ARGS);
  process.exit(r && r.ok === 'FAIL' ? 1 : 0);
} catch (e) {
  console.error('  出错：' + e.message);
  process.exit(1);
}
