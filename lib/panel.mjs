// 侧边栏面板（v2.0，插件模式）：Antigravity 右上角“插件”菜单 → agy-zh。
// 网页由 sidecar 自己起的 HTTP 服务提供（只听 127.0.0.1，端口是 Antigravity 给的 ANTIGRAVITY_SIDECAR_WEB_PORT）。
// Antigravity 打开面板时地址带 ?token=…（ANTIGRAVITY_SIDECAR_UI_TOKEN）；/api/* 都要带这个令牌（请求头 x-sidecar-token），
// 本机别的网页拿不到令牌，调不了这些接口。令牌为空时一律拒绝（没有令牌就没有鉴权依据，不能放行）。
// 令牌只认请求头，不认网址里的 ?token=（免得经日志、跳转泄漏）；POST 还要求 Content-Type 是 application/json——
// 跨站网页用 text/plain 发的“简单请求”不用预检就能打到本机端口，要靠这两条一起拦。页面只显示状态和几个按钮，不显示邮箱等个人信息；
// v2.0.7 起还显示汉化没翻译的界面文字（翻译器已过滤掉路径、网址、邮箱、文件名，但可能有项目名、对话标题这类名字）。
// 样式照 Antigravity 自带插件（Swarm）：颜色、字体都用 Antigravity 发来的主题变量（theme-change 消息里的 --background、
// --foreground、--primary、--border、--font-family 等），浅色 / 深色跟着 Antigravity；单色为主，只有状态点用固定的绿 / 黄 / 红。
import http from 'node:http';

const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

function collect(ctx) {
  const st = ctx.zh.status();
  const missing = ctx.zh.missing ? ctx.zh.missing(30) : null;
  return { st, update: ctx.update.status(ctx), relaunch: ctx.relaunch.info(ctx), platform: process.platform, missing };
}

async function act(ctx, a) {
  switch (a.action) {
    case 'online': ctx.zh.setOnline(!!a.on); return { ok: true };
    case 'check-data': ctx.zh.checkRemoteNow(); return { ok: true };
    case 'relaunch-mode': ctx.relaunch.setMode(ctx, a.mode); return { ok: true };
    case 'relaunch': return ctx.relaunch.relaunchNow(ctx);
    case 'install': return ctx.update.install(ctx, a.version);
    case 'clear-missing': ctx.zh.clearMissing(); return { ok: true };
    case 'toggle-english': return { ok: true, english: await ctx.zh.toggleEnglish() };
    default: throw Error('unknown action');
  }
}

export async function startPanel(ctx) {
  const port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) || 0;
  if (!port) return;
  const token = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      const given = req.headers['x-sidecar-token'] || '';
      if (!token || given !== token) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/api/status') {
        try { return json(res, 200, collect(ctx)); } catch (e) { return json(res, 500, { error: e.message }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        if (!/^application\/json(\s*;|\s*$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'expected application/json' });
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
        req.on('end', async () => {
          try { json(res, 200, await act(ctx, JSON.parse(body || '{}'))); } catch (e) { json(res, 400, { error: e.message }); }
        });
        return;
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(PAGE);
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  ctx.zh.panelPort = port; // 注入程序据此检查面板有没有停在 “plugin unavailable”（inject.mjs 的 fixStuckPanels）
  ctx.zh.log(`panel listening on 127.0.0.1:${port}`);
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agy-zh</title>
<style>
  :root {
    color-scheme: light;
    --bg: var(--background, #f7f7f8);
    --fg: var(--foreground, #1d1f21);
    --fg-muted: var(--muted-foreground, #5d676f);
    --fg-faint: var(--placeholder, #9da5ab);
    --primary-c: var(--primary, #007acc);
    --primary-fg: var(--primary-foreground, #ffffff);
    --line: color-mix(in srgb, var(--fg) 8%, transparent);
    --hover: color-mix(in srgb, var(--fg) 5%, transparent);
    --fill: color-mix(in srgb, var(--fg) 7%, transparent);
    --ok: #63984f; --warn: #b58f1f; --bad: var(--error, #cb3d3d);
    --font: var(--font-family, "Google Sans Flex", "Google Sans", system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
    --mono: var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }
  :root[data-theme="dark"] { color-scheme: dark; --ok: #7aae66; --warn: #d4b04a; }
  * { box-sizing: border-box; }
  html { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--fg) 22%, transparent) transparent; } /* 窄窗格里要滚动时用细滚动条 */
  body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
  main { padding: 16px 16px 24px; max-width: 640px; }
  header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  header h1 { font-size: 14px; font-weight: 600; margin: 0; }
  header .ver { font-size: 12px; color: var(--fg-muted); }
  .sub { font-size: 12px; color: var(--fg-muted); margin: 0 0 8px; }
  .msg { font-size: 12px; color: var(--fg-muted); margin: 0 0 4px; }
  .msg:empty { display: none; }
  section { padding: 12px 0 8px; border-top: 1px solid var(--line); }
  section:first-of-type { border-top: 0; }
  h2 { font-size: 12px; font-weight: 500; color: var(--fg-muted); margin: 0 0 4px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 30px; }
  .row .k { color: var(--fg); white-space: nowrap; }
  .row .v { color: var(--fg-muted); text-align: right; min-width: 0; overflow-wrap: anywhere; }
  .sub { color: var(--fg-muted); font-size: 12px; margin: 2px 0 6px; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; background: var(--fg-faint); }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.bad { background: var(--bad); }
  .seg { display: inline-flex; padding: 2px; border-radius: 7px; background: var(--fill); }
  .seg button { border: 0; background: transparent; color: var(--fg-muted); font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 5px; cursor: pointer; }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--bg); color: var(--fg); box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.06); }
  .btn { flex: none; white-space: nowrap; border: 1px solid var(--line); background: transparent; color: var(--fg); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--primary-c); border-color: var(--primary-c); color: var(--primary-fg); }
  .btn.primary:hover { filter: brightness(1.06); }
  .btn:disabled { opacity: .5; cursor: default; }
  .link { border: 0; background: none; padding: 0; color: var(--primary-c); font: inherit; font-size: 12px; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  .err { color: var(--bad); }
  footer { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--fg-faint); font-size: 11px; }
  code { font-family: var(--mono); font-size: 11.5px; }
  details summary { cursor: pointer; font-size: 12px; color: var(--fg-muted); margin: 2px 0; }
  .miss { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: var(--fg-muted); max-height: 260px; overflow: auto; user-select: text; }
  .miss li { overflow-wrap: anywhere; }
</style>
<main>
  <header><h1>agy-zh</h1><span class="ver" id="ver"></span></header>
  <div class="sub">界面汉化 · 用量状态栏</div>
  <div class="msg" id="msg"></div>
  <section id="s-run"></section>
  <section id="s-data"></section>
  <section id="s-miss" hidden></section>
  <section id="s-upd"></section>
  <section id="s-rl"></section>
  <footer>非官方项目，和 Google 没有关系 · <code>github.com/ncdeng/agy-zh-pack</code></footer>
</main>
<script>
// 接收 Antigravity 的主题（和 SDK 的 preload.js 一样：theme-change 消息里是 CSS 变量），深浅按背景色判断
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'theme-change' || !e.data.payload) return;
  const vars = e.data.payload.cssVariables || {};
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  const bg = getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);
  if (bg) document.documentElement.dataset.theme = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) < 128 ? 'dark' : 'light';
});
const token = new URLSearchParams(location.search).get('token') || '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (ms) => { if (!ms) return ''; const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return (d.toDateString() === new Date().toDateString() ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ') + p(d.getHours()) + ':' + p(d.getMinutes()); };
const row = (k, v) => '<div class="row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
const dot = (cls) => '<span class="dot ' + cls + '"></span>';
const seg = (name, items, cur) => '<span class="seg">' + items.map(([v, t]) => '<button data-' + name + '="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + t + '</button>').join('') + '</span>';
let busy = false;
let missSig = null, missOpen = false; // 没翻译的文字：内容没变就不重画（免得每 3 秒重画打断选择文字、收起展开的列表）
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-sidecar-token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const o = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(o.error || ('HTTP ' + r.status));
  return o;
}
// quiet：出错时顶上不重复显示（更新失败的原因写在“版本”一节里）
async function act(body, okText, quiet) {
  if (busy) return; busy = true;
  try { await api('/api/action', body); $('msg').textContent = okText || ''; clearTimeout(act.t); act.t = setTimeout(() => { $('msg').textContent = ''; }, 4000); } // 成功的提示 4 秒后消失
  catch (e) { $('msg').innerHTML = quiet ? '' : '<span class="err">' + esc(e.message) + '</span>'; }
  finally { busy = false; setTimeout(refresh, 600); }
}
function render(o) {
  const st = o.st, u = o.update, rl = o.relaunch, r = st.remote, s = r.st || {};
  $('ver').textContent = 'v' + st.version;
  // 运行状态
  let h = '<h2>运行状态</h2>';
  h += row('注入', st.lockHeld ? dot('ok') + '正常' : dot('warn') + '待命（已有别的注入程序在跑）');
  h += row('调试端口', st.port.ok ? dot('ok') + '已连上 · ' + st.windows + ' 个窗口' : dot('bad') + '没开');
  h += row('汉化', st.i18n ? '已加载' + (st.frames ? ' · 含 Swarm 面板' : '') : '没加载');
  if (st.i18n && st.port.ok) {
    h += '<div class="sub">临时切回英文：按 ' + (o.platform === 'darwin' ? 'Ctrl+Option+E' : 'Ctrl+Alt+E') + '，再按一次切回中文。' +
      '所有窗口一起切，刷新后恢复中文。<button class="link" id="b-en">现在切换</button></div>';
  }
  h += row('用量状态栏', st.statusbar ? '已加载' : '没加载');
  if (u.integrity && u.integrity.status === 'modified') h += row('文件', dot('warn') + u.integrity.changed.length + ' 个文件和签名清单不一致');
  else if (u.integrity && u.integrity.status === 'ok') h += row('文件', '和签名清单一致');
  if (!st.port.ok) {
    h += '<div class="sub">这次 Antigravity 启动时没带 <code>--remote-debugging-port=0</code>，汉化和状态栏暂时没生效。</div>';
    if (rl.supported) h += '<div style="margin: 2px 0 6px"><button class="btn" id="b-rl">带参数重启 Antigravity</button></div>';
  }
  $('s-run').innerHTML = h;
  // 在线更新
  h = '<h2>在线更新</h2>';
  h += row('词典和价格', seg('online', [['on', '自动'], ['off', '关闭']], st.online ? 'on' : 'off'));
  if (st.online) {
    const parts = [];
    parts.push(s.okAt ? '上次检查 ' + when(s.okAt) + (s.host ? ' · ' + esc(s.host) : '') : (s.at ? '还没检查成功' : '启动约 1 分钟后检查'));
    parts.push(s.dictN ? '词典 ' + s.dictN + ' 条 · 规则 ' + s.rulesN + ' 条' : '词典用自带的');
    parts.push(r.prices ? '价格表 ' + esc(r.prices.updated) : '价格表用内置的');
    h += '<div class="sub">' + parts.join('<br>') + (s.err ? '<br><span class="err">' + esc(s.err) + '</span>' : '') + '</div>';
    h += '<button class="link" id="b-chk">立即检查</button>';
  } else h += '<div class="sub">不联网，词典和价格只用安装包自带的，也不检查新版本。</div>';
  $('s-data').innerHTML = h;
  // 没翻译的界面文字（v2.0.7）
  const ms = o.missing;
  $('s-miss').hidden = !ms;
  const sig = ms ? ms.count + JSON.stringify(ms.items.map((e) => e.t)) : '';
  if (ms && sig !== missSig) {
    missSig = sig;
    h = '<h2>没翻译的界面文字</h2>';
    h += row('已记下', ms.count + ' 条' + (ms.count ? ' · <button class="link" id="b-mclr">清空</button>' : ''));
    h += '<div class="sub">汉化查不到译文的界面文字记在本机的 <code>' + esc(ms.file) + '</code>，不上传，补词典时用。文件里可能有项目名、对话标题这类名字。'
      + '清空以后，刷新窗口或换了词典，还是没翻译的文字会再记下。</div>';
    if (ms.count) {
      h += '<details id="d-miss"' + (missOpen ? ' open' : '') + '><summary>最近见到的 ' + ms.items.length + ' 条</summary><ul class="miss">'
        + ms.items.map((e) => '<li>' + esc(e.t) + '</li>').join('') + '</ul></details>';
    }
    $('s-miss').innerHTML = h;
    const dm = $('d-miss');
    if (dm) dm.ontoggle = () => { missOpen = dm.open; };
  }
  // 版本
  h = '<h2>版本</h2>';
  const stt = u.state || {};
  const prog = { downloading: '正在下载…', verifying: '正在核对签名和文件…', installing: '正在安装…' }[stt.status];
  let right = !u.online ? '在线更新关着，不检查' : !u.latest ? '还没查到最新版本' : u.available ? '有新版本 v' + esc(u.latest) : '已是最新';
  if (prog) right = prog;
  if (u.available && !prog) {
    h += '<div class="row"><span class="k">v' + esc(u.current) + ' → v' + esc(u.latest) + '</span><button class="btn primary" id="b-upd">更新</button></div>';
    h += '<div class="sub">' + (u.date ? '新版本发布于 ' + esc(u.date) + '。' : '') + '安装前会校验作者签名和每个文件，装好后插件自动重启。</div>';
  } else h += row('v' + esc(u.current), right);
  if (stt.status === 'failed' && stt.error) h += '<div class="sub err">上次没装上：' + esc(stt.error) + '</div>';
  if (stt.status === 'installed' && stt.version === u.current && stt.from) h += '<div class="sub">已从 v' + esc(stt.from) + ' 更新到 v' + esc(stt.version) + '</div>';
  $('s-upd').innerHTML = h;
  // 没带调试端口启动时
  h = '<h2>没带调试端口启动时</h2>';
  if (!rl.supported) h += '<div class="sub">这个系统不支持自动重开。</div>';
  else {
    h += row('处理方式', seg('mode', [['ask', '询问'], ['auto', '自动重开'], ['never', '不处理']], rl.mode));
    h += '<div class="sub">' + (o.platform === 'darwin' ? '从程序坞打开时总是不带参数，选“自动重开”就不用每次确认。' : '快捷方式已加参数；Antigravity 自动更新后自己重启时可能不带。') + '</div>';
  }
  $('s-rl').innerHTML = h;
  // 按钮
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('b-rl', () => act({ action: 'relaunch' }, '正在重启 Antigravity…'));
  on('b-chk', () => act({ action: 'check-data' }, '几秒后检查'));
  on('b-upd', () => act({ action: 'install', version: u.latest }, '已更新，插件马上重启', true));
  on('b-mclr', () => act({ action: 'clear-missing' }, '已清空'));
  on('b-en', () => act({ action: 'toggle-english' }, '已切换，回到 Antigravity 窗口查看'));
  document.querySelectorAll('[data-online]').forEach((b) => { b.onclick = () => act({ action: 'online', on: b.dataset.online === 'on' }, b.dataset.online === 'on' ? '在线更新已打开' : '在线更新已关闭'); });
  document.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => act({ action: 'relaunch-mode', mode: b.dataset.mode }, '已保存'); });
}
async function refresh() {
  try { render(await api('/api/status')); } catch (e) { $('msg').innerHTML = '<span class="err">连不上插件：' + esc(e.message) + '（可能正在重启）</span>'; }
}
refresh();
setInterval(() => { if (!busy) refresh(); }, 3000);
</script>
</html>`;
