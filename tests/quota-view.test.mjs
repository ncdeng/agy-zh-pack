// 额度的显示（v2.0.17）：插件面板“今天”卡片的额度格子（方案 A：进度条上画出预估，下面一行费用）、5 小时额度的预估、
// 每日面板缓存没命中按原因分行的悬停说明
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, read, H } from './_helpers.mjs';

// lib/panel.mjs 网页里的 quotaTile：取出网页文字里它和它用到的几个小函数单独求值
function tileFn() {
  const src = read('lib/panel.mjs').replace(/\r\n/g, '\n');
  const a = src.indexOf('const PAGE = `'), b = src.lastIndexOf('</html>`;');
  const page = new Function('return `' + src.slice(a + 'const PAGE = `'.length, b + '</html>'.length) + '`;')();
  const line = (start) => { const l = page.split('\n').find((x) => x.startsWith(start)); if (!l) throw Error('网页里找不到 ' + start); return l; };
  const body = page.slice(page.indexOf('const quotaTile = '), page.indexOf('function render(o) {'));
  const helpers = ['const esc = ', 'const pad = ', 'const when = ', 'const WD = ', 'const resetText = ', 'const leftText = ', 'const usd = ', 'const pct = '].map(line).join('\n');
  return new Function(helpers + '\n' + body + '\nreturn quotaTile;')();
}

test('额度格子：实色是已用、浅色画到预计用到的位置，右边写“已用 → 预计”；下面一行写这个周期花了多少和推出的周限额', () => {
  const quotaTile = tileFn();
  const now = Date.now();
  const html = quotaTile([
    { group: 'Gemini', weekly: false, used: 0.063, reset: now + 1.4 * H, timePct: 0.73, est: { proj: 0.087, fullAt: 0, rough: false, basis: '按这 5 小时的平均速度' }, cost: null },
    { group: 'Gemini', weekly: true, used: 0.07, reset: now + 6 * 24 * H, timePct: 0.14, est: { proj: 0.4951, fullAt: 0, rough: false, basis: '按最近 24 小时' },
      cost: { usd: 142.3, cap: 2039.4, tok: 498e6, capTok: 7.17e9, rough: false } },
  ]);
  assert.match(html, /<div class="tile" title=/); // 不标黄
  assert.match(html, /Gemini 额度/);
  assert.match(html, /<i class="proj" style="width:9%;background:var\(--q5\)"><\/i><i style="width:6%;background:var\(--q5\)">/);
  assert.match(html, /<i class="proj" style="width:50%;background:var\(--qw\)"><\/i><i style="width:7%;/);
  assert.match(html, /6% <em>→ 9%<\/em>/);
  assert.match(html, /7% <em>→ 50%<\/em>/);
  assert.match(html, /<b style="left:73%">/); // 时间进度的竖线还在
  assert.match(html, /已用 <b>\$142<\/b> \/ 周限额约 <b>\$2,039<\/b><\/div>/);
  assert.doesNotMatch(html, /粗估|class="s bad"|每周预计用掉/);
  // 悬停提示一行一件事（11-27 用户嫌连成一段太密）：5 小时、每周、费用（带 token），不写解释
  const title = html.match(/title="([^"]*)"/)[1].split('&#10;');
  assert.equal(title.length, 3);
  assert.match(title[0], /^5 小时：已用 6%，预计 9%，\d\d:\d\d 重置（1 小时 \d+ 分后）$/);
  assert.match(title[1], /^每周：已用 7%，预计 50%（按最近 24 小时），周. \d\d:\d\d 重置$/);
  assert.equal(title[2], '这个周期花了 $142（498M token），周限额约 $2,039（7.17B token）');
});

test('悬停卡片保留连续空格（pre-wrap），悬停里按列对齐的小表格才对得齐', () => {
  const css = read('statusbar.js').replace(/\r\n/g, '\n');
  const rule = css.slice(css.indexOf('${T}{position:fixed;'), css.indexOf('`;', css.indexOf('${T}{position:fixed;')));
  assert.match(rule, /white-space:pre-wrap;/);
});

test('额度格子：预计会用超时浅色那段换成斜纹、写“→ 超”、格子标黄，下面写大约什么时候用完', () => {
  const quotaTile = tileFn();
  const now = Date.now();
  const full = new Date(now + 3 * 24 * H);
  const html = quotaTile([
    { group: 'Gemini', weekly: false, used: 0.22, reset: now + H, timePct: 0.73, est: { proj: 0.3, fullAt: 0, rough: false, basis: '' }, cost: null },
    { group: 'Gemini', weekly: true, used: 0.46, reset: now + 4 * 24 * H, timePct: 0.35, est: { proj: 1.31, fullAt: full.getTime(), rough: false, basis: '按最近 24 小时' }, cost: { usd: 900, cap: 1956, rough: false } },
  ]);
  assert.match(html, /<div class="tile warn"/);
  assert.match(html, /<i class="proj over" style="width:100%;/);
  assert.match(html, /46% <em class="over">→ 超<\/em>/);
  const md = (full.getMonth() + 1) + '-' + full.getDate() + ' ' + String(full.getHours()).padStart(2, '0') + ':' + String(full.getMinutes()).padStart(2, '0');
  assert.match(html, new RegExp('<div class="s bad">每周额度按现在的速度 ' + md + ' 左右用完</div>'));
});

test('额度格子：没有预估时只画已用；已用不到 5% 的周限额标粗估；没花钱不写费用；没查到额度写“还没查到”', () => {
  const quotaTile = tileFn();
  const now = Date.now();
  const html = quotaTile([
    { group: 'Claude', weekly: false, used: 0, reset: 0, timePct: null, est: null, cost: null },
    { group: 'Claude', weekly: true, used: 0.02, reset: now + 6 * 24 * H, timePct: 0.1, est: null, cost: { usd: 1.2, cap: 60, rough: true } },
  ]);
  assert.doesNotMatch(html, /class="proj|<em/);
  assert.match(html, /已用 <b>\$1\.20<\/b> \/ 周限额约 <b>\$60\.00<\/b> <span>（粗估）<\/span>/);
  assert.doesNotMatch(quotaTile([{ group: 'Gemini', weekly: true, used: 0.1, reset: now + H, timePct: 0.5, est: null, cost: { usd: 0, cap: 0 } }]), /qcost/);
  assert.match(quotaTile([]), /还没查到/);
  assert.match(quotaTile(null), /还没查到/);
});

test('5 小时额度的预估：已用 ÷ 时间进度；时间过了不到 10% 不估；会提前用完时算出大约什么时候用完', () => {
  const est5h = new Function(cut('statusbar.js', '  const est5h = ', '  const weeklyBucket = ') + '\nreturn est5h;')();
  const span = 5 * H, now = 1_800_000_000_000;
  // 过了 2 小时（40%），用了 6% → 到重置 15%
  assert.deepEqual(est5h(0.06, now + 3 * H, span, now), { proj: 0.15, fullAt: 0, rough: false, basis: '按这 5 小时的平均速度' });
  // 过了 2 小时，用了 50% → 125%；剩下 50% 按每小时 25% 用，2 小时后用完
  const e = est5h(0.5, now + 3 * H, span, now);
  assert.equal(e.proj, 1.25);
  assert.equal(e.fullAt, now + 2 * H);
  assert.equal(est5h(0.05, now + 4.6 * H, span, now), null); // 才过了 24 分钟
  assert.equal(est5h(0, now + 3 * H, span, now), null);
  assert.equal(est5h(0.3, now - 1, span, now), null); // 已经过了重置时间
});

test('缓存没命中按原因分行：按多花的钱从多到少，次数和金额右对齐放前面，短说明放最后', () => {
  const code = cut('statusbar.js', '  const MISS_CAUSE = {', '  const fmtIdle = ') + cut('statusbar.js', '  const missTip = ', '  // agy CLI 的调用：按对话分组');
  const missTip = new Function('fmtUsd', code + '\nreturn missTip;')((v) => '$' + v.toFixed(2));
  const tip = missTip({ by: { user: [10, 3.3], turn: [16, 8.07], other: [16, 2.49], model: [1, 0.19] } });
  assert.deepEqual(tip.split('\n').slice(1), [
    '  16 次  $8.07  一轮中间停了 1 分钟以上',
    '  10 次  $3.30  你隔了 1 分钟以上才回',
    '  16 次  $2.49  不到 1 分钟也没命中',
    '   1 次  $0.19  换了模型',
  ]);
});
