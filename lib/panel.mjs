// 侧边栏面板（v2.0，插件模式）：Antigravity 右上角“插件”菜单 → agy-zh。
// 网页由 sidecar 自己起的 HTTP 服务提供（只听 127.0.0.1，端口是 Antigravity 给的 ANTIGRAVITY_SIDECAR_WEB_PORT）。
// Antigravity 打开面板时地址带 ?token=…（ANTIGRAVITY_SIDECAR_UI_TOKEN）；/api/* 都要带这个令牌（请求头 x-sidecar-token），
// 本机别的网页拿不到令牌，调不了这些接口。令牌为空时一律拒绝（没有令牌就没有鉴权依据，不能放行）。
// 令牌只认请求头，不认网址里的 ?token=（免得经日志、跳转泄漏）；POST 还要求 Content-Type 是 application/json——
// 跨站网页用 text/plain 发的“简单请求”不用预检就能打到本机端口，要靠这两条一起拦。页面只显示状态、用量数字和几个按钮，不显示邮箱等个人信息；
// v2.0.7 起还显示汉化没翻译的界面文字（翻译器已过滤掉路径、网址、邮箱、文件名，但可能有项目名、对话标题这类名字）。
// 样式照 Antigravity 自带插件（Swarm）：颜色、字体都用 Antigravity 发来的主题变量（theme-change 消息里的 --background、
// --foreground、--primary、--border、--font-family 等），浅色 / 深色跟着 Antigravity；只有状态点用固定的绿 / 黄 / 红。
// v2.0.15 按设计稿重做（docs 里没有存稿，设计稿是 dist/panel-design.html，不进仓库）：
//   顶部状态点和出问题时的横幅；“今天”卡片（方案 A：花费、额度、生成速度、缓存没命中四个格子，下面一行当前对话）和打开每日用量面板的按钮；
//   状态栏预览只在关掉“显示用量状态栏”时显示（平时状态栏就在输入框上方，侧栏再放一份是重复）；
//   最近 7 天；“显示”“更新与启动”两组设置（新加“中文界面”“显示状态栏”两个开关；设计稿是四组，嫌太长缩成两组、长说明改成悬停提示）；默认收起的“高级”（运行状态、内存、没翻译的文字）。
//   状态栏预览直接用页面里状态栏的 HTML 和样式表（inject.mjs 的 panelData），和输入框上方那条一模一样。
import http from 'node:http';

const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

// cssHave：页面手里状态栏样式表的指纹（没变就不再发样式表）
async function collect(ctx, cssHave) {
  const st = ctx.zh.status();
  const missing = ctx.zh.missing ? ctx.zh.missing(30) : null;
  const panel = ctx.zh.panelData ? await ctx.zh.panelData(cssHave) : null;
  const m = process.memoryUsage();
  return {
    st, update: ctx.update.status(ctx), relaunch: ctx.relaunch.info(ctx), platform: process.platform, missing, panel,
    mem: { rss: m.rss, heap: m.heapUsed },
  };
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
    case 'zh': ctx.zh.setZh(!!a.on); return { ok: true };
    case 'statusbar': ctx.zh.setBar(!!a.on); return { ok: true };
    // 配色（v2.0.18）：和状态栏共用一个配色；colors：自定义的 4 个主色（只改 mode 那一种主题），null = 恢复默认
    case 'pal': ctx.zh.setPal(String(a.pal || '')); return { ok: true };
    case 'colors': ctx.zh.setColors(String(a.mode || ''), a.colors && typeof a.colors === 'object' ? a.colors : null); return { ok: true };
    // 状态栏显示哪些项（2026-11-27）：hide = 关掉的项目名
    case 'items': ctx.zh.setHide(Array.isArray(a.hide) ? a.hide.slice(0, 24).map((x) => String(x).slice(0, 24)) : []); return { ok: true };
    case 'open-view': return { ok: await ctx.zh.openView(String(a.view || ''), String(a.day || '')) };
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
        collect(ctx, String(url.searchParams.get('css') || '').slice(0, 40))
          .then((o) => json(res, 200, o), (e) => json(res, 500, { error: e.message }));
        return;
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
  return server;
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agy-zh</title>
<style>
  /* 类名别和状态栏的重名（.dot、.meter、.seg、.tx…）：状态栏预览放的是页面里状态栏的 HTML，面板的同名规则会套到它身上（tests/panel.test.mjs 有检查） */
  :root {
    color-scheme: light;
    --bg: var(--background, #f7f7f8);
    --fg: var(--foreground, #1d1f21);
    --fg-muted: var(--muted-foreground, #5d676f);
    --fg-faint: var(--placeholder, #9da5ab);
    --primary-c: var(--primary, #007acc);
    --primary-fg: var(--primary-foreground, #ffffff);
    --card: color-mix(in srgb, var(--bg) 70%, #ffffff);
    --line: color-mix(in srgb, var(--fg) 9%, transparent);
    --hover: color-mix(in srgb, var(--fg) 5%, transparent);
    --fill: color-mix(in srgb, var(--fg) 7%, transparent);
    --ok: #5b8f47; --warn: #b8860b; --bad: var(--error, #c8463d);
    --cost: #c03d8e; --q5: #e0620d; --qw: #c9800f;
    --font: var(--font-family, "Google Sans Flex", "Google Sans", system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
    --mono: "Google Sans Code", var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }
  :root[data-theme="dark"] { color-scheme: dark; --card: color-mix(in srgb, var(--bg) 88%, #ffffff); --ok: #7aae66; --warn: #d4b04a; --cost: #f5c2e7; --q5: #fab387; --qw: #f9e2af; }
  * { box-sizing: border-box; }
  html { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--fg) 22%, transparent) transparent; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
  main { padding: 14px 16px 22px; max-width: 680px; }
  .hd { display: flex; align-items: center; gap: 8px; }
  .hd h1 { font-size: 14px; font-weight: 600; margin: 0; }
  .hd .ver { color: var(--fg-muted); font-size: 12px; }
  .hd .sp { flex: 1; }
  .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-muted); padding: 3px 10px; border-radius: 999px; background: var(--fill); cursor: pointer; white-space: nowrap; border: 0; font-family: inherit; }
  .sdot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-faint); flex: none; }
  .sdot.ok { background: var(--ok); } .sdot.warn { background: var(--warn); } .sdot.bad { background: var(--bad); }
  .msg { font-size: 12px; color: var(--fg-muted); margin: 8px 0 0; }
  .msg:empty { display: none; }
  .banner { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; display: flex; gap: 10px; align-items: center; font-size: 12.5px; }
  .banner.bad { background: color-mix(in srgb, var(--bad) 10%, var(--bg)); border: 1px solid color-mix(in srgb, var(--bad) 28%, transparent); }
  .banner.upd { background: color-mix(in srgb, var(--primary-c) 9%, var(--bg)); border: 1px solid color-mix(in srgb, var(--primary-c) 28%, transparent); }
  .banner .t { flex: 1; min-width: 0; }
  .banner .t b { display: block; font-weight: 600; }
  .banner .t span { color: var(--fg-muted); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin-top: 12px; }
  .card-h { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; min-width: 0; }
  .card-h .ttl { font-size: 12px; color: var(--fg-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
  .card-h .ttl b { color: var(--fg); font-weight: 500; }
  .card-h .aside { font-size: 11.5px; color: var(--fg-faint); white-space: nowrap; }
  .run { font-size: 11.5px; color: var(--ok); white-space: nowrap; display: inline-flex; gap: 5px; align-items: center; }
  .run i { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent); }
  .run.idle { color: var(--fg-faint); } .run.idle i { background: var(--fg-faint); box-shadow: none; }
  /* 状态栏预览：页面里状态栏的 HTML + 样式表（#barcss），外面只加一层底色 */
  .sbwrap { border-radius: 9px; background: color-mix(in srgb, var(--fg) 3.5%, transparent); padding: 6px 2px 2px; overflow: hidden; }
  .sbwrap .agy-usage-bar { padding-bottom: .3rem !important; }
  .sbwrap.noicons .ic:not(.uni) { display: none !important; }
  .empty { color: var(--fg-muted); font-size: 12px; padding: 4px 2px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
  .tile { border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; min-width: 0; }
  .tile .k { font-size: 11.5px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .v { font: 600 17px/1.3 var(--mono); margin-top: 3px; white-space: nowrap; }
  .tile .s { font-size: 11.5px; color: var(--fg-muted); margin-top: 1px; }
  .qbar { position: relative; height: 5px; border-radius: 3px; background: var(--fill); margin-top: 7px; }
  .qbar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
  .qbar b { position: absolute; top: -3px; width: 2px; height: 11px; background: var(--fg-muted); border-radius: 1px; opacity: .6; }
  .tile.warn { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 6%, var(--card)); }
  .tile.clk { cursor: pointer; }
  .tile.clk:hover { border-color: color-mix(in srgb, var(--fg) 22%, transparent); }
  .tile .v small { font-size: 12px; font-weight: 500; }
  .tile .v.slow { color: var(--warn); }
  .q2 { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 7px; align-items: center; font-size: 11.5px; color: var(--fg-muted); margin: 6px 0 3px; }
  .q2 .qbar { margin-top: 0; }
  .q2 > b { color: var(--fg); font: 600 12px var(--mono); white-space: nowrap; }
  .q2 > b em { font-style: normal; font-weight: 500; color: var(--fg-muted); }
  .q2 > b em.over { color: var(--bad); font-weight: 600; }
  .qbar i.proj { opacity: .3; }
  .qbar i.proj.over { opacity: 1; background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--bad) 55%, transparent) 0 3px, transparent 3px 6px) !important; }
  .qcost { font-size: 11.5px; color: var(--fg-muted); margin-top: 4px; }
  .qcost b { color: var(--fg); font: 600 12px var(--mono); }
  .qcost span { font-size: 11px; }
  .qcost .ql { display: inline-block; min-width: 1.6em; font-size: 11.5px; }
  .qcost + .qcost { margin-top: 1px; }
  .tile .s.bad { color: var(--bad); }
  /* 配色（v2.0.18）：8 套配色的色块 + 自定义 4 个主色 */
  .item.colrow { display: block; }
  .palc { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .palc button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 8px; padding: 3px 8px; font: inherit; font-size: 12px; color: var(--fg); background: transparent; cursor: pointer; }
  .palc button:hover { background: var(--hover); }
  .palc button.on { border-color: var(--primary-c); box-shadow: 0 0 0 1px var(--primary-c) inset; }
  .palc button.base { border-style: dashed; border-color: var(--primary-c); }
  .palc .pd { display: inline-flex; gap: 2px; }
  .palc .pd i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .palc.bi button:not(.on):not(.all) { color: var(--fg-muted); text-decoration: line-through; }
  .palx { margin-top: 10px; padding: 9px 11px; border: 1px dashed var(--line); border-radius: 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; font-size: 12.5px; }
  .palx label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .palx input[type=color] { width: 26px; height: 22px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
  .palx .pa { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; color: var(--fg-muted); font-size: 12px; }
  .sep { border-top: 1px solid var(--line); margin: 10px 0 8px; }
  .conv .nums { font-size: 12px; color: var(--fg-muted); margin-top: 2px; }
  .conv .nums b { color: var(--fg); font: 600 12px var(--mono); }
  .acts { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .btn { flex: none; white-space: nowrap; border: 1px solid var(--line); background: transparent; color: var(--fg); font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 8px; cursor: pointer; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--fg); border-color: var(--fg); color: var(--bg); }
  .btn.accent { background: var(--primary-c); border-color: var(--primary-c); color: var(--primary-fg); }
  .btn.primary:hover, .btn.accent:hover { filter: brightness(1.08); }
  .btn:disabled { opacity: .5; cursor: default; }
  .week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-items: end; height: 74px; }
  .week button { all: unset; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; height: 100%; cursor: pointer; }
  .week button i { width: 100%; max-width: 26px; border-radius: 4px 4px 2px 2px; background: color-mix(in srgb, var(--cost) 50%, transparent); min-height: 2px; }
  .week button:hover i { background: color-mix(in srgb, var(--cost) 75%, transparent); }
  .week button.today i { background: var(--cost); }
  .week button span { font-size: 10.5px; color: var(--fg-faint); white-space: nowrap; }
  .week button.today span { color: var(--fg); font-weight: 600; }
  .wsum { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--fg-muted); margin-top: 6px; flex-wrap: wrap; }
  .wsum b { color: var(--fg); font: 600 12px var(--mono); }
  /* 最近 7 天的“速度”页（v2.0.15）：折线用拉伸的 SVG（线宽不跟着拉伸），点用 HTML 放上去（不会被拉成椭圆） */
  .pick.sm button { padding: 1px 8px; font-size: 11.5px; }
  .spd { position: relative; height: 56px; margin: 4px 0 0; cursor: pointer; }
  .spd svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .spd path { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
  .spd path.d2 { stroke-dasharray: 5 3; }
  .spd .pt { position: absolute; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; }
  .spd .gl { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--line); }
  .spd .gl span { position: absolute; left: 0; top: -14px; font-size: 10px; line-height: 12px; color: var(--fg-faint); }
  .spd .gl span.hi { top: 1px; }
  .spd .cur { position: absolute; top: -3px; bottom: -3px; border-radius: 3px; background: color-mix(in srgb, var(--fg) 5%, transparent); }
  .wkl.h24 { grid-template-columns: repeat(24, 1fr); }
  .wkl.h24 span { display: flex; justify-content: center; overflow: visible; }
  .slg b.slow { color: var(--warn); }
  /* 悬停：竖线跟着鼠标所在的小时，旁边的小框列出这个小时每个模型的速度和调用次数（v2.0.15） */
  .spd .vl { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 1px solid color-mix(in srgb, var(--fg) 35%, transparent); pointer-events: none; }
  .spd .pt.on { width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; box-shadow: 0 0 0 2px var(--card); }
  .stip { position: absolute; top: -6px; margin-left: 10px; z-index: 5; min-width: 180px; max-width: 270px; padding: 7px 9px; border-radius: 8px;
    background: var(--card); border: 1px solid var(--line); box-shadow: 0 4px 14px rgba(0, 0, 0, .14); font-size: 12px; pointer-events: none; }
  .stip.l { margin-left: 0; margin-right: 10px; }
  .stip .st-h { font-weight: 600; margin-bottom: 3px; white-space: nowrap; }
  .stip .st-r { display: flex; align-items: center; gap: 6px; white-space: nowrap; line-height: 1.6; }
  .stip .st-r i { display: inline-block; width: 12px; height: 0; border-top: 3px solid currentColor; border-radius: 2px; }
  .stip .st-r i.d2 { border-top: 2px dashed currentColor; border-radius: 0; }
  .stip .st-r b { margin-left: auto; padding-left: 10px; font: 600 12px var(--mono); }
  .stip .st-r b.slow { color: var(--warn); }
  .stip .st-r span { color: var(--fg-faint); min-width: 3.4em; text-align: right; }
  .stip .st-f { color: var(--fg-muted); margin-top: 4px; font-size: 11.5px; }
  .stip .dim { color: var(--fg-faint); }
  .wkl { display: grid; grid-template-columns: repeat(7, 1fr); margin-top: 3px; }
  .wkl span { text-align: center; font-size: 10.5px; color: var(--fg-faint); white-space: nowrap; }
  .wkl span.today { color: var(--fg); font-weight: 600; }
  .slg { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--fg-muted); margin-top: 6px; }
  .slg i { display: inline-block; width: 12px; height: 0; border-top: 3px solid currentColor; border-radius: 2px; vertical-align: middle; margin-right: 5px; }
  .slg i.d2 { border-top: 2px dashed currentColor; border-radius: 0; }
  .slg b { color: var(--fg); font: 600 12px var(--mono); }
  .slg .u { color: var(--fg-faint); }
  @media (max-width: 420px) { .card-h .aside { display: none; } }
  .sec-t { font-size: 12px; color: var(--fg-muted); font-weight: 500; margin: 18px 2px 6px; }
  .group { background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  .item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-top: 1px solid var(--line); }
  .item:first-child { border-top: 0; }
  .item .tx { flex: 1; min-width: 0; }
  .item .tx > b { display: block; font-weight: 500; }
  .item .tx > span { display: block; color: var(--fg-muted); font-size: 12px; overflow-wrap: anywhere; }
  .item .rt { color: var(--fg-muted); font-size: 12px; white-space: nowrap; }
  .sw { width: 34px; height: 20px; border-radius: 999px; background: var(--fill); position: relative; flex: none; border: 1px solid var(--line); cursor: pointer; padding: 0; }
  .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--bg); box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: left .15s; }
  .sw.on { background: var(--primary-c); border-color: var(--primary-c); }
  .sw.on::after { left: 16px; }
  .sw:disabled { opacity: .45; cursor: default; }
  .pick { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--fill); flex: none; }
  .pick button { border: 0; background: transparent; color: var(--fg-muted); font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
  .pick button:hover { color: var(--fg); }
  .pick button.on { background: var(--bg); color: var(--fg); box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.06); }
  .kbd { font: 11px var(--mono); padding: 0 5px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; color: var(--fg-muted); }
  .err { color: var(--bad); }
  details.adv { margin-top: 18px; }
  details.adv > summary { list-style: none; cursor: pointer; font-size: 12px; color: var(--fg-muted); font-weight: 500; margin: 0 2px 6px; display: flex; gap: 6px; align-items: baseline; }
  details.adv > summary::-webkit-details-marker { display: none; }
  details.adv > summary::before { content: "›"; display: inline-block; transition: transform .15s; font-size: 14px; line-height: 1; }
  details.adv[open] > summary::before { transform: rotate(90deg); }
  details.adv > summary em { font-style: normal; color: var(--fg-faint); font-weight: 400; }
  .kv { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 12px; border-top: 1px solid var(--line); font-size: 12.5px; }
  .kv:first-child { border-top: 0; }
  .kv > span:last-child { color: var(--fg-muted); text-align: right; min-width: 0; overflow-wrap: anywhere; }
  .note { padding: 0 12px 9px; color: var(--fg-muted); font-size: 12px; }
  .link { border: 0; background: none; padding: 0; color: var(--primary-c); font: inherit; font-size: 12px; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  code { font-family: var(--mono); font-size: 11.5px; }
  .miss { margin: 0; padding: 0 12px 10px 30px; font-size: 12px; color: var(--fg-muted); max-height: 260px; overflow: auto; user-select: text; }
  .miss li { overflow-wrap: anywhere; }
  footer { margin-top: 16px; color: var(--fg-faint); font-size: 11px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
</style>
<style id="barcss"></style>
<style id="palvars"></style>
<main>
  <div class="hd"><h1>agy-zh</h1><span class="ver" id="ver"></span><span class="sp"></span><button class="pill" id="pill"></button></div>
  <div class="msg" id="msg"></div>
  <div id="s-banner"></div>
  <div id="s-now"></div>
  <div id="s-week"></div>
  <div id="s-set"></div>
  <details class="adv" id="adv"><summary id="adv-sum">高级</summary><div id="s-adv"></div></details>
  <footer><span>非官方项目，和 Google 没有关系</span><code>github.com/ncdeng/agy-zh-pack</code></footer>
</main>
<script>
// 接收 Antigravity 的主题（和 SDK 的 preload.js 一样：theme-change 消息里是 CSS 变量），深浅按背景色判断。
// 深色时 body 加 theme-dark：状态栏预览用的是页面里的样式表，它按 body.theme-dark 换深色配色
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'theme-change' || !e.data.payload) return;
  const vars = e.data.payload.cssVariables || {};
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  const bg = getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);
  if (bg) {
    const dark = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) < 128;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.classList.toggle('theme-dark', dark);
  }
});
const token = new URLSearchParams(location.search).get('token') || '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const when = (ms) => { if (!ms) return ''; const d = new Date(ms); return (d.toDateString() === new Date().toDateString() ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const resetText = (ms, weekly) => { const d = new Date(ms); return (weekly ? WD[d.getDay()] + ' ' : '') + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 重置'; };
const leftText = (ms) => { const m = Math.max(0, Math.round((ms - Date.now()) / 60000)); return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60) + 'm 后' : m + ' 分钟后'; };
const usd = (v) => '$' + (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
const pct = (f) => Math.round(f * 100) + '%';
const MB = (b) => Math.round(b / 1048576) + ' MB';
const seg = (name, items, cur) => '<span class="pick">' + items.map(([v, t]) => '<button data-' + name + '="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + t + '</button>').join('') + '</span>';
// 状态栏上可以单独关掉的项（2026-11-27）：[名字, 按钮上的字, 悬停说明]。名字和 statusbar.js 的 BAR_ITEMS 一一对应
const BAR_ITEMS = [['model', '模型', '界面名和思考档位；接口返回的名字对不上时多一段黄字'], ['context', '上下文', '已用比例和 token 数，含压缩次数 ↻N×'],
  ['cache', '缓存命中', '最近一次调用的缓存命中率'], ['cost', '对话花费', '这个对话累计（含子代理），含很贵的调用的红色标记'],
  ['today', '今天花费', '今天所有对话和 agy CLI 的花费；关掉后每日用量从这里的按钮打开'], ['run', 'running', '正在生成；子代理窗格里是这个子代理的状态'],
  ['ttft', '首字', '最近一次调用的首字时间'], ['speed', 'tok/s', '最近一次调用的生成速度'], ['q5', '5h 额度', '5 小时额度：已用和重置时间'],
  ['qw', '周额度', '每周额度：已用、重置时间、比匀速快还是慢'], ['subs', '子代理行', '每个在跑的子代理一行']];
const sw = (id, on, disabled) => '<button class="sw' + (on ? ' on' : '') + '" id="' + id + '" role="switch" aria-checked="' + !!on + '"' + (disabled ? ' disabled' : '') + '></button>';
// tip：悬停提示（纯文字，这里转义）
const item = (title, desc, right, tip) => '<div class="item"' + (tip ? ' title="' + (Array.isArray(tip) ? tip.map(esc).join('&#10;') : esc(tip)) + '"' : '') + '><div class="tx"><b>' + title + '</b>' + (desc ? '<span>' + desc + '</span>' : '') + '</div>' + (right || '') + '</div>';
const kv = (k, v) => '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>';
const dot = (cls) => '<span class="sdot ' + cls + '"></span> ';
let busy = false;
let cssKey = '';
let missOpen = false;
let colorOpen = false; // “配色”里的自定义颜色展开着（已经自定义过的总是展开）
const themeMode = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
// 按所选配色（加上自定义的 4 个主色）设面板的颜色变量；浅色、深色各一段，主题切换时 CSS 自己换
const palVars = (lk) => {
  const base = lk.pals[lk.pal] ? lk.pals[lk.pal][1] : null;
  if (!base) return '';
  const one = (m) => { const c = { ...base[m], ...((lk.custom && lk.custom[m]) || {}) }; return ['cost', 'q5', 'qw', 'bad', 'ok', 'warn'].map((k) => '--' + k + ':' + c[k]).join(';'); };
  return ':root{' + one('light') + '} :root[data-theme="dark"]{' + one('dark') + '}';
};
let wkTab = 'cost'; // “最近 7 天”卡片的标签页：cost 花费 / speed 速度
try { if (localStorage.getItem('agyzh.wk') === 'speed') wkTab = 'speed'; } catch (e) {}
let spHover = null, spHoverC = -1; // 速度图悬停用：speedBlock 画图时记下每格的数据；鼠标所在的格（-1 = 不在图上）
let spRange = '24h'; // “速度”页的范围：24h 最近 24 小时 / today 今天 0 点起
try { if (localStorage.getItem('agyzh.spr') === 'today') spRange = 'today'; } catch (e) {}
const shown = {}; // 每一块上次的 HTML：没变就不重画（免得每 3 秒重画打断选择文字、收起展开的列表）
const put = (id, html) => { if (shown[id] === html) return false; shown[id] = html; $(id).innerHTML = html; return true; };
try { if (localStorage.getItem('agyzh.adv') === '1') $('adv').open = true; } catch (e) {}
$('adv').addEventListener('toggle', () => { try { localStorage.setItem('agyzh.adv', $('adv').open ? '1' : '0'); } catch (e) {} });
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-sidecar-token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const o = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(o.error || ('HTTP ' + r.status));
  return o;
}
// quiet：出错时顶上不重复显示（更新失败的原因写在横幅里）
async function act(body, okText, quiet) {
  if (busy) return; busy = true;
  try { await api('/api/action', body); $('msg').textContent = okText || ''; clearTimeout(act.t); act.t = setTimeout(() => { $('msg').textContent = ''; }, 4000); }
  catch (e) { $('msg').innerHTML = quiet ? '' : '<span class="err">' + esc(e.message) + '</span>'; }
  finally { busy = false; setTimeout(refresh, 600); }
}
// 图标字体（状态栏样式表里 @import 的 Material Symbols）：加载上以前不显示图标，免得露出图标名的英文。
// 用 document.fonts.load 主动加载：面板藏着（宽高为 0）时浏览器不会因为排版去加载字体，图标藏起来以后也不会；
// 刚放进样式表时 @import 还没下载完、@import 被拦时都没有这个字体，load 返回空列表。8 秒没加载上算失败；
// 失败了前 10 次每 2 秒再试（等 @import 下载完），以后每 60 秒再试。结果记在 iconsOk，卡片重画时照着加类
let iconFam = '', iconsOk = false, iconTry = 0;
async function checkIcons() {
  const e = document.querySelector('.sbwrap .ic:not(.uni)');
  const fam = e ? getComputedStyle(e).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '') : '';
  if (!fam || fam === iconFam) return;
  iconFam = fam;
  let ok = false;
  try {
    const faces = await Promise.race([document.fonts.load('15px "' + fam + '"', e.textContent || 'a'), new Promise((r) => setTimeout(() => r(null), 8000))]);
    ok = !!(faces && faces.length);
  } catch (err) { /* 字体文件下载失败 */ }
  iconsOk = ok;
  const w = document.querySelector('.sbwrap');
  if (w) w.classList.toggle('noicons', !ok);
  if (ok) { iconTry = 0; return; }
  iconTry++;
  setTimeout(() => { if (iconFam === fam) { iconFam = ''; checkIcons(); } }, iconTry < 10 ? 2000 : 60000);
}
// “速度”页（v2.0.15）：snap.speed（statusbar.js 的 speedNow）里最多 3 个模型每小时的 tok/s 中位数。横轴 24 格：
//   24h = 最近 24 个整点小时（最右边是现在这个小时，凌晨看也有昨晚的）；today = 今天 0 点到 23 点（还没到的小时空着）。
// 纵轴按数据范围画（上下各留四分之一、取整到 10，范围至少 20）：从 0 画起时图只有 56 像素高，线几乎是平的；上下两条虚线标出纵轴的两头。
// 相邻两个点之间空了 2 个小时以上就断开，不连线。图例写“现在”（最近 60 分钟的中位数）和“平时”（前 7 天每天中位数的中位数），
// 现在比平时慢四成以上标黄。颜色是主窗口状态栏当前配色里这个价目的颜色（只认 #rrggbb / rgb()，别的用灰色）
const speedRange = (vals) => {
  const mn = Math.min(...vals), mx = Math.max(...vals), span = Math.max(mx - mn, 20);
  return [Math.max(0, Math.floor((mn - span / 4) / 10) * 10), Math.ceil((mx + span / 4) / 10) * 10];
};
const safeColor = (c) => (/^(#[0-9a-fA-F]{3,8}|rgba?\\([\\d\\s.,%]+\\))$/.test(String(c || '')) ? c : 'var(--fg-muted)'); // 在模板字符串里，反斜杠写两个
const HOUR = 3600e3;
const hhmm = (ms) => pad(new Date(ms).getHours()) + ':00';
function speedBlock(sp, range) {
  spHover = null;
  const ms = (sp && Array.isArray(sp.models) ? sp.models : []).filter((m) => Array.isArray(m.pts) && m.pts.length === 24);
  if (!ms.length) return '<div class="empty">24h 内没有速度数据（每 5 分钟算一次；一小时不到 3 次调用不画）</div>';
  const start = range === 'today' ? +sp.today0 : +sp.start;
  const col = (j) => Math.round((+sp.start + j * HOUR - start) / HOUR); // 第 j 个小时画在第几格
  const cNow = col(23);
  const series = ms.map((m) => ({ m, c: safeColor(m.color), pts: m.pts.map((v, j) => (typeof v === 'number' && v > 0 ? [col(j), v, j] : null)).filter((p) => p && p[0] >= 0 && p[0] < 24) }));
  const vals = series.flatMap((x) => x.pts.map((p) => p[1]));
  if (!vals.length) return '<div class="empty">' + (range === 'today' ? '今天' : '24h 内') + '没有速度数据（一小时不到 3 次调用不画）</div>';
  const [lo, hi] = speedRange(vals);
  const X = (c) => (c + 0.5) / 24 * 100, Y = (v) => (1 - (v - lo) / (hi - lo)) * 100;
  let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none">', dots = '';
  for (const x of series.slice().reverse()) { // 调用最多的最后画，在最上面
    let seg = [];
    const flush = () => {
      if (seg.length > 1) svg += '<path class="' + (x.m.dash ? 'd2' : '') + '" stroke="' + esc(x.c) + '" d="M' + seg.map((p) => X(p[0]).toFixed(2) + ' ' + Y(p[1]).toFixed(2)).join(' L') + '"/>';
      seg = [];
    };
    for (const p of x.pts) { if (seg.length && p[0] - seg[seg.length - 1][0] > 3) flush(); seg.push(p); }
    flush();
    for (const p of x.pts) {
      dots += '<span class="pt" data-c="' + p[0] + '" style="left:' + X(p[0]).toFixed(2) + '%;top:' + Y(p[1]).toFixed(2) + '%;background:' + esc(x.c) + '"></span>';
    }
  }
  svg += '</svg>';
  const grid = '<div class="gl" style="top:0"><span class="hi">' + hi + '</span></div><div class="gl" style="top:100%"><span>' + lo + '</span></div>';
  const cur = cNow >= 0 && cNow < 24 ? '<div class="cur" style="left:' + (cNow / 24 * 100).toFixed(2) + '%;width:' + (100 / 24).toFixed(2) + '%"></div>' : '';
  let labels = '<div class="wkl h24">';
  for (let c = 0; c < 24; c++) {
    const hr = new Date(start + c * HOUR).getHours();
    const t = c === cNow ? '现在' : hr % 3 === 0 && Math.abs(c - cNow) > 1 ? hhmm(start + c * HOUR) : '';
    labels += '<span class="' + (c === cNow ? 'today' : '') + '">' + t + '</span>';
  }
  labels += '</div>';
  const legend = '<div class="slg">' + ms.map((m) => {
    const slow = m.now != null && m.usual > 0 && m.now < m.usual * 0.6;
    const tip = [m.name, '近 60 分钟 ' + (m.now != null ? m.now + ' tok/s（' + m.nowN + ' 次）' : '不到 3 次，不算'),
      '平时 ' + (m.usual != null ? Math.round(m.usual) + ' tok/s' : '暂无') + (slow ? ' · 现在 ↓ ' + Math.round((1 - m.now / m.usual) * 100) + '%' : '')].map(esc).join('&#10;');
    return '<span title="' + tip + '"><i class="' + (m.dash ? 'd2' : '') + '" style="color:' + esc(safeColor(m.color)) + '"></i>' + esc(m.short) +
      ' <b class="' + (slow ? 'slow' : '') + '">' + (m.now != null ? m.now : '—') + '</b>' + (m.usual != null ? '<span class="u"> 平时 ' + Math.round(m.usual) + '</span>' : '') + '</span>';
  }).join('') + '<span class="u">现在 = 近 1h · tok/s</span></div>';
  spHover = { start, cNow, offset: Math.round((start - sp.start) / HOUR), models: ms.map((m) => ({ short: m.short, color: safeColor(m.color), dash: !!m.dash, pts: m.pts, ns: m.ns || [],
    now: m.now, nowN: m.nowN, usual: m.usual })) };
  return '<div class="spd" id="spd">' + cur + grid + svg + dots + '<div class="vl" id="svl" hidden></div><div class="stip" id="stip" hidden></div></div>' + labels + legend;
}
// 鼠标停在速度图的第 c 格：竖线移过去，这一格的圆点放大，小框列出这个小时每个模型的速度和调用次数；
// 现在这一格再写最近 60 分钟的速度。小框在竖线右边，竖线过了一半就放到左边
function spdShow(c) {
  const h = spHover, box = $('stip'), vl = $('svl'), host = $('spd');
  if (!h || !box || !vl || !host) return;
  const j = c + h.offset, t = h.start + c * HOUR;
  let html = '<div class="st-h">' + hhmm(t) + '–' + hhmm(t + HOUR) + (c === h.cNow ? ' · 现在' : '') + '</div>';
  if (c > h.cNow) html += '<div class="st-r dim">还没到</div>';
  else {
    for (const m of h.models) {
      const v = j >= 0 && j < 24 ? m.pts[j] : null, n = j >= 0 && j < 24 ? +m.ns[j] || 0 : 0;
      html += '<div class="st-r"><i class="' + (m.dash ? 'd2' : '') + '" style="color:' + esc(m.color) + '"></i>' + esc(m.short) +
        '<b>' + (v != null ? v + ' tok/s' : '—') + '</b><span>' + (n ? n + ' 次' : '—') + '</span></div>';
    }
    if (h.models.some((m) => { const n = j >= 0 && j < 24 ? +m.ns[j] || 0 : 0; return n > 0 && (j < 0 || j > 23 || m.pts[j] == null); })) html += '<div class="st-f">— = 不到 3 次，不算</div>';
  }
  if (c === h.cNow) {
    html += '<div class="st-f">近 60 分钟</div>';
    for (const m of h.models) {
      const slow = m.now != null && m.usual > 0 && m.now < m.usual * 0.6;
      html += '<div class="st-r"><i class="' + (m.dash ? 'd2' : '') + '" style="color:' + esc(m.color) + '"></i>' + esc(m.short) +
        '<b class="' + (slow ? 'slow' : '') + '">' + (m.now != null ? m.now + ' tok/s' : '—') + '</b><span>' + (m.usual != null ? '平时 ' + Math.round(m.usual) : '') + '</span></div>';
    }
  }
  html += '<div class="st-f">点击看 30 天走势</div>';
  box.innerHTML = html;
  box.hidden = false;
  const x = (c + 0.5) / 24 * 100;
  vl.style.left = x + '%';
  vl.hidden = false;
  if (x > 50) { box.style.left = ''; box.style.right = (100 - x) + '%'; box.classList.add('l'); }
  else { box.style.right = ''; box.style.left = x + '%'; box.classList.remove('l'); }
  host.querySelectorAll('.pt').forEach((d) => d.classList.toggle('on', +d.dataset.c === c));
}
function spdHide() {
  const box = $('stip'), vl = $('svl'), host = $('spd');
  if (box) box.hidden = true;
  if (vl) vl.hidden = true;
  if (host) host.querySelectorAll('.pt.on').forEach((d) => d.classList.remove('on'));
}
// “今天”卡片的额度格子（v2.0.17 用户选的方案 A）：当前模型那一组的 5h 和每周额度，每行实色是已用，浅色画到重置时预计用到的位置，
// 右边写“已用 → 预计”，竖线是时间进度。预计会用超：浅色那段换成红色斜纹、右边写“→ 超”，格子标黄，下面写大约什么时候用完。
// 下面是费用（v2.0.18 起 5h 和周各一行）：这个周期花了多少 / 按已用比例推出的整个额度大约多少钱。v2.0.18 小字精简：5h / 周、≈、→
// q.est = { proj, fullAt, rough, basis }（每周的来自注入程序的预估，5h 的按这个窗口的平均速度）；q.cost = { usd, cap, tok, capTok, rough }
const quotaTile = (qs) => {
  if (!qs || !qs.length) return '<div class="tile"><div class="k">额度</div><div class="v">—</div><div class="s">还没查到</div></div>';
  const name = (q) => (q.weekly ? '周' : '5h');
  const money = (v) => (v >= 100 ? '$' + Math.round(v).toLocaleString('en-US') : usd(v));
  const kTok = (n) => { const f = (v, u) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)) + u; return n >= 1e9 ? f(n / 1e9, 'B') : n >= 1e6 ? f(n / 1e6, 'M') : f(n / 1e3, 'k'); };
  // tips：鼠标悬停时的系统提示，一行一件事，只写格子上没有的（重置时间、token）；行之间用 &#10; 换行（网页代码写在模板字符串里，不能写反斜杠 n）
  const lines = [], tips = [], toks = [], costs = [];
  let warn = false;
  const rows = qs.map((q) => {
    const col = q.weekly ? 'var(--qw)' : 'var(--q5)';
    const e = q.est && q.est.proj > 0 ? q.est : null;
    const over = !!e && e.proj > 1;
    if (over) { warn = true; if (e.fullAt) lines.push(name(q) + ' ≈' + when(e.fullAt) + ' 用完'); }
    const proj = e && e.proj > q.used ? '<i class="proj' + (over ? ' over' : '') + '" style="width:' + Math.round(Math.min(1, e.proj) * 100) + '%;background:' + col + '"></i>' : '';
    if (q.reset > 0) tips.push(name(q) + ' ' + resetText(q.reset, q.weekly) + (q.weekly ? '' : ' · ' + leftText(q.reset)));
    const c = q.cost;
    if (c && c.usd > 0) {
      costs.push('<div class="qcost"><span class="ql">' + name(q) + '</span> <b>' + money(c.usd) + '</b>' + (c.cap > 0 ? ' / ≈<b>' + money(c.cap) + '</b>' + (c.rough ? ' <span>粗估</span>' : '') : '') + '</div>');
      if (c.tok > 0) toks.push(name(q) + ' ' + kTok(c.tok) + (c.cap > 0 && c.capTok > 0 ? ' / ≈' + kTok(c.capTok) : '') + ' token');
    }
    return '<span>' + name(q) + '</span><div class="qbar">' + proj + '<i style="width:' + Math.round(q.used * 100) + '%;background:' + col + '"></i>' +
      (q.timePct != null ? '<b style="left:' + Math.round(q.timePct * 100) + '%"></b>' : '') + '</div><b>' + pct(q.used) +
      (e ? ' <em' + (over ? ' class="over"' : '') + '>→ ' + (over ? '超' : pct(e.proj)) + '</em>' : '') + '</b>';
  }).join('');
  return '<div class="tile' + (warn ? ' warn' : '') + '" title="' + tips.concat(toks).map(esc).join('&#10;') + '"><div class="k">' + esc(qs[0].group) + ' 额度</div><div class="q2">' + rows + '</div>' + costs.join('') +
    lines.map((l) => '<div class="s bad">' + esc(l) + '</div>').join('') + '</div>';
};
function render(o) {
  const st = o.st, u = o.update, rl = o.relaunch, r = st.remote, s = r.st || {};
  const p = o.panel || {}, snap = p.snap;
  const isMac = o.platform === 'darwin';
  $('ver').textContent = 'v' + st.version;
  if (p.css && p.cssKey) { $('barcss').textContent = p.css; cssKey = p.cssKey; iconFam = ''; iconTry = 0; } // 换了样式表（例如换了图标风格）就重新检查字体
  const lk = snap && snap.look && snap.look.pals ? snap.look : null;
  if (lk) { const pv = palVars(lk); if ($('palvars').textContent !== pv) $('palvars').textContent = pv; }
  const stt = u.state || {};
  const prog = { downloading: '正在下载…', verifying: '正在核对签名和文件…', installing: '正在安装…' }[stt.status];
  const modified = u.integrity && u.integrity.status === 'modified';
  // 顶部状态点
  const pill = !st.port.ok ? ['bad', '没连上'] : !st.lockHeld ? ['warn', '待命'] : modified ? ['warn', '文件和签名不一致'] : u.available ? ['warn', '有新版本'] : ['ok', '一切正常'];
  put('pill', dot(pill[0]) + pill[1]);
  // 横幅：没带调试端口（带参数重启）、有新版本（更新）、上次没装上
  let h = '';
  if (!st.port.ok) {
    h += '<div class="banner bad"><span class="sdot bad"></span><div class="t"><b>这次启动没带调试端口参数</b><span>汉化和状态栏没生效（要带 <code>--remote-debugging-port=0</code>）</span></div>' +
      (rl.supported ? '<button class="btn accent" id="b-rl">带参数重启</button>' : '') + '</div>';
  }
  if (u.available || prog) {
    h += '<div class="banner upd"><span class="sdot warn"></span><div class="t"><b>' + (prog || '有新版本 v' + esc(u.latest)) + '</b><span>' +
      (u.date ? esc(u.date) + ' 发布 · ' : '') + '先验签名和文件再装 · 装好自动重启</span></div>' +
      (prog ? '' : '<button class="btn accent" id="b-upd">更新</button>') + '</div>';
  }
  if (stt.status === 'failed' && stt.error) h += '<div class="banner bad"><span class="sdot bad"></span><div class="t"><b>上次没装上</b><span>' + esc(stt.error) + '</span></div></div>';
  put('s-banner', h);
  // “今天”卡片（v2.0.15 方案 A）：四个格子各回答一个问题——花了多少、额度够不够、现在快不快、有没有白花的钱；当前对话缩成下面一行。
  // 不正常的格子标黄：每周额度预计用超、5 小时额度用了一半以上、速度比平时慢四成以上、没命中占今天花费三成以上。
  // 状态栏预览只在关掉“显示用量状态栏”时显示（那时侧栏是唯一能看到那些数字的地方）
  h = '<div class="card">';
  if (!snap) {
    h += '<div class="card-h"><span class="ttl">今天</span></div><div class="empty">' +
      (st.port.ok ? (st.windows ? '正在读窗口里的数据…' : '还没有打开的 Antigravity 窗口。') : '连上调试端口以后这里显示今天的用量。') + '</div>';
  } else {
    h += '<div class="card-h"><span class="ttl">今天</span></div>';
    if (snap.barOff && snap.bar && snap.bar.html && cssKey === snap.bar.css) h += '<div class="sbwrap' + (iconsOk ? '' : ' noicons') + '">' + snap.bar.html + '</div>';
    const t = snap.today || {};
    const tiles = [];
    // 花费
    tiles.push('<div class="tile" title="今天 ' + (+t.convs || 0) + ' 个对话、' + (+t.calls || 0) + ' 次调用' + (t.cliUsd > 0 ? '&#10;含 agy CLI ' + usd(t.cliUsd) : '') + '&#10;按 API 标准价折算"><div class="k">花费</div><div class="v" style="color:var(--cost)">' + usd(+t.usd || 0) + '</div><div class="s">' +
      (+t.convs || 0) + ' 对话 · ' + (+t.calls || 0) + ' 次' + (t.cliUsd > 0 ? '<br>CLI ' + usd(t.cliUsd) : '') + '</div></div>');
    // 额度：方案 A（quotaTile）：进度条上画出预估，下面一行费用
    tiles.push(quotaTile(snap.quota));
    // 生成速度：最近 1 小时调用最多的模型（没有就写今天的），和平时（前 7 天）比；点一下切到下面的“速度”图
    const sp = snap.speedTop;
    if (!sp) tiles.push('<div class="tile"><div class="k">速度</div><div class="v">—</div><div class="s">几分钟后再看</div></div>');
    else {
      const r = sp.usual > 0 ? sp.v / sp.usual : null;
      const slow = r != null && r < 0.6;
      const cmp = r == null ? '暂无平时' : slow ? '↓ ' + Math.round((1 - r) * 100) + '%' : r > 1.4 ? '↑ ' + Math.round((r - 1) * 100) + '%' : '≈ 平时';
      tiles.push('<div class="tile clk' + (slow ? ' warn' : '') + '" id="t-spd" title="' + [sp.name + ' · ' + (sp.span === 'hour' ? '近 60 分钟' : '今天') + ' ' + sp.n + ' 次的中位数', '平时 = 前 7 天每天中位数的中位数', '点击看走势'].map(esc).join('&#10;') +
        '"><div class="k">速度 · ' + (sp.span === 'hour' ? '近 1h' : '今天') + '</div><div class="v' +
        (slow ? ' slow' : '') + '">' + sp.v + ' <small>tok/s</small></div><div class="s">' + esc(sp.short) + (sp.usual > 0 ? ' · 平时 ' + Math.round(sp.usual) : '') + '<br>' + cmp + '</div></div>');
    }
    // 缓存没命中：今天多花的钱、占今天花费的比例、最多的原因；点一下打开今天只看没命中的明细
    const mi = snap.miss;
    const CAUSE = { user: '你停下来', turn: '一轮内间隔', wait: '间隔', compact: '压缩', model: '换模型', other: '其他' };
    if (!mi) tiles.push('<div class="tile"><div class="k">缓存没命中</div><div class="v">—</div><div class="s">几分钟后再看</div></div>');
    else if (!mi.n) tiles.push('<div class="tile"><div class="k">缓存没命中</div><div class="v" style="color:var(--ok)">$0</div><div class="s">今天没有</div></div>');
    else {
      const den = +t.usd > 0 ? +t.usd : mi.total, share = den > 0 ? mi.usd / den : 0, top = mi.by[0]; // 分母用左上角的“今天花费”，两个格子对得上
      const tip = ['没命中 ' + mi.n + ' 次 · 多花 ≈' + usd(mi.usd) + '（API 价）'].concat(mi.by.map((b) => (CAUSE[b[0]] || b[0]) + ' ' + b[1] + ' 次 ' + usd(b[2])), ['点击只看没命中']).map(esc).join('&#10;');
      tiles.push('<div class="tile clk' + (share >= 0.3 ? ' warn' : '') + '" id="t-miss" title="' + tip + '"><div class="k">缓存没命中</div><div class="v" style="color:var(--q5)">+' + usd(mi.usd) +
        '</div><div class="s">' + mi.n + ' 次 · 占 ' + pct(share) + (top ? '<br>最多：' + (CAUSE[top[0]] || esc(top[0])) + ' ' + usd(top[2]) : '') + '</div></div>');
    }
    h += '<div class="grid2">' + tiles.join('') + '</div>';
    // 当前对话一行
    const c = snap.conv;
    if (c) {
      const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1000) + 'k');
      const parts = [];
      if (c.usd != null) parts.push('<b style="color:var(--cost)">' + usd(c.usd) + '</b>');
      if (c.ctx) parts.push('上下文 <b>' + pct(c.ctx.used / c.ctx.max) + '</b> (' + kTok(c.ctx.used) + ')');
      if (c.comps) parts.push('压缩 ×<b>' + c.comps + '</b>');
      if (c.hit != null) parts.push('命中 <b>' + pct(c.hit) + '</b>');
      h += '<div class="sep"></div><div class="conv"><div class="card-h" style="margin:0"><span class="ttl">当前对话 · <b>' + esc(c.title || '（无标题）') + '</b></span>' +
        (c.running ? '<span class="run"><i></i>运行中</span>' : '<span class="run idle"><i></i>空闲</span>') + '</div>' + (parts.length ? '<div class="nums">' + parts.join(' · ') + '</div>' : '') + '</div>';
    }
    h += '<div class="acts"><button class="btn primary" data-view="usage">每日用量</button><button class="btn" data-view="calls">调用明细</button><button class="btn" data-view="look">外观</button></div>';
  }
  h += '</div>';
  put('s-now', h);
  checkIcons();
  // 最近 7 天（点柱子打开那一天的调用明细）
  h = '';
  if (snap && snap.week && snap.week.length) {
    const wk = snap.week, max = Math.max(1e-9, ...wk.map((d) => d.usd)), last = wk.length - 1;
    const total = wk.reduce((a, d) => a + d.usd, 0), used = wk.filter((d) => d.usd > 0).length;
    const tabs = '<span class="pick sm">' + [['cost', '花费'], ['speed', '速度']].map(([v, t]) => '<button data-wk="' + v + '" class="' + (v === wkTab ? 'on' : '') + '">' + t + '</button>').join('') + '</span>';
    const rg = '<span class="pick sm">' + [['24h', '24h'], ['today', '今天']].map(([v, t]) => '<button data-spr="' + v + '" class="' + (v === spRange ? 'on' : '') + '">' + t + '</button>').join('') + '</span>';
    h += '<div class="card"><div class="card-h"><span class="ttl">' + (wkTab === 'speed' ? '生成速度' : '最近 7 天') + '</span>' +
      (wkTab === 'speed' ? rg : '<span class="aside">API 价 · 点柱子看明细</span>') + tabs + '</div>';
    if (wkTab === 'speed') h += speedBlock(snap.speed, spRange) + '</div>';
    else h += '<div class="week">' +
      wk.map((d, i) => '<button class="' + (i === last ? 'today' : '') + '" data-day="' + esc(d.day) + '" title="' + esc(d.day) + ' ' + usd(d.usd) + '"><i style="height:' +
        Math.max(2, Math.round(d.usd / max * 54)) + 'px"></i><span>' + (i === last ? '今天' : esc(d.day.slice(5))) + '</span></button>').join('') +
      '</div><div class="wsum"><span>合计 <b>' + usd(total) + '</b>' + (used ? ' · 日均 <b>' + usd(total / used) + '</b>（' + used + ' 天）' : '') + '</span></div></div>';
  }
  put('s-week', h);
  // 设置：两组，每项尽量一行；只有要你注意的才写在标题下面，其余说明放在悬停提示里（item 的第 4 个参数）
  h = '<div class="sec-t">显示</div><div class="group">';
  const zhSub = !st.i18n ? '没有词典文件，汉化没加载'
    : !st.zhOn ? ''
    : '临时切回英文 <span class="kbd">' + (isMac ? 'Ctrl+Option+E' : 'Ctrl+Alt+E') + '</span>' + (st.port.ok ? ' · <button class="link" id="b-en">现在切换</button>' : '');
  h += item('中文界面', zhSub, sw('t-zh', st.zhOn && st.i18n, !st.i18n),
    ['主窗口和 Swarm 面板一起切，立即生效，不动对话和代码', '临时英文：所有窗口一起切，再按一次或刷新恢复']);
  h += item('显示用量状态栏', st.statusbar && !st.barOn ? '已隐藏 · 每日用量仍可从上面打开' : '', sw('t-bar', st.barOn && st.statusbar, !st.statusbar),
    ['输入框上方那两行', '进度条、图标在每日用量 → 外观里换']);
  // 状态栏显示哪些项（2026-11-27，用户要的）：每项一个按钮，亮着的显示，点一下切换；默认全部显示
  if (lk && lk.hide) {
    const hid = lk.hide;
    const chips = BAR_ITEMS.map(([k, t, tip]) => '<button class="' + (hid.includes(k) ? '' : 'on') + '" data-bi="' + k + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + esc(t) + '</button>').join('') +
      (hid.length ? '<button class="all" id="b-biall">全部显示</button>' : '');
    h += '<div class="item colrow"><div class="tx"><b>状态栏显示哪些项</b><span>' + (hid.length ? '已隐藏 ' + hid.length + ' 项 · ' : '') + '亮着的显示，点一下切换</span></div><div class="palc bi">' + chips + '</div></div>';
  }
  // 配色（v2.0.18，用户选的方案 A + 自定义）：和状态栏、每日用量面板共用一个配色，默认 Cometix；“自定义…”在所选配色上改 4 个主色，
  // 只改现在这种主题（浅色 / 深色）的那一份
  if (lk) {
    const mode = themeMode(), cus = lk.custom && lk.custom[mode];
    // 有自定义颜色时只亮“自定义…”，所基于的那套配色画虚线框（11-27 用户：Cometix 和自定义同时亮着，看不出用的是哪个）
    const chips = Object.entries(lk.pals).map(([k, [nm, c]]) => '<button class="' + (k === lk.pal ? (cus ? 'base' : 'on') : '') + '" data-pal="' + esc(k) + '"' +
      (k === lk.pal && cus ? ' title="自定义颜色基于这套；点一下改回这套原来的颜色"' : '') + '><span class="pd"><i style="background:' + c[mode].cost +
      '"></i><i style="background:' + c[mode].q5 + '"></i><i style="background:' + c[mode].ok + '"></i></span>' + esc(nm) + '</button>').join('') +
      '<button class="' + (cus ? 'on' : colorOpen ? 'base' : '') + '" id="b-cus">自定义…</button>';
    let edit = '';
    if (cus || colorOpen) {
      const baseName = (lk.pals[lk.pal] || lk.pals.cometix)[0];
      const now = { ...(lk.pals[lk.pal] || lk.pals.cometix)[1][mode], ...(cus || {}) };
      edit = '<div class="palx">' + [['cost', '花费'], ['q5', '5h 额度'], ['qw', '周额度'], ['bad', '提醒 / 超额']].map(([k, t]) =>
        '<label><input type="color" data-ck="' + k + '" value="' + esc(now[k]) + '">' + t + '</label>').join('') +
        '<div class="pa"><span>在 ' + esc(baseName) + ' 上改 · 只改' + (mode === 'dark' ? '深色' : '浅色') + '主题</span>' + (cus ? '<button class="btn" id="b-cusr">还原成 ' + esc(baseName) + '</button>' : '') + '</div></div>';
    }
    h += '<div class="item colrow"><div class="tx"><b>配色</b><span>状态栏 · 每日用量 · 插件面板通用</span></div><div class="palc">' + chips + '</div>' + edit + '</div>';
  }
  h += '</div><div class="sec-t">更新与启动</div><div class="group">';
  const verText = prog || (!u.online ? '在线更新关着' : !u.latest ? '还没查到最新版本' : u.available ? '有新版本 v' + esc(u.latest) : '已是最新');
  h += item('插件版本', '', '<span class="rt">v' + esc(u.current) + ' · ' + verText + '</span>' + (u.online ? '<button class="btn" id="b-chk">检查</button>' : ''),
    (stt.status === 'installed' && stt.version === u.current && stt.from ? '已从 v' + stt.from + ' 更新。' : '') + (u.online ? '“检查”同时查新版本、词典和价格' : '在线更新关着，不检查新版本'));
  let dictSub = '不联网 · 用自带的词典和价格', dictTip = '关掉后也不查新版本';
  if (st.online) {
    dictSub = s.okAt ? '上次检查 ' + when(s.okAt) : (s.at ? '还没检查成功' : '启动约 1 分钟后检查');
    dictTip = [s.host ? '地址 ' + s.host : '', s.dictN ? '词典 ' + s.dictN + ' 条 · 规则 ' + s.rulesN + ' 条' : '词典用自带的',
      r.prices ? '价格表 ' + r.prices.updated : '价格表用内置的'].filter(Boolean).join(' · ');
    if (s.err) dictSub += '<br><span class="err">' + esc(s.err) + '</span>';
  }
  h += item('词典和价格', dictSub, seg('online', [['on', '自动'], ['off', '关闭']], st.online ? 'on' : 'off'), dictTip);
  if (!rl.supported) h += item('没带调试端口时', '这个系统不支持自动重开', '');
  else h += item('没带调试端口时', '', seg('mode', [['ask', '询问'], ['auto', '自动重开'], ['never', '不处理']], rl.mode),
    [isMac ? '从程序坞打开总是不带参数，选“自动重开”免确认' : '快捷方式已带参数；Antigravity 自更新后重启可能不带',
    '不带参数时汉化和状态栏不生效', '询问：每次问 · 自动重开：直接带参数重开 · 不处理：不管']);
  h += '</div>';
  put('s-set', h);
  // 高级：运行状态、内存、没翻译的界面文字
  const ms = o.missing;
  put('adv-sum', '高级 <em>· ' + (pill[0] === 'ok' ? '运行状态正常' : pill[1]) + (ms ? ' · 没翻译的文字 ' + ms.count + ' 条' : '') + '</em>');
  h = '<div class="group">';
  h += kv('注入', st.lockHeld ? dot('ok') + '正常' : dot('warn') + '待命（已有别的注入程序在跑）');
  h += kv('调试端口', st.port.ok ? dot('ok') + '已连上 · ' + st.windows + ' 个窗口' : dot('bad') + '没开');
  h += kv('汉化', !st.i18n ? '没加载' : !st.zhOn ? '已关闭' : '已加载' + (st.frames ? ' · 含 Swarm 面板' : ''));
  h += kv('用量状态栏', !st.statusbar ? '没加载' : st.barOn ? '已加载' : '已加载 · 隐藏');
  if (u.integrity && u.integrity.status) h += kv('插件文件', modified ? dot('warn') + u.integrity.changed.length + ' 个文件和签名清单不一致' : '和签名清单一致');
  if (o.mem) h += kv('内存', MB(o.mem.rss) + '<span title="RSS 含和 Antigravity 共用的程序文件；JS 堆是插件自己的对象">（RSS）· JS 堆 ' + MB(o.mem.heap) + '</span>');
  if (ms) {
    h += kv('没翻译的界面文字', ms.count + ' 条' + (ms.count ? ' · <button class="link" id="b-mls">' + (missOpen ? '收起' : '查看') + '</button> · <button class="link" id="b-mclr">清空</button>' : ''));
    h += '<div class="note">存在本机 <code>' + esc(ms.file) + '</code>，不上传 · 可能含项目名、对话标题</div>';
    if (missOpen && ms.count) h += '<ul class="miss">' + ms.items.map((e) => '<li>' + esc(e.t) + '</li>').join('') + '</ul>';
  }
  h += '</div>';
  put('s-adv', h);
  // 按钮
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('pill', () => { $('adv').open = true; $('adv').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  on('b-rl', () => act({ action: 'relaunch' }, '正在重启 Antigravity…'));
  on('b-chk', () => act({ action: 'check-data' }, '几秒后检查'));
  on('b-upd', () => act({ action: 'install', version: u.latest }, '已更新，插件马上重启', true));
  on('b-mclr', () => act({ action: 'clear-missing' }, '已清空'));
  on('b-mls', () => { missOpen = !missOpen; shown['s-adv'] = ''; refresh(); });
  on('b-en', () => act({ action: 'toggle-english' }, '已切换，回到 Antigravity 窗口查看'));
  on('t-zh', () => act({ action: 'zh', on: !st.zhOn }, st.zhOn ? '已关闭中文界面' : '已打开中文界面'));
  on('t-bar', () => act({ action: 'statusbar', on: !st.barOn }, st.barOn ? '已隐藏状态栏' : '已显示状态栏'));
  // 状态栏显示哪些项：先在按钮上切换，再按所有按钮现在的样子存（连着点几下时不会用到旧的快照）
  document.querySelectorAll('[data-bi]').forEach((b) => { b.onclick = () => {
    if (busy) return;
    b.classList.toggle('on');
    const hide = [...document.querySelectorAll('[data-bi]')].filter((x) => !x.classList.contains('on')).map((x) => x.dataset.bi);
    act({ action: 'items', hide }, (b.classList.contains('on') ? '已显示“' : '已隐藏“') + b.textContent + '”');
  }; });
  on('b-biall', () => act({ action: 'items', hide: [] }, '状态栏各项都已显示'));
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => act({ action: 'open-view', view: b.dataset.view }, '已在 Antigravity 窗口里打开'); });
  on('spd', () => act({ action: 'open-view', view: 'speed' }, '已在 Antigravity 窗口里打开速度页'));
  on('t-spd', () => { if (wkTab !== 'speed') { wkTab = 'speed'; try { localStorage.setItem('agyzh.wk', wkTab); } catch (e) {} refresh(); } $('s-week').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  on('t-miss', () => act({ action: 'open-view', view: 'miss' }, '已在 Antigravity 窗口里打开今天没命中的调用'));
  const spEl = $('spd');
  if (spEl) {
    spEl.onmousemove = (e) => {
      const r = spEl.getBoundingClientRect();
      const c = Math.max(0, Math.min(23, Math.floor((e.clientX - r.left) / r.width * 24)));
      if (c !== spHoverC || $('stip').hidden) { spHoverC = c; spdShow(c); }
    };
    spEl.onmouseleave = () => { spHoverC = -1; spdHide(); };
    if (spHoverC >= 0 && spEl.matches(':hover')) spdShow(spHoverC);
  }
  document.querySelectorAll('[data-spr]').forEach((b) => { b.onclick = () => { if (spRange === b.dataset.spr) return; spRange = b.dataset.spr; try { localStorage.setItem('agyzh.spr', spRange); } catch (e) {} refresh(); }; });
  document.querySelectorAll('[data-wk]').forEach((b) => { b.onclick = () => { if (wkTab === b.dataset.wk) return; wkTab = b.dataset.wk; try { localStorage.setItem('agyzh.wk', wkTab); } catch (e) {} refresh(); }; });
  document.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => act({ action: 'open-view', view: 'calls', day: b.dataset.day }, '已在 Antigravity 窗口里打开 ' + b.dataset.day + ' 的明细'); });
  document.querySelectorAll('[data-online]').forEach((b) => { b.onclick = () => act({ action: 'online', on: b.dataset.online === 'on' }, b.dataset.online === 'on' ? '在线更新已打开' : '在线更新已关闭'); });
  document.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => act({ action: 'relaunch-mode', mode: b.dataset.mode }, '已保存'); });
  document.querySelectorAll('.palc [data-pal]').forEach((b) => { b.onclick = () => { if (lk && (b.dataset.pal !== lk.pal || lk.custom)) { colorOpen = false; act({ action: 'pal', pal: b.dataset.pal }, '已换配色，状态栏和每日用量面板一起换'); } }; });
  on('b-cus', () => { colorOpen = !colorOpen; shown['s-set'] = ''; refresh(); });
  on('b-cusr', () => { colorOpen = false; act({ action: 'colors', mode: themeMode(), colors: null }, '已还原'); });
  // 取色器选定（change，拖动时的 input 不保存）：4 个颜色一起存
  document.querySelectorAll('.palx input[type=color]').forEach((inp) => { inp.onchange = () => {
    const colors = {};
    document.querySelectorAll('.palx input[type=color]').forEach((x) => { colors[x.dataset.ck] = x.value; });
    act({ action: 'colors', mode: themeMode(), colors }, '已保存颜色');
  }; });
}
let lastAt = 0;
async function refresh() {
  lastAt = Date.now();
  try { render(await api('/api/status?css=' + encodeURIComponent(cssKey))); } catch (e) { $('msg').innerHTML = '<span class="err">连不上插件：' + esc(e.message) + '（可能正在重启）</span>'; }
}
refresh();
// 多久取一次（2026-11-28 改）：看不见时不取（Antigravity 最小化、面板收起或换到别的标签页）；鼠标在面板上、或 1 分钟内动过时 3 秒一次，
// 其余时候 15 秒一次；鼠标移进来、重新看得见时马上取一次。原来不管看不看都 3 秒一次：每次都要从页面取一份快照，
// 11-27 实测面板开着时约占插件空闲开销的一半（插件进程 5.5 → 2.8 毫秒/秒，页面 1.3 → 0.6 毫秒/秒）
const seen = () => !document.hidden && innerWidth > 0;
let moveAt = 0;
const active = () => document.hasFocus() || Date.now() - moveAt < 60000;
setInterval(() => { if (!busy && seen() && Date.now() - lastAt >= (active() ? 3000 : 15000)) refresh(); }, 1000);
document.addEventListener('mousemove', () => {
  const was = active();
  moveAt = Date.now();
  if (!was && !busy && seen() && Date.now() - lastAt >= 1000) refresh();
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!busy && seen() && Date.now() - lastAt >= 1000) refresh(); });
</script>
</html>`;
