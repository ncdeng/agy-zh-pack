// 今天花费按每次调用自己的时间定日子（statusbar.js 的 callAt / timeFetchFrom）、账本 v2（inject.mjs 的 readCostBook / mergeCostBook）
import test from 'node:test';
import assert from 'node:assert/strict';
import { cut, cutInject, read, T, H } from './_helpers.mjs';

const D0 = T('2026-11-25T00:00:00');
const mkS = () => ({ stepAt: new Map(), detCache: new Map(), execAt: new Map(), costs: new Map(), timeTried: new Map() });
const callAtOf = (S) => new Function('S', cut('statusbar.js', '  const callAt = ', '  // 跨 0 点的对话还有调用不知道时间') + '\nreturn callAt;')(S);

test('callAt：先用这次调用自己那一步的时间，跨 0 点的一轮不再整轮算进今天', () => {
  const S = mkS();
  const callAt = callAtOf(S);
  const meta = { created: D0 - 2 * H, modified: D0 + H }; // 昨晚 22 点建的对话，今天 1 点还在跑
  // 一轮从 23:42 跑到 00:07：S.execAt 存的是这一轮最新一步的时间（00:07）
  S.execAt.set('e1', D0 + 7 * 60e3);
  assert.equal(callAt('c', { exec: 'e1', step: 10 }, meta, D0), null); // 不知道这次调用自己的时间：不再按 00:07 算进今天
  S.stepAt.set('c', new Map([[10, D0 - 18 * 60e3]]));
  assert.equal(callAt('c', { exec: 'e1', step: 10 }, meta, D0), D0 - 18 * 60e3); // 23:42，算昨天
  // 调用明细取过的步骤时间也能用
  S.detCache.set('c', { times: new Map([[20, D0 + 5 * 60e3]]) });
  assert.equal(callAt('c', { exec: 'e1', step: 20 }, meta, D0), D0 + 5 * 60e3);
  // 整轮都在 0 点前结束的：按这一轮的时间算（不用知道每次调用的）
  S.execAt.set('e0', D0 - H);
  assert.equal(callAt('c', { exec: 'e0', step: 3 }, meta, D0), D0 - H);
  // 今天建的对话：调用都在今天
  assert.equal(callAt('c2', { exec: 'x', step: 1 }, { created: D0 + H, modified: D0 + 2 * H }, D0), D0 + H);
});

test('timeFetchFrom：末尾的新调用从它那一步取；取过的起点不重取；都知道时间就不取', () => {
  const S = mkS();
  const callAt = callAtOf(S);
  const meta = { created: D0 - 2 * H, modified: D0 + H };
  const timeFetchFrom = new Function('S', 'convMeta', 'dayStart', 'callAt', cut('statusbar.js', '  const timeFetchFrom = ', '  S.fetchTimes = ') + '\nreturn timeFetchFrom;')(S, () => meta, () => D0, callAt);
  const list = [0, 1, 2, 3, 4, 5].map((i) => ({ exec: 'e1', step: i * 10 }));
  S.costs.set('c', { list });
  S.execAt.set('e1', D0 + 30 * 60e3); // 这一轮跨过 0 点
  // 前 4 次已经知道时间（第 3、4 次在 0 点后），最后 2 次是取过以后新来的
  S.stepAt.set('c', new Map([[0, D0 - 50 * 60e3], [10, D0 - 40 * 60e3], [20, D0 + 60e3], [30, D0 + 2 * 60e3]]));
  assert.equal(timeFetchFrom('c'), 40); // 从第一次不知道时间的调用那一步取
  S.timeTried.set('c', new Set([40]));
  assert.equal(timeFetchFrom('c'), null); // 这个起点取过了，不重取（防止死循环）
  S.stepAt.get('c').set(40, D0 + 3 * 60e3).set(50, D0 + 4 * 60e3);
  assert.equal(timeFetchFrom('c'), null); // 都知道了
  // 一个都不知道：按 0 点在对话里的位置估一个起点往后取
  S.stepAt.set('c', new Map());
  S.timeTried.set('c', new Set());
  const from = timeFetchFrom('c');
  assert.ok(from >= 0 && from <= 50, String(from));
});

test('注入程序的账本 v2：丢掉 v1 的 cost-day.json，不收 v1 页面交来的账本', () => {
  let file = { day: '2026-11-25', by: { ['a'.repeat(8) + '-1111-2222-3333-' + 'b'.repeat(12)]: 14.18 }, det: {} }; // v1：多算了
  const writes = [];
  const code = cutInject('let costBook = null;', '// 今天动过的对话');
  const { readCostBook, mergeCostBook } = new Function('readJsonKeep', 'COST_FILE', 'dayName', 'writeFileSafe', 'log',
    code + '\nreturn { readCostBook, mergeCostBook };')(() => file, 'cost-day.json', () => '2026-11-25', (f, s) => writes.push(JSON.parse(s)), () => {});
  const book = readCostBook();
  assert.equal(book.v, 2);
  assert.deepEqual(book.by, {}); // v1 的数丢掉，由状态栏从头重算
  const id = 'a'.repeat(8) + '-1111-2222-3333-' + 'b'.repeat(12);
  mergeCostBook({ day: '2026-11-25', by: { [id]: 20 }, det: {} }); // v1 页面（还没换成新代码的窗口）交来的
  assert.equal(writes.length, 0);
  mergeCostBook({ day: '2026-11-25', v: 2, by: { [id]: 7.46 }, det: {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].v, 2);
  assert.equal(writes[0].by[id], 7.46);
  mergeCostBook({ day: '2026-11-25', v: 2, by: { [id]: 7.0 }, det: {} }); // v2 之间照旧取较大的数
  assert.equal(writes.length, 1);
  file = null;
});

test('页面账本 v2：v1 的不合并，v2 之间取较大的数；todayCost 交给账本的数要带版本号', () => {
  const mergeBook = new Function(cut('statusbar.js', '  const detCalls = ', '  const loadBook = ') + '\nreturn mergeBook;')();
  const book = { day: '2026-11-25', v: 2, by: {}, det: {} };
  mergeBook(book, { day: '2026-11-25', by: { c: 14.18 } }); // v1（没有 v）：不合并
  assert.deepEqual(book.by, {});
  mergeBook(book, { day: '2026-11-25', v: 2, by: { c: 7.46 } });
  mergeBook(book, { day: '2026-11-25', v: 2, by: { c: 7.0 } });
  assert.equal(book.by.c, 7.46);
  // 11-25 实测漏过一次：todayCost 交给账本的数没带 v，全被当成 v1 丢掉，今天花费一直是 0
  assert.match(read('statusbar.js'), /mergeBook\(book, \{ day: book\.day, v: BOOK_V, by, det: detBy \}\)/);
});
