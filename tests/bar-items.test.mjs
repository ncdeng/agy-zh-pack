// 状态栏各项可以单独关掉（2026-11-27，用户要的“每一项都能自己选显示不显示，默认全显示”）：
// look.hide 的校验（statusbar.js 的 cleanLook）、look.json 的读写（inject.mjs 的 saveLook / setHide）、三处的项目名对得上
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cut, cutInject, read } from './_helpers.mjs';

// ---------- statusbar.js：cleanLook ----------
const lookBlock = cut('statusbar.js', '  const LOOK_DEFAULT =', '  { // 注入时带来的 look.json');
const { cleanLook, BAR_ITEMS } = new Function('ICON_ITEMS', lookBlock + '\nreturn { cleanLook, BAR_ITEMS };')({});

test('cleanLook：默认全部显示（hide 是空列表）；只收认识的项目名，按固定顺序、不重复', () => {
  assert.deepEqual(cleanLook(null).hide, []);
  assert.deepEqual(cleanLook({ pal: 'nord' }).hide, []);
  assert.deepEqual(cleanLook({ hide: ['qw', 'speed', 'qw', 'nope', 3, '__proto__'] }).hide, ['speed', 'qw']);
  assert.deepEqual(cleanLook({ hide: 'speed' }).hide, []); // 不是列表不认
  // 每次给新的列表，不和默认值共用（改了一份不影响下一份）
  const a = cleanLook({}); a.hide.push('model');
  assert.deepEqual(cleanLook({}).hide, []);
  assert.deepEqual(BAR_ITEMS, ['model', 'context', 'cache', 'cost', 'today', 'run', 'ttft', 'speed', 'q5', 'qw', 'subs']);
});

// ---------- inject.mjs：look.json ----------
const injectLook = cutInject('const zhOn =', '// 关汉化时') + cutInject('const LOOK_FILE =', '// ---------- 今天花费的账本');
function makeLook(file) {
  const env = { file, writes: [], pushed: 0, logs: [] };
  const fns = new Function('path', 'DATA', 'readJsonKeep', 'writeFileSafe', 'log', injectLook + '\nreturn { readLook, saveLook };')(
    path, 'D:/data',
    () => { if (env.file === null) throw Error('missing'); return env.file; },
    (f, text) => { env.writes.push(JSON.parse(text)); env.file = JSON.parse(text); },
    (m) => env.logs.push(m));
  const set = new Function('readLook', 'saveLook', 'pushLook', 'log',
    cutInject('function setPal(', '// ---------- 交给插件 sidecar') + '\nreturn { setHide };')(fns.readLook, fns.saveLook, async () => { env.pushed++; }, (m) => env.logs.push(m));
  return { ...fns, ...set, env };
}

test('saveLook：页面交来的外观里没有 hide（旧版本页面、Theme 页换配色）时沿用文件里的；空列表不写进文件', () => {
  const L = makeLook({ pal: 'cometix', hide: ['speed'] });
  L.saveLook({ pal: 'nord', at: 1 });
  assert.deepEqual(L.env.writes.at(-1).hide, ['speed']);
  L.saveLook({ pal: 'nord', hide: ['q5', 'q5', 7, 'x'.repeat(40)], at: 2 });
  assert.deepEqual(L.env.writes.at(-1).hide, ['q5', 'x'.repeat(24)]); // 去重、只收字符串、限长度（取值由页面校验）
  L.saveLook({ pal: 'nord', hide: [], at: 3 });
  assert.equal('hide' in L.env.writes.at(-1), false);
});

test('setHide：存进 look.json 并推给各窗口；别的设置（配色、开关）不动', () => {
  const L = makeLook({ pal: 'dracula', statusbar: 'on', colors: { light: { cost: '#123456' } } });
  L.setHide(['ttft', 'speed']);
  const w = L.env.writes.at(-1);
  assert.deepEqual(w.hide, ['ttft', 'speed']);
  assert.equal(w.pal, 'dracula');
  assert.equal(w.statusbar, 'on');
  assert.deepEqual(w.colors, { light: { cost: '#123456' } });
  assert.equal(L.env.pushed, 1);
  L.setHide(null); // 不是列表 = 全部显示
  assert.equal('hide' in L.env.writes.at(-1), false);
});

// ---------- 三处对得上 ----------
test('插件面板的按钮、状态栏的 BAR_ITEMS 和各项的 tag 一一对应', () => {
  const panel = read('lib/panel.mjs');
  const m = /const BAR_ITEMS = (\[[\s\S]*?\]\]);/.exec(panel);
  assert.ok(m, 'lib/panel.mjs 里找不到 BAR_ITEMS');
  const keys = new Function('return ' + m[1])().map((x) => x[0]);
  assert.deepEqual(keys, BAR_ITEMS);
  const src = read('statusbar.js');
  for (const k of BAR_ITEMS) {
    if (k === 'subs') { assert.match(src, /S\.look\.hide\.includes\('subs'\)/); continue; }
    assert.ok(src.includes("tag('" + k + "'") || (k.startsWith('q') && src.includes("tag(weekly ? 'qw' : 'q5'")), '没有标上 ' + k);
  }
  // 插件面板的操作交给 setHide
  assert.match(panel, /case 'items': ctx\.zh\.setHide\(/);
  assert.match(read('inject.mjs'), /^\s+setHide,$/m);
});
