// 每次调用的时间（statusbar.js 的 callTimes / timeFetchFrom / fetchTimes）、账本 v3（inject.mjs 的 readCostBook / mergeCostBook /
// updateHistory，statusbar.js 的 mergeBook）、
// 读数据文件出错时不覆盖（inject.mjs 的 readJsonKeep，代码审查 A1）、调用明细取步骤失败（statusbar.js 的 loadConv0，审查 A4）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cut, cutInject, read, T, H } from './_helpers.mjs';

const D0 = T('2026-11-25T00:00:00');
const M = 60e3;
const mkS = () => ({ stepAt: new Map(), detCache: new Map(), execAt: new Map(), costs: new Map() });
// callTimes 一段（含 priceCut、canFetch、timeFetchFrom），换掉 Date.now 好让测试结果不随运行时间变。
// ownFrom（副本的分界，见 copy.test.mjs）默认当成不是副本
const timesOf = (S, { meta, now, rules = [], ownFrom = () => 0 }) => new Function('S', 'convMeta', 'dayStart', 'priceRules', 'callNames', 'Date', 'ownFrom',
  cut('statusbar.js', '  // 调价时间点：', '  S.fetchTimes = ') + '\nreturn { callTimes, timeFetchFrom, priceCut, canFetch };')(
  S, () => meta, () => D0, rules, (resp) => resp || '', { now: () => now }, ownFrom);
const calls = (n, resp = 'gemini-4-carbon') => Array.from({ length: n }, (_, i) => ({ exec: 'e1', step: i * 10, resp }));

test('callTimes：按前后已知的时间夹出范围；整个在 0 点前算昨天，在 0 点后算今天，跨 0 点才算不知道', () => {
  const S = mkS();
  const meta = { created: D0 - 2 * H, modified: D0 + H }; // 昨晚 22 点建的对话
  const { callTimes } = timesOf(S, { meta, now: D0 + H });
  const list = calls(5);
  S.stepAt.set('c', new Map([[20, D0 + 5 * M]])); // 只知道第 3 次调用在 00:05
  let ts = callTimes('c', list, meta, D0);
  assert.deepEqual(ts.map((x) => x.day), [null, null, 'today', 'today', 'today']); // 前两次在 22:00～00:05 之间，跨 0 点
  S.stepAt.get('c').set(10, D0 - 10 * M); // 第 2 次在 23:50
  ts = callTimes('c', list, meta, D0);
  assert.deepEqual(ts.map((x) => x.day), ['before', 'before', 'today', 'today', 'today']); // 第 1 次夹在 22:00～23:50：不用再取
  // 调用明细取过的步骤时间也能用
  S.detCache.set('c', { times: new Map([[0, D0 - 30 * M]]) });
  assert.equal(callTimes('c', list, meta, D0)[0].at, D0 - 30 * M);
});

test('callTimes：选价按调用自己的时间；范围里有调价时间点就算不知道（要补取）', () => {
  const S = mkS();
  const CUT = D0 + 16 * H; // 例如 12-01 08:00 UTC = 北京 16:00 Carbon 涨价
  const rules = [{ re: /carbon/, t: [[CUT, { in: 2 }], [Infinity, { in: 4 }]] }];
  const meta = { created: D0 + 10 * H, modified: D0 + 18 * H }; // 今天 10 点建、18 点还在用
  const { callTimes } = timesOf(S, { meta, now: D0 + 18 * H, rules });
  const list = calls(4);
  let ts = callTimes('c', list, meta, D0);
  assert.ok(ts.every((x) => x.day === 'today'));
  assert.ok(ts.every((x) => x.priceAt === null)); // 原来按创建时间（10 点）选价，16 点以后的调用会算成旧价
  S.stepAt.set('c', new Map([[10, D0 + 15 * H], [20, D0 + 17 * H]]));
  ts = callTimes('c', list, meta, D0);
  assert.equal(ts[0].priceAt, D0 + 10 * H); // 夹在 10:00～15:00，没跨调价点
  assert.equal(ts[1].priceAt, D0 + 15 * H);
  assert.equal(ts[2].priceAt, D0 + 17 * H);
  assert.equal(ts[3].priceAt, D0 + 17 * H); // 17:00 以后：同一档
  // 没有调价点的模型：不用补取
  const ts2 = callTimes('n', calls(3, 'gemini-4-neon'), meta, D0);
  assert.ok(ts2.every((x) => x.priceAt === D0 + 10 * H));
});

test('timeFetchFrom：末尾跨 0 点的新调用从它那一步取；取到过就不重取；取失败 60 秒后可以再取', () => {
  const S = mkS();
  const NOW = D0 + H;
  const meta = { created: D0 - 2 * H, modified: NOW };
  const { timeFetchFrom } = timesOf(S, { meta, now: NOW });
  S.costs.set('c', { list: calls(5) });
  S.stepAt.set('c', new Map([[0, D0 - 20 * M], [10, D0 - 10 * M]])); // 前两次在 0 点前；后三次（新来的）不知道
  assert.equal(timeFetchFrom('c'), 20);
  S.timeFetched = new Map([['c', new Map([[20, { ok: true, at: NOW }]])]]);
  assert.equal(timeFetchFrom('c'), null); // 从这里取到过（防止死循环）
  S.timeFetched.get('c').set(20, { ok: false, at: NOW - 10e3 });
  assert.equal(timeFetchFrom('c'), null); // 刚失败，等一会儿
  S.timeFetched.get('c').set(20, { ok: false, at: NOW - 61e3 });
  assert.equal(timeFetchFrom('c'), 20); // 原来失败一次就再也不取（审查 A3）
  // 后三次知道在 0 点后：都知道了，不用取
  S.stepAt.get('c').set(20, D0 + 5 * M);
  assert.equal(timeFetchFrom('c'), null);
});

test('timeFetchFrom：今天建的对话跨调价时间点，也去补取，起点按调价时间点在对话里的位置估', () => {
  const S = mkS();
  const CUT = D0 + 16 * H;
  const meta = { created: D0 + 10 * H, modified: D0 + 18 * H };
  const { timeFetchFrom } = timesOf(S, { meta, now: D0 + 18 * H, rules: [{ re: /carbon/, t: [[CUT, { in: 2 }], [Infinity, { in: 4 }]] }] });
  S.costs.set('c', { list: calls(10) });
  assert.equal(timeFetchFrom('c'), 60); // (16-10)/(18-10) = 0.75，再往前留 10%：第 6 次调用（步骤 60）
  S.costs.set('n', { list: calls(10, 'gemini-4-neon') }); // 没有调价点的模型：不用取
  assert.equal(timeFetchFrom('n'), null);
});

test('fetchTimes：要的那一步取到了才记“取过”，请求失败记成没取到', async () => {
  const S = { stepAt: new Map(), execAt: new Map(), timeBusy: new Set(), timeFetched: new Map(), render: () => {} };
  let answer = null;
  const tms = (iso) => Date.parse(iso);
  const stepMap = (id) => { let m = S.stepAt.get(id); if (!m) { m = new Map(); S.stepAt.set(id, m); } return m; };
  const code = cut('statusbar.js', '  S.fetchTimes = ', '\n  // 定时器每秒调一次');
  const run = new Function('S', 'lsCall', 'stepMap', 'tms', code + '\nreturn S.fetchTimes;')(S, () => Promise.resolve(answer), stepMap, tms);
  run('c', 30);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(S.timeFetched.get('c').get(30).ok, false); // 后台没回（null）
  answer = { steps: [{ metadata: { createdAt: '2026-11-25T01:00:00Z', executionId: 'e1' } }] };
  run('c', 30);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(S.timeFetched.get('c').get(30).ok, true);
  assert.equal(S.stepAt.get('c').get(30), Date.parse('2026-11-25T01:00:00Z'));
});

test('readJsonKeep：只有文件不存在才返回 null；读出错重试几次后抛错（不再当成没有文件，审查 A1）', () => {
  const logs = [];
  const readJsonKeep = new Function('fs', 'path', 'log', cutInject('const sleepSync = ', '// ---------- 单实例') + '\nreturn readJsonKeep;')(fs, path, (s) => logs.push(s));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-a1-'));
  try {
    assert.equal(readJsonKeep(path.join(dir, 'none.json')), null);
    fs.writeFileSync(path.join(dir, 'ok.json'), '﻿{"a":1}');
    assert.deepEqual(readJsonKeep(path.join(dir, 'ok.json')), { a: 1 });
    // 读一个文件夹会报 EISDIR（Windows 上是 EISDIR 或 EPERM）：代表“文件在、但读不了”
    assert.throws(() => readJsonKeep(dir), (e) => e.code === 'AGY_READ_FAILED');
    assert.ok(logs.some((s) => /could not be read/.test(s)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('注入程序的账本：cost-day.json 读不出来时不合并、不写（免得盖掉文件里今天别的对话）；旧版本（v1、v2）的账本丢掉', () => {
  const id = 'a'.repeat(8) + '-1111-2222-3333-' + 'b'.repeat(12);
  const writes = [];
  const UNREAD = Symbol('unread');
  const load = (reader) => new Function('readJsonKeep', 'COST_FILE', 'dayName', 'writeFileSafe', 'log', 'UNREAD',
    cutInject('let costBook = null;', '// 今天动过的对话') + '\nreturn { readCostBook, mergeCostBook };')(
    reader, 'cost-day.json', () => '2026-11-25', (f, s) => writes.push(JSON.parse(s)), () => {}, UNREAD);
  // 读不出来
  const bad = load(() => { throw Object.assign(Error('busy'), { code: 'AGY_READ_FAILED' }); });
  assert.ok(bad.readCostBook()[UNREAD]);
  bad.mergeCostBook({ day: '2026-11-25', v: 3, by: { [id]: 7.46 }, det: {} });
  assert.equal(writes.length, 0);
  // v1 的文件：丢掉；v1、v2 页面交来的不收；v3 之间取较大的数
  const v1 = load(() => ({ day: '2026-11-25', by: { [id]: 14.18 }, det: {} }));
  const book = v1.readCostBook();
  assert.equal(book.v, 3);
  assert.deepEqual(book.by, {});
  v1.mergeCostBook({ day: '2026-11-25', by: { [id]: 20 }, det: {} });
  v1.mergeCostBook({ day: '2026-11-25', v: 2, by: { [id]: 13.79 }, det: {} }); // v2：旁支复制来的调用算进了今天（11-26）
  assert.equal(writes.length, 0);
  v1.mergeCostBook({ day: '2026-11-25', v: 3, by: { [id]: 7.46 }, det: {} });
  v1.mergeCostBook({ day: '2026-11-25', v: 3, by: { [id]: 7.0 }, det: {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].by[id], 7.46);
  // v2 的文件也丢掉
  const v2 = load(() => ({ day: '2026-11-25', v: 2, by: { [id]: 13.79 }, det: {} }));
  assert.deepEqual(v2.readCostBook().by, {});
});

test('注入程序的账本：带 fix 的数直接替换（可以改小），以后只认带 fix 的数；明细跟着换，没带就删（代码审查 11-26）', () => {
  const id = 'c'.repeat(8) + '-1111-2222-3333-' + 'd'.repeat(12);
  const other = 'e'.repeat(8) + '-1111-2222-3333-' + 'f'.repeat(12);
  const writes = [];
  const fns = new Function('readJsonKeep', 'COST_FILE', 'dayName', 'writeFileSafe', 'log', 'UNREAD',
    cutInject('let costBook = null;', '// 今天动过的对话') + '\nreturn { readCostBook, mergeCostBook };')(
    () => null, 'cost-day.json', () => '2026-11-26', (f, s) => writes.push(JSON.parse(s)), () => {}, Symbol('unread'));
  const det = (usd, n) => ({ 'Claude Opus 4.6': [usd, n, 1, 2, 3, 4] });
  // 确认前多算了一次（复制来的调用算进了今天）
  fns.mergeCostBook({ day: '2026-11-26', v: 3, by: { [id]: 13.79, [other]: 2 }, det: { [id]: det(13.79, 40) } });
  assert.equal(writes.at(-1).by[id], 13.79);
  // 确认是副本：改小
  fns.mergeCostBook({ day: '2026-11-26', v: 3, by: { [id]: 0.16 }, det: { [id]: det(0.16, 2) }, fix: { [id]: 1 } });
  assert.equal(writes.at(-1).by[id], 0.16);
  assert.deepEqual(writes.at(-1).fix, { [id]: 1 });
  assert.deepEqual(writes.at(-1).det[id], det(0.16, 2));
  assert.equal(writes.at(-1).by[other], 2); // 别的对话不动
  // 别的窗口（还没确认）交来的旧数、旧明细：不收
  const n = writes.length;
  fns.mergeCostBook({ day: '2026-11-26', v: 3, by: { [id]: 13.79 }, det: { [id]: det(13.79, 40) } });
  assert.equal(writes.length, n);
  // 副本今天自己的调用变多了：照样替换；没带明细就删掉旧明细
  fns.mergeCostBook({ day: '2026-11-26', v: 3, by: { [id]: 0.3 }, det: {}, fix: { [id]: 1 } });
  assert.equal(writes.at(-1).by[id], 0.3);
  assert.equal(writes.at(-1).det[id], undefined);
  // 同样的数再交一次不写文件
  const m = writes.length;
  fns.mergeCostBook({ day: '2026-11-26', v: 3, by: { [id]: 0.3 }, fix: { [id]: 1 } });
  assert.equal(writes.length, m);
});

test('使用历史里今天的数：新版本账本还空着不换；纠正了副本（fix 个数变了）可以改小；账本读不出来不动', () => {
  const UNREAD = Symbol('unread');
  const run = (day, book) => {
    const h = { v: 3, days: { '2026-11-26': day } };
    new Function('readHistory', 'summarizeBook', 'COST_BOOK_V', 'UNREAD', 'saveHistory', 'HISTORY_KEEP_DAYS', 'log',
      cutInject('function updateHistory(', '// 推给页面的历史') + '\nreturn updateHistory;')(
      () => h, (b) => ({ usd: Object.values(b.by).reduce((a, x) => a + x, 0), convs: 1, models: {} }), 3, UNREAD, () => {}, 400, () => {})(
      book, null, null, 0);
    return h.days['2026-11-26'];
  };
  const book = (by, fix = {}) => ({ day: '2026-11-26', v: 3, by, det: {}, fix });
  // 旧版本（v2）记的今天 13.79：新版本账本还空着（页面脚本还是旧版本）时先不换，免得今天被写成 0
  assert.equal(run({ usd: 13.79, bv: 2 }, book({})).usd, 13.79);
  // 新版本账本有数了：换成新的（可以更小）
  assert.deepEqual(run({ usd: 13.79, bv: 2 }, book({ a: 0.5 })), { usd: 0.5, convs: 1, models: {}, bv: 3, fx: 0 });
  // 同版本：文件里的数更大（账本被重置过）就保留
  assert.equal(run({ usd: 5, bv: 3, fx: 0 }, book({ a: 0.5 })).usd, 5);
  // 同版本、账本里新纠正了一个副本：换一次，可以改小；之后照旧保留较大的
  assert.deepEqual(run({ usd: 5, bv: 3, fx: 0 }, book({ a: 0.5 }, { a: 1 })), { usd: 0.5, convs: 1, models: {}, bv: 3, fx: 1 });
  assert.equal(run({ usd: 5, bv: 3, fx: 1 }, book({ a: 0.5 }, { a: 1 })).usd, 5);
  // 账本这次读不出来：不动
  const b = book({ a: 0.5 });
  b[UNREAD] = true;
  assert.equal(run({ usd: 5, bv: 2 }, b).usd, 5);
});

test('页面账本 v3：v1、v2 的不合并，v3 之间取较大的数；带 fix 的直接替换、以后只认带 fix 的；todayCost 交给账本的数要带版本号', () => {
  const mergeBook = new Function(cut('statusbar.js', '  const detCalls = ', '  const loadBook = ') + '\nreturn mergeBook;')();
  const book = { day: '2026-11-25', v: 3, by: {}, det: {} };
  mergeBook(book, { day: '2026-11-25', by: { c: 14.18 } }); // v1（没有 v）：不合并
  mergeBook(book, { day: '2026-11-25', v: 2, by: { c: 13.79 } }); // v2：旁支复制来的调用算进了今天
  assert.deepEqual(book.by, {});
  mergeBook(book, { day: '2026-11-25', v: 3, by: { c: 7.46 } });
  mergeBook(book, { day: '2026-11-25', v: 3, by: { c: 7.0 } });
  assert.equal(book.by.c, 7.46);
  // 副本：确认前多算过（13.79），确认后改小（代码审查 11-26：原来取较大的数，改对了也写不回去）
  const det = (usd, n) => ({ M: [usd, n, 0, 0, 0, 0] });
  mergeBook(book, { day: '2026-11-25', v: 3, by: { s: 13.79 }, det: { s: det(13.79, 40) } });
  mergeBook(book, { day: '2026-11-25', v: 3, by: { s: 0.16 }, det: { s: det(0.16, 2) }, fix: { s: 1 } });
  assert.equal(book.by.s, 0.16);
  assert.deepEqual(book.fix, { s: 1 });
  assert.deepEqual(book.det.s, det(0.16, 2));
  // localStorage、别的窗口里没纠正的旧数盖不回去
  mergeBook(book, { day: '2026-11-25', v: 3, by: { s: 13.79 }, det: { s: det(13.79, 40) } });
  assert.equal(book.by.s, 0.16);
  assert.deepEqual(book.det.s, det(0.16, 2));
  // 没带明细的纠正：删掉旧明细
  mergeBook(book, { day: '2026-11-25', v: 3, by: { s: 0 }, fix: { s: 1 } });
  assert.equal(book.by.s, 0);
  assert.equal(book.det.s, undefined);
  // 从 localStorage 读回来的账本（带 fix）合并进新账本：fix 记号也带过去
  const fresh = { day: '2026-11-25', v: 3, by: {}, det: {} };
  mergeBook(fresh, book);
  assert.deepEqual(fresh.fix, { s: 1 });
  assert.equal(fresh.by.c, 7.46);
  // 11-25 实测漏过一次：todayCost 交给账本的数没带 v，全被当成 v1 丢掉，今天花费一直是 0
  assert.match(read('statusbar.js'), /mergeBook\(book, \{ day: book\.day, v: BOOK_V, by, det: detBy, fix: fixBy \}\)/);
});

test('调用明细 loadConv0：取步骤失败时抛错，不记成“取完了”（审查 A4）', async () => {
  const S = { casMeta: new Map([['c', { modified: 5 }]]), detCache: new Map() };
  let stepsAnswer = null;
  const lsCall = (method) => Promise.resolve(method === 'GetCascadeTrajectoryGeneratorMetadata'
    ? { generatorMetadata: [{ executionId: 'e1', stepIndices: [3], chatModel: { usage: { inputTokens: '10' } } }] } : stepsAnswer);
  const noted = [];
  const loadConv0 = new Function('S', 'fileMeta', 'lsCall', 'slimCall', 'tms', 'noteExecs',
    cut('statusbar.js', '  const loadConv0 = async', '  // 同一个对话正在取时') + '\nreturn loadConv0;')(
    S, () => null, lsCall, (m) => ({ exec: m.executionId, step: m.stepIndices[0] }), (iso) => Date.parse(iso), (id, gens) => noted.push([id, gens.length]));
  await assert.rejects(loadConv0('c'), /no trajectory steps/);
  assert.ok(!S.detCache.get('c').done);
  stepsAnswer = { steps: [0, 1, 2, 3].map((i) => ({ metadata: { createdAt: `2026-11-25T01:0${i}:00Z` } })) };
  const c = await loadConv0('c');
  assert.ok(c.done);
  assert.equal(c.times.get(3), Date.parse('2026-11-25T01:03:00Z'));
});

// 周期开始那天按调用时间算花费（statusbar.js 的 callsPart）：刚启动时对话列表还没到，一个对话都找不到
test('callsPart：一个对话都没找到、那天桌面版却有花费时当成没取到，15 秒后再试；对话列表到了以后照常算；那天桌面版没花钱时 $0 照常记', async () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const mk = (rec, load) => {
    const S = { lsHeaders: {}, cliAsk() {}, loadCalls: async () => load() };
    const fn = new Function('S', 'dayName', 'dayRecord', 'callCost', 'callNames', 'modelGroup', 'cliRows', 'P', 'refreshPanel', 'document',
      cut('statusbar.js', '  S.capPart = S.capPart || {};', '  // 一段时间（start～end') + '\nreturn callsPart;')(
      S, () => '2026-11-27', () => rec, (u) => ({ usd: u.usd, pr: { name: 'Gemini 4 Hydrogen' }, inp: u.tok, cr: 0, cw: 0, out: 0 }),
      () => '', () => 'gemini', () => [], '.p', () => {}, { querySelector: () => null });
    return { S, callsPart: fn };
  };
  const from = T('2026-11-26T15:03:00');
  // 有 CLI 的那天：usd 含 CLI，桌面版的在 deskUsd
  let rows = { rows: [], convs: 0, failed: 0 };
  const a = mk({ usd: 82, deskUsd: 60, cli: { usd: 22 } }, () => rows);
  assert.equal(a.callsPart('gemini', '2026-11-26', from, Infinity), null);
  await flush();
  const k = Object.keys(a.S.capPart)[0];
  assert.equal(a.S.capPart[k].desk, null); // 没记成 $0
  const wait = Date.now() - a.S.capPart[k].at;
  assert.ok(wait > 3600e3 - 16000 && wait <= 3600e3 - 14000, '15 秒后再试，实际 ' + wait); // 以前的天正常 1 小时才重取
  // 15 秒后：对话列表到了
  a.S.capPart[k].at -= 15000;
  rows = { rows: [{ at: from + H, usage: { usd: 30, tok: 1e6 } }, { at: from - H, usage: { usd: 9, tok: 1 } }], convs: 3, failed: 0 };
  a.callsPart('gemini', '2026-11-26', from, Infinity);
  await flush();
  assert.deepEqual(a.callsPart('gemini', '2026-11-26', from, Infinity), { usd: 30, tok: 1e6, failed: 0 }); // 15:03 以前的那次不算
  assert.ok(Date.now() - a.S.capPart[k].at < 1000);
  // 那天桌面版没花钱（只用了 CLI）：找不到对话是正常的，$0 照常记
  const b = mk({ usd: 5, deskUsd: 0, cli: { usd: 5 } }, () => ({ rows: [], convs: 0, failed: 0 }));
  b.callsPart('gemini', '2026-11-26', from, Infinity);
  await flush();
  assert.deepEqual(b.callsPart('gemini', '2026-11-26', from, Infinity), { usd: 0, tok: 0, failed: 0 });
});
