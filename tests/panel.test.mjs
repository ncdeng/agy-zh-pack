// 插件面板（v2.0.15 重做）：lib/panel.mjs 的令牌、Content-Type 检查和新加的几个操作；
// inject.mjs 的两个开关（look.json 里的 zh / statusbar）：Theme 页换配色不冲掉开关，切换时重新注入
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, cut, cutInject, read } from './_helpers.mjs';

const { startPanel } = await import(pathToFileURL(path.join(ROOT, 'lib/panel.mjs')).href);

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// 用假的 ctx 起面板服务：记下注入程序收到的调用
async function startFake(t) {
  const calls = [];
  const zh = {
    status: () => ({ version: '9.9.9', zhOn: true, barOn: true }),
    missing: () => null,
    panelData: async (cssHave) => { calls.push(['panelData', cssHave]); return { snap: null, cssKey: 'k1', css: cssHave === 'k1' ? undefined : 'x{}' }; },
    openView: async (view, day) => { calls.push(['openView', view, day]); return true; },
    setZh: (on) => calls.push(['setZh', on]),
    setBar: (on) => calls.push(['setBar', on]),
    log: () => {},
  };
  const ctx = { zh, update: { status: () => ({}) }, relaunch: { info: () => ({}) } };
  const port = await freePort();
  const saved = [process.env.ANTIGRAVITY_SIDECAR_WEB_PORT, process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN];
  process.env.ANTIGRAVITY_SIDECAR_WEB_PORT = String(port);
  process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN = 'tok-test';
  let server;
  try { server = await startPanel(ctx); }
  finally {
    for (const [k, v] of [['ANTIGRAVITY_SIDECAR_WEB_PORT', saved[0]], ['ANTIGRAVITY_SIDECAR_UI_TOKEN', saved[1]]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${port}`;
  const post = (body, headers = {}) => fetch(base + '/api/action', {
    method: 'POST', headers: { 'x-sidecar-token': 'tok-test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { calls, base, post };
}

test('API 要令牌：没带、带错都是 401，网址里的 ?token= 不算', async (t) => {
  const { base } = await startFake(t);
  assert.equal((await fetch(base + '/api/status')).status, 401);
  assert.equal((await fetch(base + '/api/status', { headers: { 'x-sidecar-token': 'wrong' } })).status, 401);
  assert.equal((await fetch(base + '/api/status?token=tok-test')).status, 401);
});

test('status 带上内存和状态栏数据，并把页面手里的样式表指纹交给 panelData', async (t) => {
  const { base, calls } = await startFake(t);
  const h = { headers: { 'x-sidecar-token': 'tok-test' } };
  const a = await (await fetch(base + '/api/status', h)).json();
  assert.equal(a.st.version, '9.9.9');
  assert.equal(a.panel.css, 'x{}');
  assert.ok(a.mem.rss > 0 && a.mem.heap > 0);
  const b = await (await fetch(base + '/api/status?css=k1', h)).json();
  assert.equal(b.panel.css, undefined);
  assert.deepEqual(calls, [['panelData', ''], ['panelData', 'k1']]);
});

test('POST 要 application/json，不然 415（拦跨站的 text/plain 简单请求）', async (t) => {
  const { post, calls } = await startFake(t);
  assert.equal((await post({ action: 'zh', on: false }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(calls.length, 0);
});

test('新加的操作：open-view 转交页面和日期，zh / statusbar 转成布尔值；不认识的操作 400', async (t) => {
  const { post, calls } = await startFake(t);
  assert.deepEqual(await (await post({ action: 'open-view', view: 'calls', day: '2026-11-25' })).json(), { ok: true });
  assert.equal((await post({ action: 'zh', on: 0 })).status, 200);
  assert.equal((await post({ action: 'statusbar', on: 'yes' })).status, 200);
  assert.equal((await post({ action: 'rm-rf' })).status, 400);
  assert.deepEqual(calls, [['openView', 'calls', '2026-11-25'], ['setZh', false], ['setBar', true]]);
});

test('首页是网页，不缓存', async (t) => {
  const { base } = await startFake(t);
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(await r.text(), /<details class="adv"/);
});

// ---------- inject.mjs：look.json 的两个开关 ----------
const lookCode = cutInject('const zhOn =', '// 关汉化时')
  + cutInject('const LOOK_FILE =', '// ---------- 今天花费的账本')
  + cutInject('function setLookFlag(', '// ---------- 交给插件 sidecar');
function makeLook(file) {
  const env = { file, writes: [], applied: 0, frames: 0 };
  const sessions = new Map([['a', {}], ['b', {}]]);
  const fns = new Function('path', 'DATA', 'readJsonKeep', 'writeFileSafe', 'log', 'sessions', 'apply', 'applyFrames',
    lookCode + '\nreturn { zhOn, barOn, readLook, saveLook, setLookFlag };')(
    path, 'D:/data',
    () => { if (env.file === null) throw Error('missing'); return env.file; },
    (f, text) => { env.writes.push(JSON.parse(text)); },
    () => {},
    sessions,
    async () => { env.applied++; },
    () => { env.frames++; });
  return { ...fns, env };
}

test('Theme 页交来的外观里没有 zh / statusbar 时沿用文件里的，换配色不会把开关冲掉', () => {
  const L = makeLook({ pal: 'mocha', zh: 'off', statusbar: 'off' });
  L.saveLook({ pal: 'latte', skin: 'pill', at: 5 });
  assert.deepEqual(L.env.writes.at(-1), { pal: 'latte', skin: 'pill', zh: 'off', statusbar: 'off', at: 5 });
  assert.equal(L.zhOn(), false);
  assert.equal(L.barOn(), false);
  // 明确交来的值照用
  L.saveLook({ pal: 'latte', zh: 'on', at: 6 });
  assert.equal(L.env.writes.at(-1).zh, 'on');
  assert.equal(L.env.writes.at(-1).statusbar, 'off');
});

test('没有 look.json 时两个开关都算开', () => {
  const L = makeLook(null);
  assert.equal(L.zhOn(), true);
  assert.equal(L.barOn(), true);
});

test('setLookFlag：关汉化存 off、每个窗口重新注入、Swarm 面板也换；值没变不写文件', () => {
  const L = makeLook({ pal: 'mocha' });
  L.setLookFlag('zh', false, 'chinese ui');
  assert.equal(L.env.writes.length, 1);
  assert.equal(L.env.writes[0].zh, 'off');
  assert.equal(L.env.writes[0].pal, 'mocha');
  assert.equal(L.env.applied, 2);
  assert.equal(L.env.frames, 1);
  L.setLookFlag('zh', false, 'chinese ui');
  assert.equal(L.env.writes.length, 1);
  // 状态栏开关只重新注入主窗口，不动 Swarm 面板
  L.setLookFlag('statusbar', false, 'status bar');
  assert.equal(L.env.writes.at(-1).statusbar, 'off');
  assert.equal(L.env.writes.at(-1).zh, 'off');
  assert.equal(L.env.frames, 1);
  assert.equal(L.barOn(), false);
  L.setLookFlag('zh', true, 'chinese ui');
  assert.equal(L.zhOn(), true);
});

// 状态栏预览放的是页面里状态栏的 HTML，面板样式里以某个类开头的规则会套到同名的状态栏元素上
// （v2.0.15 出过：面板的 .meter / .dot / .seg 把预览里额度的进度条挤成一个小点、分隔符画成灰圆点）
test('面板样式的类名不和状态栏样式里的类重名', () => {
  const panelSrc = read('lib/panel.mjs');
  const css = panelSrc.slice(panelSrc.indexOf('<style>'), panelSrc.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const first = new Set();
  for (const chunk of css.split('}')) {
    for (const sel of chunk.split('{').slice(0, -1).flatMap((x) => x.split(','))) {
      const m = /^\s*\.([a-zA-Z][\w-]*)/.exec(sel);
      if (m) first.add(m[1]);
    }
  }
  const bar = new Set();
  for (const m of read('statusbar.js').matchAll(/\$\{B\}([^{]*)\{/g)) for (const c of m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)) bar.add(c[1]);
  assert.ok(first.size > 20 && bar.size > 20, '没取到类名（代码改过了？测试要跟着改）');
  const clash = [...first].filter((c) => bar.has(c) && c !== 'agy-usage-bar');
  assert.deepEqual(clash, []);
});

// 面板取不到状态时顶上写一行，之后取到了要清掉（2026-11-28 修：原来一直挂着。那次本机回环连接整体卡了约 8 分钟，
// language server 转发面板请求连不上插件、回了 502；恢复后数字照常刷新，“连不上插件：HTTP 502”却一直显示）
test('面板：取不到状态时写一行，下次取到就清掉；按钮操作的提示不被清掉', async () => {
  const src = cut('lib/panel.mjs', 'let lastAt = 0;', '\nrefresh();');
  // 很小的假元素：innerHTML / textContent 共用一份内容，querySelector 只认 [data-conn]
  const msg = { html: '', get innerHTML() { return this.html; }, set innerHTML(v) { this.html = v; },
    get textContent() { return this.html.replace(/<[^>]*>/g, ''); }, set textContent(v) { this.html = v; },
    querySelector(sel) { return sel === '[data-conn]' && /data-conn/.test(this.html) ? {} : null; } };
  let fail = null, renders = 0;
  const api = async () => { if (fail) throw Error(fail); return { ok: 1 }; };
  const refresh = new Function('$', 'api', 'render', 'esc', 'cssKey', src + '\nreturn refresh;')(
    () => msg, api, () => { renders++; }, (s) => String(s), 'k');
  fail = 'HTTP 502';
  await refresh();
  assert.match(msg.textContent, /暂时连不上插件（HTTP 502）/);
  fail = null;
  await refresh();
  assert.equal(msg.textContent, '');
  assert.equal(renders, 1);
  msg.textContent = '已换配色'; // 按钮操作写的提示：取数成功时不动
  await refresh();
  assert.equal(msg.textContent, '已换配色');
});
