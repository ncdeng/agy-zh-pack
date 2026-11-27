// 配色和自定义颜色（v2.0.18）：插件面板、状态栏、每日用量面板共用一个配色，“自定义…”改 4 个主色；
// 5h 额度推出的限额（cap5）；插件面板网页里的脚本能不能解析
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cut, cutInject, read, H } from './_helpers.mjs';

// 插件面板网页（lib/panel.mjs 的 PAGE 模板）求值后的文字
function pageText() {
  const src = read('lib/panel.mjs').replace(/\r\n/g, '\n');
  const a = src.indexOf('const PAGE = `'), b = src.lastIndexOf('</html>`;');
  return new Function('return `' + src.slice(a + 'const PAGE = `'.length, b + '</html>'.length) + '`;')();
}

test('插件面板网页里的每段脚本都能解析（脚本写在模板字符串里，node --check 查不到）', () => {
  const page = pageText();
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const js of scripts) assert.doesNotThrow(() => new Function(js));
});

test('palVars：所选配色的颜色加上自定义的颜色，浅色和深色各一份', () => {
  const page = pageText();
  const body = page.slice(page.indexOf('const palVars = '), page.indexOf('let wkTab = '));
  const palVars = new Function(body + '\nreturn palVars;')();
  const c = (x) => ({ cost: x + '1', q5: x + '2', qw: x + '3', bad: x + '4', ok: x + '5', warn: x + '6' });
  const lk = { pal: 'nord', pals: { cometix: ['Cometix', { light: c('#a'), dark: c('#b') }], nord: ['Nord', { light: c('#c'), dark: c('#d') }] }, custom: null };
  assert.equal(palVars(lk), ':root{--cost:#c1;--q5:#c2;--qw:#c3;--bad:#c4;--ok:#c5;--warn:#c6} :root[data-theme="dark"]{--cost:#d1;--q5:#d2;--qw:#d3;--bad:#d4;--ok:#d5;--warn:#d6}');
  // 只自定义了浅色的花费：深色不变
  const v = palVars({ ...lk, custom: { light: { cost: '#123456' } } });
  assert.match(v, /^:root\{--cost:#123456;--q5:#c2;/);
  assert.match(v, /:root\[data-theme="dark"\]\{--cost:#d1;/);
  assert.equal(palVars({ ...lk, pal: 'nope' }), '');
});

test('状态栏：自定义颜色只收 #rrggbb，转成小写；colorCss 给浅色和深色各写一条覆盖', () => {
  const clean = new Function(cut('statusbar.js', '  const COLOR_KEYS = ', '  const LOOK_CHOICES = ') + '\nreturn cleanColors;')();
  assert.deepEqual(clean({ light: { cost: '#ABCDEF', q5: 'red', qw: '#12345', bad: '#000000' }, dark: { x: '#111111' } }),
    { light: { cost: '#abcdef', bad: '#000000' } });
  assert.equal(clean(null), null);
  assert.equal(clean({ light: { cost: 'url(x)' } }), null);
  const colorCss = new Function('COLOR_KEYS', 'B', 'P', 'T', 'LIGHT', 'DARK',
    cut('statusbar.js', '  const colorCss = ', '  // 插件面板用的每套配色') + '\nreturn colorCss;')(
    { cost: '--k-cost', q5: '--k-quota', qw: '--k-quotaw', bad: '--k-crit' }, '.b', '.p', '.t', (s) => 'L ' + s, (s) => 'D ' + s);
  assert.equal(colorCss(null), '');
  assert.equal(colorCss({ dark: { q5: '#00ff00', qw: '#0000ff' } }), 'D .b, D .p, D .t{--k-quota:#00ff00 !important; --k-quotaw:#0000ff !important}\n');
  assert.match(colorCss({ light: { cost: '#111111' } }), /^L \.b, L \.p, L \.t\{--k-cost:#111111 !important\}/);
});

test('状态栏：每周额度用自己的颜色变量 --k-quotaw，没自定义时等于 --k-quota（看起来和以前一样）', () => {
  const src = read('statusbar.js');
  assert.match(src, /\.k-quotaw\{--kc:var\(--k-quotaw, var\(--k-quota\)\)\}/);
  assert.match(src, /weekly \? 'quotaw' : 'quota'/);
});

// inject.mjs：look.json 里的 colors
const lookCode = cutInject('const zhOn =', '// 关汉化时') + cutInject('const LOOK_FILE =', '// ---------- 今天花费的账本');
function makeLook(file) {
  const env = { file, writes: [] };
  const fns = new Function('path', 'DATA', 'readJsonKeep', 'writeFileSafe', 'log', lookCode + '\nreturn { readLook, saveLook };')(
    path, 'D:/data',
    () => { if (env.file === null) throw Error('missing'); return env.file; },
    (f, text) => { env.writes.push(JSON.parse(text)); env.file = JSON.parse(text); },
    () => {});
  return { ...fns, env };
}

test('saveLook：自定义颜色只收 #rrggbb；页面交来的外观里没有 colors 时沿用文件里的，null 清掉', () => {
  const L = makeLook({ pal: 'cometix', colors: { light: { cost: '#111111' } } });
  L.saveLook({ pal: 'nord', at: 1 }); // 换配色（页面的 lookPick 里没有 colors）：自定义颜色还在
  assert.deepEqual(L.env.writes.at(-1).colors, { light: { cost: '#111111' } });
  L.saveLook({ pal: 'nord', colors: { dark: { q5: '#ABCDEF', bad: 'javascript:x' } }, at: 2 });
  assert.deepEqual(L.env.writes.at(-1).colors, { dark: { q5: '#abcdef' } });
  L.saveLook({ pal: 'nord', colors: null, at: 3 });
  assert.equal('colors' in L.env.writes.at(-1), false);
});

test('cap5：这 5h 的花费 ÷ 已用；按每次调用的时间算好才给；已用不到 1% 不推，不到 5% 标粗估', () => {
  const now = Date.now();
  const mk = (c) => new Function('cycleCost', cut('statusbar.js', '  const cap5 = ', '  // 离某个时刻还有多久') + '\nreturn cap5;')(
    (grp, from, to) => { mk.args = [grp, from, to]; return c; });
  const cap5 = mk({ usd: 17, tok: 48e6, exact: true, failed: 0 });
  const r = cap5('gemini', 0.1, now + 2 * H);
  assert.deepEqual(r, { usd: 17, tok: 48e6, failed: 0, cap: 170, capTok: 480e6, rough: false });
  assert.equal(mk.args[0], 'gemini');
  assert.equal(mk.args[1], now + 2 * H - 5 * H); // 从重置时间往前 5 小时算起
  assert.equal(cap5('gemini', 0.03, now + H).rough, true);
  assert.equal(cap5('gemini', 0.005, now + H).cap, 0);
  assert.equal(cap5('gemini', 0, now + H), null);
  assert.equal(cap5('gemini', 0.1, now - 1), null); // 已经过了重置时间
  assert.equal(mk({ usd: 17, tok: 1, exact: false, failed: 0 })('gemini', 0.1, now + H), null); // 还在按整天算：不给
});

test('选配色 = 用这套：自定义颜色两份都清掉；点的就是所基于的那套时也清掉；没有自定义时点同一套不写文件', () => {
  const L = makeLook({ pal: 'cometix', colors: { light: { cost: '#111111' }, dark: { q5: '#222222' } } });
  const fns = new Function('readLook', 'saveLook', 'pushLook', 'log',
    cutInject('function setPal(', '// ---------- 交给插件 sidecar') + '\nreturn { setPal, setColors };')(L.readLook, L.saveLook, async () => {}, () => {});
  fns.setPal('cometix');
  assert.equal(L.env.writes.at(-1).pal, 'cometix');
  assert.equal('colors' in L.env.writes.at(-1), false);
  const n = L.env.writes.length;
  fns.setPal('cometix');
  assert.equal(L.env.writes.length, n);
  // 自定义只改一种主题；清掉这一种时另一种留着
  fns.setColors('light', { cost: '#333333' });
  fns.setColors('dark', { cost: '#444444' });
  fns.setColors('light', null);
  assert.deepEqual(L.env.writes.at(-1).colors, { dark: { cost: '#444444' } });
});

test('页面收到 look.json：文件里没有 colors 就是没有自定义，不沿用页面里旧的（11-27 用户点“还原”没反应）', () => {
  const src = read('statusbar.js');
  assert.match(src, /cleanLook\(fromFile \? \{ \.\.\.S\.look, \.\.\.o, colors: o\.colors \} : \{ \.\.\.S\.look, \.\.\.o \}\)/);
  assert.match(src, /S\.setLook\(\{ pal, colors: null \}\)/); // Theme 页选配色也清掉自定义
});
