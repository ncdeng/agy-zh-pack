// 生成速度统计（v2.0.15）：statusbar.js 的速度摘要、几天合成一个数、后台挑哪一天去算；inject.mjs 把摘要存进使用历史的规则
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, cutInject, read } from './_helpers.mjs';

const block = cut('statusbar.js', '  // ---------- 生成速度统计', '  // agy CLI 的调用（2026-11-24 加）');
// env：页面里的依赖（S、历史、日子、后台取数）。speedTick 用到的都从这里给
function make(env = {}) {
  const S = { enumModel: new Map(), loadCalls: env.loadCalls || null, ...(env.S || {}) };
  const fns = new Function('S', 'histDay', 'lastDays', 'dayRecord', 'recTokens', 'dayBounds', 'dayName', 'cliRows', 'window',
    block + '\nreturn { callSpeed, quantile, speedSummary, spanMedian, callModel, shortModel, noteSpeed, noteHours, spdOf, speedTick, SPEED_MIN_OUT, SPEED_MIN_N };')(
    S, env.histDay || (() => null), env.lastDays || (() => []), env.dayRecord || (() => null), env.recTokens || ((r) => [r.calls || 0]),
    (nm) => { const a = new Date(nm + 'T00:00:00').getTime(); return [a, a + 86400e3]; }, env.dayName || (() => '2026-11-26'),
    env.cliRows || (() => []), env.window || {});
  return { ...fns, S };
}
const call = (out, ttft, stream, more = {}) => ({ usage: { outputTokens: String(out) }, ttft, stream, disp: 'Gemini 4 Hydrogen (High)', ...more });

test('单次调用的速度：输出 ÷（首字 + 生成）；输出不到 100 token、总用时不到 0.3 秒的不算', () => {
  const { callSpeed } = make();
  assert.equal(callSpeed(call(1000, 4, 6)), 100);
  assert.equal(callSpeed(call(99, 1, 1)), null);
  assert.equal(callSpeed(call(500, 0.1, 0.1)), null);
  // 输出取 outputTokens 和 思考 + 回复 里大的那个
  assert.equal(callSpeed({ usage: { outputTokens: '100', thinkingOutputTokens: '300', responseOutputTokens: '500' }, ttft: 2, stream: 6 }), 100);
});

test('分位数按线性插值', () => {
  const { quantile } = make();
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10], 0.25), 10);
  assert.equal(quantile([10, 20, 30, 40], 0.5), 25);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.9), 46);
});

test('按模型汇总：[算进速度的调用数, P25, 中位数, P75, 首字中位数, 首字 P90, 全部调用数]，首字时间也算输出太短的调用', () => {
  const { speedSummary, callModel } = make();
  const rows = [call(1000, 2, 8), call(2000, 2, 8), call(3000, 2, 8), call(50, 4, 1), call(800, 0, 0),
    call(600, 3, 3, { disp: 'Gemini 4 Neon (XHigh)' })];
  const m = speedSummary(rows, callModel);
  // 首字时间 [2, 2, 2, 4]（首字为 0 的不算）：P90 = 2 + (4 - 2) × 0.7 = 3.4
  assert.deepEqual(m['Gemini 4 Hydrogen (High)'], [3, 150, 200, 250, 2, 3.4, 5]);
  assert.deepEqual(m['Gemini 4 Neon (XHigh)'], [1, 100, 100, 100, 3, 3, 1]);
});

test('模型名：界面名优先，老的 CLI 记录用配置名或接口名；短名去掉 Gemini 4 / Claude 前缀', () => {
  const { callModel, shortModel, S } = make();
  S.enumModel.set('MODEL_X', 'Gemini 4 Argon');
  assert.equal(callModel({ disp: 'Gemini 4 Neon (High)', key: 'MODEL_X' }), 'Gemini 4 Neon (High)');
  assert.equal(callModel({ key: 'MODEL_X', resp: 'gemini-4-argon' }), 'Gemini 4 Argon');
  assert.equal(callModel({ key: 'MODEL_Y', resp: 'gemini-4-argon' }), 'gemini-4-argon');
  assert.equal(shortModel('Gemini 4 Hydrogen (High)'), 'Hydrogen (High)');
  assert.equal(shortModel('Claude Opus 5.5 (Thinking)'), 'Opus 5.5 (Thinking)');
});

test('几天合成一个数：每天中位数的中位数，只算那天算进速度的调用不少于 3 次的天', () => {
  const { spanMedian } = make();
  const d = (n, p50, t50) => [n, 0, p50, 0, t50, 0, n];
  assert.equal(spanMedian([d(10, 100, 5), d(2, 900, 1), undefined, d(5, 120, 7), d(3, 80, 6)], 2), 100);
  assert.equal(spanMedian([d(10, 100, 5), d(5, 120, 7)], 4), 6);
  assert.equal(spanMedian([d(1, 100, 5), undefined], 2), null);
});

test('同一天页面里新算的和历史里存的，取算得晚的那份', () => {
  const hist = { '2026-11-25': { spd: { at: 200, m: { a: [1] } } } };
  const { noteSpeed, spdOf, S } = make({ histDay: (d) => hist[d] || null });
  assert.equal(spdOf('2026-11-25').at, 200);
  S.spd['2026-11-25'] = { at: 100, m: {} };
  assert.equal(spdOf('2026-11-25').at, 200);
  noteSpeed('2026-11-25', []);
  assert.ok(spdOf('2026-11-25').at > 200);
  assert.equal(spdOf('2026-11-24'), null);
});

// 后台挑哪一天：今天的摘要超过 10 分钟就先算今天；否则补最近 7 天里有调用、还没有摘要（或摘要是那天没过完时算的）的日子
function job(opts) {
  const asked = [];
  const days = ['2026-11-26', '2026-11-25', '2026-11-24', '2026-11-23'];
  const recs = { '2026-11-25': { calls: 10 }, '2026-11-24': { calls: 0 }, '2026-11-23': { calls: 5 } };
  const hist = opts.hist || {};
  const env = make({
    lastDays: () => days, dayRecord: (d) => recs[d] || null, histDay: (d) => hist[d] || null,
    loadCalls: (nm) => { asked.push(nm); return Promise.resolve(opts.res || { rows: [call(1000, 2, 8)], failed: 0 }); },
    window: { __agyZhAsk: () => {} },
  });
  if (opts.spd) Object.assign(env.S.spd, opts.spd);
  return { ...env, asked };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const end = (d) => new Date(d + 'T00:00:00').getTime() + 86400e3;

test('后台记录：今天没有摘要先算今天，再取昨天的调用算最近 24 小时每小时的速度；算完 2 分钟内不再取', async () => {
  const j = job({});
  j.speedTick();
  assert.deepEqual(j.asked, ['2026-11-26']);
  await settle();
  assert.deepEqual(j.asked, ['2026-11-26', '2026-11-25']);
  assert.equal(j.S.spd['2026-11-26'].m['Gemini 4 Hydrogen (High)'][0], 1);
  assert.ok(j.S.spdHours && j.S.spdHours.m);
  j.speedTick();
  assert.deepEqual(j.asked, ['2026-11-26', '2026-11-25']);
});

test('后台记录：今天的还新，就补最近有调用、没有摘要的日子；没调用的日子跳过', () => {
  const j = job({ spd: { '2026-11-26': { at: Date.now(), m: {} } }, hist: { '2026-11-25': { spd: { at: end('2026-11-25') + 1, m: {} } } } });
  j.speedTick();
  assert.deepEqual(j.asked, ['2026-11-23']); // 11-25 已经有那天过完以后算的摘要，11-24 没有调用
});

test('后台记录：摘要是那天还没过完时算的，重算一次', () => {
  const j = job({ spd: { '2026-11-26': { at: Date.now(), m: {} } }, hist: { '2026-11-25': { spd: { at: end('2026-11-25') - 3600e3, m: {} } } } });
  j.speedTick();
  assert.deepEqual(j.asked, ['2026-11-25']);
});

test('后台记录：一个对话都没取到时不记成“那天没有调用”，1 小时内不再试这一天', async () => {
  const j = job({ spd: { '2026-11-26': { at: Date.now(), m: {} } }, hist: { '2026-11-23': { spd: { at: end('2026-11-23') + 1, m: {} } } },
    res: { rows: [], failed: 3 } });
  j.speedTick();
  assert.deepEqual(j.asked, ['2026-11-25']);
  await settle();
  assert.equal(j.S.spd['2026-11-25'], undefined);
  j.S.spdJob.at = 0; // 跳过 2 分钟的间隔
  j.speedTick();
  assert.deepEqual(j.asked, ['2026-11-25']); // 11-25 刚试过，11-23 已经有了：这次什么都不取
});

// ---------- inject.mjs：存进使用历史 ----------
const injCode = cutInject('// 生成速度的每日摘要（v2.0.15）', '// 推给页面的历史：');
function makeInj(history) {
  const UNREAD = Symbol('unread');
  const h = history === 'unread' ? { v: 2, days: {}, [UNREAD]: true } : history;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fns = new Function('isObj', 'readHistory', 'UNREAD', 'dayName', injCode + '\nreturn { noteSpeedDays, cleanSpeed };')(
    isObj, () => h, UNREAD, () => '2026-11-26');
  return { ...fns, h };
}

test('存速度摘要：只给已有记录的日子存，更晚算的才换；不存未来的日子', () => {
  const { noteSpeedDays, h } = makeInj({ days: { '2026-11-25': { usd: 3 }, '2026-11-26': { usd: 1, spd: { at: 500, m: {} } } } });
  const m = { 'Gemini 4 Hydrogen (High)': [3, 150, 200, 250, 2, 3.6, 5] };
  noteSpeedDays({ '2026-11-25': { at: 100, m }, '2026-11-26': { at: 400, m }, '2026-11-24': { at: 100, m }, '2026-11-27': { at: 100, m } });
  assert.deepEqual(h.days['2026-11-25'].spd, { at: 100, m });
  assert.equal(h.days['2026-11-26'].spd.at, 500);
  assert.equal(h.days['2026-11-24'], undefined);
  assert.equal(h.days['2026-11-27'], undefined);
  noteSpeedDays({ '2026-11-26': { at: 600, m } });
  assert.equal(h.days['2026-11-26'].spd.at, 600);
});

test('存速度摘要：格式不对的模型丢掉；历史读不出来时不动', () => {
  const { cleanSpeed } = makeInj({ days: {} });
  const c = cleanSpeed({ at: 1, m: { ok: [1, 2, 3, 4, 5, 6, 7], short: [1, 2], bad: [1, 2, 3, 4, 5, 6, 'x'], neg: [1, 2, 3, 4, 5, 6, -1], nul: [0, null, null, null, null, null, 2] } });
  assert.deepEqual(Object.keys(c.m), ['ok', 'nul']);
  assert.equal(cleanSpeed({ m: {} }), null);
  const u = makeInj('unread');
  u.noteSpeedDays({ '2026-11-26': { at: 1, m: {} } });
  assert.deepEqual(u.h.days, {});
});

// ---------- 一天内的速度（最近 24 小时 / 今天） ----------
test('每小时的速度：最近 24 个整点小时，最右边是现在这个小时；24 小时以前和以后的调用不算；“现在”是最近 60 分钟', () => {
  const { S, noteHours } = make();
  const now = new Date('2026-11-26T18:40:00').getTime();
  const H = 3600e3;
  const at = (s) => new Date(s).getTime();
  const r = (t, out, disp = 'Gemini 4 Hydrogen (High)') => call(out, 2, 8, { at: at(t), disp });
  noteHours([
    r('2026-11-25T19:10:00', 1000), r('2026-11-25T19:50:00', 2000), // 第一个小时（昨天 19 点）
    r('2026-11-25T18:59:00', 5000), // 24 小时以前：不算
    r('2026-11-26T18:05:00', 3000), r('2026-11-26T18:20:00', 500, 'Gemini 4 Neon (High)'), // 现在这个小时
    r('2026-11-26T17:45:00', 1000), // 最近 60 分钟里，但在上一个小时
    r('2026-11-26T18:50:00', 9000), // 比 now 晚：不算
  ], now);
  const h = S.spdHours;
  assert.equal(h.start, at('2026-11-25T19:00:00'));
  assert.equal(h.at, now);
  const hy = h.m['Gemini 4 Hydrogen (High)'];
  assert.equal(hy.length, 24);
  assert.deepEqual(hy[0], [2, 150]);
  assert.deepEqual(hy[22], [1, 100]);
  assert.deepEqual(hy[23], [1, 300]);
  assert.equal(hy[5], null);
  assert.deepEqual(h.m['Gemini 4 Neon (High)'][23], [1, 50]);
  assert.equal(h.now['Gemini 4 Hydrogen (High)'][0], 2); // 17:45 和 18:05
  assert.ok(h.start + 23 * H <= now && now < h.start + 24 * H);
});

const nowCode = block + cut('statusbar.js', '  // 插件面板“速度”页用（v2.0.15）', '  S.panelSnapshot = () => {');
function makeNow(spdHours, spd = {}) {
  const S = { enumModel: new Map(), spd, spdHours };
  const days = ['2026-11-26', '2026-11-25', '2026-11-24', '2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20', '2026-11-19'];
  const MODEL_COLOR = { Neon: 'model', Hydrogen: 'tokens', Carbon: 'context' };
  const css = { '--k-model': ' #5c64d6', '--k-tokens': '#158a90', '--k-context': '#8839ef' };
  return new Function('S', 'histDay', 'lastDays', 'dayRecord', 'recTokens', 'dayBounds', 'dayName', 'cliRows', 'window', 'MODEL_COLOR', 'getComputedStyle',
    nowCode + '\nreturn speedNow;')(S, () => null, (n) => days.slice(0, n), () => null, () => [0],
    (nm) => { const a = new Date(nm + 'T00:00:00').getTime(); return [a, a + 86400e3]; }, () => '2026-11-26', () => [], {}, MODEL_COLOR,
    () => ({ getPropertyValue: (k) => css[k] || '' }));
}
const sv = (n, p50, t50 = 5) => [n, p50 - 10, p50, p50 + 10, t50, t50 * 2, n];

test('面板的“速度”页：最近 24 小时调用最多的 3 个模型；不到 3 次的小时是 null；现在、平时；同一价目第二个档位标虚线', () => {
  const H = 'Gemini 4 Hydrogen (High)', HX = 'Gemini 4 Hydrogen (XHigh)', N = 'Gemini 4 Neon (High)', C = 'Gemini 4 Carbon (High)';
  const hours = (pairs) => { const a = Array(24).fill(null); for (const [i, n, v] of pairs) a[i] = [n, v]; return a; };
  const speedNow = makeNow({
    at: 1, start: 1000,
    m: { [H]: hours([[0, 10, 150], [22, 2, 40], [23, 20, 36]]), [HX]: hours([[3, 8, 120]]), [N]: hours([[23, 5, 80]]), [C]: hours([[23, 1, 60]]) },
    now: { [H]: sv(22, 37), [N]: sv(2, 80) },
  }, { '2026-11-25': { at: 1, m: { [H]: sv(100, 110) } }, '2026-11-24': { at: 1, m: { [H]: sv(100, 90) } }, '2026-11-26': { at: 1, m: { [H]: sv(100, 10) } } });
  const o = speedNow({});
  assert.equal(o.start, 1000);
  assert.equal(o.today0, new Date('2026-11-26T00:00:00').getTime());
  assert.deepEqual(o.models.map((m) => m.short), ['Hydrogen (High)', 'Hydrogen (XHigh)', 'Neon (High)']);
  const [h, hx, n] = o.models;
  assert.equal(h.pts[0], 150);
  assert.equal(h.pts[22], null); // 那小时只有 2 次
  assert.equal(h.pts[23], 36);
  assert.equal(h.ns[22], 2);
  assert.equal(h.now, 37);
  assert.equal(h.nowN, 22);
  assert.equal(h.usual, 100); // 前 7 天（11-25、11-24）每天中位数的中位数，不含今天
  assert.equal(n.now, null); // 最近 60 分钟只有 2 次
  assert.equal(n.nowN, 2);
  assert.equal(n.usual, null);
  assert.equal(h.color, '#158a90');
  assert.equal(n.color, '#5c64d6');
  assert.deepEqual([h.dash, hx.dash, n.dash], [false, true, false]);
});

test('面板的“速度”页：还没算过时是 null', () => {
  assert.equal(makeNow(undefined)({}), null);
});

// lib/panel.mjs 网页里的 speedBlock：取出网页文字里这几个函数单独求值
function pageFns() {
  const src = read('lib/panel.mjs').replace(/\r\n/g, '\n');
  const a = src.indexOf('const PAGE = `'), b = src.lastIndexOf('</html>`;');
  const page = new Function('return `' + src.slice(a + 'const PAGE = `'.length, b + '</html>'.length) + '`;')();
  const line = (start) => page.split('\n').find((l) => l.startsWith(start));
  const body = page.slice(page.indexOf('const speedRange = '), page.indexOf('function render(o) {'));
  return new Function(line('const esc = ') + '\n' + line('const pad = ') + '\n' + body + '\nreturn { speedRange, safeColor, speedBlock };')();
}

test('面板画速度页：24 小时从最近 24 个整点小时画起，今天从 0 点画起；空了 2 小时以上断开；现在比平时慢四成标黄；颜色过滤', () => {
  const { speedRange, safeColor, speedBlock } = pageFns();
  // 纵轴：数据范围上下各留四分之一（范围至少 20），取整到 10，不低于 0
  assert.deepEqual(speedRange([80, 132]), [60, 150]);
  assert.deepEqual(speedRange([40, 45]), [30, 50]);
  assert.deepEqual(speedRange([5, 6]), [0, 20]);
  assert.equal(safeColor('rgb(21, 138, 144)'), 'rgb(21, 138, 144)');
  assert.equal(safeColor('#1"><script>'), 'var(--fg-muted)');
  const H = 3600e3;
  const today0 = new Date('2026-11-26T00:00:00').getTime();
  const start = today0 - 5 * H; // 最近 24 小时从昨天 19 点起，现在是今天 18 点这个小时
  const pts = Array(24).fill(null);
  pts[1] = 140; pts[2] = 130; pts[6] = 100; pts[7] = 90; pts[20] = 40; pts[23] = 36; // 2→6 空了 3 个小时：断开
  const sp = { start, today0, models: [
    { name: 'Gemini 4 Hydrogen (High)', short: 'Hydrogen (High)', color: '#158a90', dash: false, pts, ns: Array(24).fill(5), now: 36, nowN: 22, usual: 100 },
    { name: 'Gemini 4 Neon (XHigh)', short: 'Neon (XHigh)', color: 'url(x)', dash: true, pts: Array(24).fill(null), ns: Array(24).fill(0), now: null, nowN: 0, usual: null },
  ] };
  const h24 = speedBlock(sp, '24h');
  assert.equal((h24.match(/class="pt"/g) || []).length, 6);
  assert.equal((h24.match(/<path /g) || []).length, 3); // [1,2] [6,7] [20,23]
  assert.match(h24, /stroke="#158a90"/);
  assert.match(h24, /<b class="slow">36<\/b><span class="u"> 平时 100<\/span>/);
  assert.match(h24, /Neon \(XHigh\) <b class="">—<\/b>/);
  assert.match(h24, /<i class="d2" style="color:var\(--fg-muted\)">/); // url(x) 这种颜色换成灰色
  assert.match(h24, /<span class="today">现在<\/span>/);
  assert.match(h24, /class="cur" style="left:95\.83%/); // 现在这个小时在第 24 格
  // 今天：0 点以前的点（第 1、2 个小时）不画，现在这个小时在第 19 格（18 点）
  const td = speedBlock(sp, 'today');
  assert.equal((td.match(/class="pt"/g) || []).length, 4);
  assert.match(td, /class="cur" style="left:75\.00%/);
  assert.match(speedBlock({ start, today0, models: [] }, '24h'), /还没有速度数据/);
  assert.match(speedBlock(null, '24h'), /还没有速度数据/);
  const early = { start, today0, models: [{ ...sp.models[0], pts: Array(24).fill(null).map((v, i) => (i < 3 ? 100 : null)) }] };
  assert.match(speedBlock(early, 'today'), /今天还没有速度数据/);
});

test('速度图悬停用的数据：24 小时的现在在第 24 格；今天的现在在 18 点那一格，偏移 5 个小时；没有数据时清空', () => {
  const { speedBlock } = pageFns();
  const H = 3600e3;
  const today0 = new Date('2026-11-26T00:00:00').getTime();
  const start = today0 - 5 * H;
  const pts = Array(24).fill(null);
  pts[23] = 36;
  const sp = { start, today0, models: [{ name: 'Gemini 4 Hydrogen (High)', short: 'Hydrogen (High)', color: '#158a90', dash: false, pts, ns: Array(24).fill(4), now: 36, nowN: 22, usual: 100 }] };
  speedBlock(sp, '24h');
  assert.deepEqual([globalThis.spHover.cNow, globalThis.spHover.offset, globalThis.spHover.start], [23, 0, start]);
  assert.equal(globalThis.spHover.models[0].pts[23], 36);
  speedBlock(sp, 'today');
  assert.deepEqual([globalThis.spHover.cNow, globalThis.spHover.offset, globalThis.spHover.start], [18, 5, today0]);
  speedBlock(null, '24h');
  assert.equal(globalThis.spHover, null);
  delete globalThis.spHover;
});
