// 副本（/btw 旁支、分叉出来的对话）只算自己的调用（statusbar.js 的 noteExecs / copyEvidence / ownFrom / S.fetchInh，2026-11-26 加，
// 同一天按 Devin、Grok 的代码审查改过）。
// 数据形状照 11-26 实测：旁支和分叉把原对话的步骤、调用元数据原样复制过来（executionId、步骤时间都不变），再接自己的步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cut, read } from './_helpers.mjs';

const code = cut('statusbar.js', '  // ---------- 副本：', '  // 定时器每秒调一次：');
const T0 = Date.parse('2026-11-26T00:27:39Z');
const iso = (ms) => new Date(ms).toISOString();

// steps[id]：每一步的时间（毫秒；0 = 这一步没有时间）。没有这一项 = 请求失败（null）；
// 'hang' = 一直不返回；'throw' = 请求出错。day0：今天 0 点（默认在 T0 前一小时，T0 建的对话算今天新建的）
function setup({ now = T0 + 3600e3, day0 = T0 - 3600e3, steps = {}, pre } = {}) {
  const S = {
    casMeta: new Map(), copyKind: new Map(), inhCut: new Map(), execOwner: new Map(), stepAt: new Map(), detCache: new Map(),
    subInfo: new Map(), rootOf: new Map(), costs: new Map(), fetched: [], renders: 0,
  };
  S.render = () => { S.renders++; };
  S.fetchCost = (id) => S.fetched.push(id);
  if (pre) pre(S);
  const stepMap = (id) => { let m = S.stepAt.get(id); if (!m) { m = new Map(); S.stepAt.set(id, m); } return m; };
  const asked = [], timers = [];
  const clock = { t: now };
  const lsCall = (method, body) => {
    asked.push([body.cascadeId, body.stepOffset]);
    const all = steps[body.cascadeId];
    if (all === 'hang') return new Promise(() => {});
    if (all === 'throw') return Promise.reject(Error('请求出错'));
    if (!all) return Promise.resolve(null);
    return Promise.resolve({ steps: all.slice(body.stepOffset).map((t) => (t ? { metadata: { createdAt: iso(t) } } : { metadata: {} })) });
  };
  const fakeTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  const fns = new Function('S', 'stepMap', 'lsCall', 'tms', 'Date', 'dayStart', 'setTimeout',
    code + '\nreturn { noteExecs, copyEvidence, ownFrom };')(
    S, stepMap, lsCall, (s) => Date.parse(s), { now: () => clock.t }, () => day0, fakeTimeout);
  return { S, asked, clock, timers, ...fns };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const tick = async () => { for (let i = 0; i < 10; i++) await flush(); };
const own = (e, id, list, meta) => e.ownFrom(id, list, meta || e.S.casMeta.get(id));

test('旁支：分界没取到时先不算（-1）并去取步骤时间；取到以后只算自己的调用', async () => {
  // 原对话两轮（步骤 0～3，调用在第 1、3 步）；旁支 S 在 20 秒后建：复制 0～3，第 4 步是系统消息，第 5、6 步是自己的
  const created = T0 + 20e3;
  const e = setup({ steps: { S: [T0, T0 + 50, T0 + 10e3, T0 + 10e3 + 50, created + 56, created + 75, created + 129] } });
  e.S.casMeta.set('S', { created, steps: 7 });
  e.S.copyKind.set('S', 'side');
  const list = [{ exec: 'e1', step: 1 }, { exec: 'e2', step: 3 }, { exec: 'e3', step: 6 }];
  assert.equal(own(e, 'S', list), -1);
  await tick();
  assert.deepEqual(e.asked, [['S', 0]]); // 只有 7 步：一次就从第 0 步取到了
  assert.deepEqual(e.S.inhCut.get('S'), { created, step: 4 }); // 第 3 步还是复制来的，第 4 步起是自己的
  assert.equal(own(e, 'S', list), 2);
  assert.equal(e.S.stepAt.get('S').get(6), created + 129); // 取到的时间也给 callTimes 用
  assert.equal(e.S.renders, 1);
});

test('大对话的副本：从最后 8 步开始往前，每次多取 4 倍，碰到早于创建时间的步骤就停', async () => {
  const created = T0 + 3600e3;
  const all = Array.from({ length: 601 }, (_, i) => (i < 590 ? T0 + i * 1000 : created + (i - 589) * 1000)); // 第 590 步起是自己的
  const e = setup({ steps: { F: all } });
  e.S.casMeta.set('F', { created, steps: 601 });
  e.S.copyKind.set('F', 'side');
  const list = [{ exec: 'a', step: 100 }, { exec: 'b', step: 589 }, { exec: 'c', step: 595 }, { exec: 'd', step: 600 }];
  assert.equal(own(e, 'F', list), -1);
  await tick();
  assert.deepEqual(e.asked.map((x) => x[1]), [593, 569]); // 593～600 都是自己的；569 起这一段里有复制来的
  assert.equal(e.S.inhCut.get('F').step, 590);
  assert.equal(own(e, 'F', list), 2);
});

test('分叉：第一次调用的 executionId 属于更早建的对话，就是副本；原对话不是', async () => {
  const created = T0 + 30e3;
  const e = setup({ day0: T0 + 10e3, steps: { F: [T0, T0 + 50, T0 + 10e3, T0 + 10e3 + 50, created + 60, created + 80, created + 100] } });
  e.S.casMeta.set('P', { created: T0, steps: 4 }); // 原对话昨天建的
  e.S.casMeta.set('F', { created, steps: 7 });
  const P = [{ exec: 'e1', step: 1 }, { exec: 'e2', step: 3 }];
  const F = [{ exec: 'e1', step: 1 }, { exec: 'e2', step: 3 }, { exec: 'e9', step: 6 }];
  e.noteExecs('F', F); // 先登记副本也一样：按创建时间取最早的
  e.noteExecs('P', P);
  assert.equal(e.S.execOwner.get('e1').id, 'P');
  assert.equal(e.copyEvidence('F', F[0], 0, created, created), true);
  assert.equal(e.copyEvidence('P', P[0], 0, T0, T0), false);
  assert.equal(own(e, 'P', P), 0); // 昨天建的、没有副本的证据：不取步骤时间，全算
  assert.equal(own(e, 'F', F), -1);
  await tick();
  assert.deepEqual(e.asked, [['F', 0]]);
  assert.equal(own(e, 'F', F), 2);
});

test('已知第一次调用的步骤时间早于创建时间，也是副本；子智能体不看 executionId', () => {
  const e = setup();
  const created = T0 + 30e3;
  e.S.casMeta.set('F', { created });
  const g = { exec: 'x1', step: 1 };
  assert.equal(e.copyEvidence('F', g, 0, created, created), false);
  assert.equal(e.copyEvidence('F', g, T0, created, created), true);
  // 子智能体：executionId 的主人是更早建的对话也不算证据
  e.S.casMeta.set('P', { created: T0 });
  e.noteExecs('P', [{ exec: 'x1', step: 1 }]);
  assert.equal(e.copyEvidence('F', g, 0, created, created), true);
  e.S.subInfo.set('F', {});
  assert.equal(e.copyEvidence('F', g, 0, created, created), false);
});

test('普通对话：第一次调用的时间已知、不早于创建时间就全算；以前建的对话不用确认', () => {
  const e = setup({ day0: T0 + 10e3 });
  e.S.casMeta.set('N', { created: T0 + 20e3 });
  e.S.stepAt.set('N', new Map([[1, T0 + 20e3 + 50]]));
  const list = [{ exec: 'n1', step: 1 }, { exec: 'n2', step: 3 }];
  assert.equal(own(e, 'N', list), 0);
  e.S.casMeta.set('Y', { created: T0 }); // 昨天建的，第一次调用的时间不知道
  assert.equal(own(e, 'Y', [{ exec: 'y1', step: 1 }]), 0);
  assert.deepEqual(e.asked, []);
  assert.equal(own(e, 'Z', []), 0); // 没有调用
});

test('今天新建、认不出的分叉（原对话没加载）：确认前先不算（-1），从第一次调用那一步取完；普通对话一次就确认（审查 A）', async () => {
  const created = T0 + 30e3;
  const e = setup({ steps: {
    F: [T0, T0 + 50, T0 + 10e3, T0 + 10e3 + 50, created + 60, created + 80, created + 100],
    N: [created + 10, created + 40, created + 90, created + 200],
  } });
  e.S.casMeta.set('F', { created, steps: 7 });
  e.S.casMeta.set('N', { created, steps: 4 });
  const F = [{ exec: 'e1', step: 1 }, { exec: 'e2', step: 3 }, { exec: 'e9', step: 6 }];
  const N = [{ exec: 'n1', step: 1 }, { exec: 'n2', step: 3 }];
  assert.equal(own(e, 'F', F), -1);
  assert.equal(own(e, 'N', N), -1);
  await tick();
  assert.deepEqual(e.asked, [['F', 1], ['N', 1]]);
  assert.deepEqual(e.S.inhCut.get('F'), { created, step: 4 });
  assert.deepEqual(e.S.inhCut.get('N'), { created, step: 0 });
  assert.equal(own(e, 'F', F), 2);
  assert.equal(own(e, 'N', N), 0);
});

test('今天新建的子智能体：不用确认，直接全算；rootConversationId 指向自己的不是子智能体', async () => {
  const e = setup({ steps: { B: [T0 + 30e3 + 10, T0 + 30e3 + 20] } });
  e.S.casMeta.set('A', { created: T0 + 30e3 });
  e.S.rootOf.set('A', 'R');
  assert.equal(own(e, 'A', [{ exec: 'a1', step: 1 }]), 0);
  assert.deepEqual(e.asked, []);
  // 状态流里根对话也会记一条指向自己的 rootConversationId（11-26 实测：一个旁支因此被当成子智能体）
  e.S.casMeta.set('B', { created: T0 + 30e3, steps: 2 });
  e.S.rootOf.set('B', 'B');
  assert.equal(own(e, 'B', [{ exec: 'b1', step: 1 }]), -1);
  await tick();
  assert.deepEqual(e.asked, [['B', 1]]);
  assert.equal(own(e, 'B', [{ exec: 'b1', step: 1 }]), 0);
});

test('空的步骤列表、步骤没有时间都算没取到；60 秒后再取；连续 3 次没取到就放弃', async () => {
  const created = T0 + 20e3;
  const e = setup({ steps: { E: [], G: [0, 0, 0], N: [] } });
  e.S.casMeta.set('E', { created, steps: 3 });
  e.S.copyKind.set('E', 'side');
  const list = [{ exec: 'a', step: 0 }, { exec: 'b', step: 2 }];
  assert.equal(own(e, 'E', list), -1);
  await tick();
  assert.equal(e.S.inhCut.has('E'), false); // 原来空列表当成“不是副本”，分界记成 0、全算
  assert.equal(e.S.inhRun.get('E').fails, 1);
  assert.equal(own(e, 'E', list), -1);
  await tick();
  assert.equal(e.asked.length, 1); // 60 秒内不重取
  for (let i = 0; i < 2; i++) { e.clock.t += 61e3; own(e, 'E', list); await tick(); }
  assert.equal(e.asked.length, 3);
  e.clock.t += 61e3;
  assert.equal(own(e, 'E', list), -1);
  assert.deepEqual(e.S.inhCut.get('E'), { created, giveUp: true });
  assert.equal(e.asked.length, 3);
  // 放弃了的副本：只算已经知道时间、不早于创建时间的调用
  assert.equal(own(e, 'E', list), 2);
  e.S.stepAt.set('E', new Map([[2, created + 5]]));
  assert.equal(own(e, 'E', list), 1);
  // 步骤都没有时间：也算没取到
  e.S.casMeta.set('G', { created, steps: 3 });
  e.S.copyKind.set('G', 'side');
  own(e, 'G', list);
  await tick();
  assert.equal(e.S.inhCut.has('G'), false);
  assert.equal(e.S.inhRun.get('G').fails, 1);
  // 'full'（今天新建、只是还没确认）放弃时当普通对话全算
  e.S.casMeta.set('N', { created, steps: 3 });
  for (let i = 0; i < 3; i++) { own(e, 'N', list); await tick(); e.clock.t += 61e3; }
  assert.equal(own(e, 'N', list), -1);
  assert.deepEqual(e.S.inhCut.get('N'), { created, step: 0 });
  assert.equal(own(e, 'N', list), 0);
});

test('同一个对话同时只取一份；请求 2 分钟不返回算没取到；请求出错也算', async () => {
  const created = T0 + 20e3;
  const e = setup({ steps: { H: 'hang', X: 'throw' } });
  e.S.casMeta.set('H', { created, steps: 3 });
  e.S.copyKind.set('H', 'side');
  const list = [{ exec: 'a', step: 1 }];
  assert.equal(own(e, 'H', list), -1);
  assert.equal(own(e, 'H', list), -1);
  await tick();
  assert.equal(e.asked.length, 1);
  assert.deepEqual(e.timers.map((t) => t.ms), [120000]);
  e.timers[0].f(); // 2 分钟到了
  await tick();
  assert.equal(e.S.inhRun.get('H').running, false);
  assert.equal(e.S.inhRun.get('H').fails, 1);
  e.S.casMeta.set('X', { created, steps: 3 });
  e.S.copyKind.set('X', 'side');
  own(e, 'X', list);
  await tick();
  assert.equal(e.S.inhRun.get('X').running, false);
  assert.equal(e.S.inhRun.get('X').fails, 1);
});

test('摘要里的创建时间变了（例如对话被恢复）：分界作废，重新确认', async () => {
  const created = T0 + 20e3;
  const e = setup({ steps: { S: [T0, T0 + 50, created + 10] } });
  e.S.casMeta.set('S', { created, steps: 3 });
  e.S.copyKind.set('S', 'side');
  e.S.inhCut.set('S', { created: T0 - 5000, step: 0 });
  const list = [{ exec: 'e1', step: 1 }, { exec: 'e3', step: 2 }];
  assert.equal(own(e, 'S', list), -1);
  await tick();
  assert.deepEqual(e.S.inhCut.get('S'), { created, step: 2 });
  assert.equal(own(e, 'S', list), 1);
});

test('摘要里还没有这个对话（只有对话文件）：按 executionId 找分界；旁支的原对话没登记就去取；今天的新对话最多等 3 分钟', () => {
  const created = T0 + 20e3;
  const e = setup();
  e.S.casMeta.set('P', { created: T0 });
  e.noteExecs('P', [{ exec: 'e1', step: 1 }, { exec: 'e2', step: 3 }]);
  e.S.copyKind.set('S', 'side');
  const list = [{ exec: 'e1', step: 1 }, { exec: 'e2', step: 3 }, { exec: 'e3', step: 6 }];
  assert.equal(own(e, 'S', list, { created }), 2);
  // 原对话的调用列表还没取：先不算，并去取原对话的调用列表
  e.S.copyKind.set('S2', 'side');
  e.S.copyParent.set('S2', 'Q');
  assert.equal(own(e, 'S2', [{ exec: 'q1', step: 1 }], { created }), -1);
  assert.deepEqual(e.S.fetched, ['Q']);
  // 摘要里没有的旧对话 O 被分叉成 F（F 先登记成 e7 的主人）：O 自己不能当成副本
  e.S.casMeta.set('F', { created });
  e.noteExecs('F', [{ exec: 'e7', step: 1 }]);
  assert.equal(own(e, 'O', [{ exec: 'e7', step: 1 }], { created: T0 - 86400e3 }), 0);
  // 今天新建、摘要还没来、没有证据：最多等 3 分钟
  assert.equal(own(e, 'W', [{ exec: 'w1', step: 1 }], { created }), -1);
  e.clock.t += 181e3;
  assert.equal(own(e, 'W', [{ exec: 'w1', step: 1 }], { created }), 0);
  assert.deepEqual(e.asked, []);
});

test('热更新到这一版时，已经取到的调用列表也登记 executionId', () => {
  const e = setup({ pre: (S) => {
    S.casMeta.set('P', { created: T0 });
    S.costs.set('P', { list: [{ exec: 'e1', step: 1 }] });
    S.casMeta.set('Q', { created: T0 + 5 });
    S.detCache.set('Q', { gens: [{ exec: 'e2', step: 0 }] });
    S.costs.set('U', { list: [{ exec: 'e3', step: 0 }] }); // 摘要里没有：不登记
  } });
  assert.deepEqual(e.S.execOwner.get('e1'), { id: 'P', created: T0 });
  assert.deepEqual(e.S.execOwner.get('e2'), { id: 'Q', created: T0 + 5 });
  assert.equal(e.S.execOwner.has('e3'), false);
});

test('今天花费、对话累计、补取时间都按 ownFrom 只算副本自己的调用；调用明细跳过复制来的调用；账本 v3 带 fix', () => {
  const src = read('statusbar.js');
  assert.match(src, /const k0 = ownFrom\(id, c\.list, meta\);[^\n]*\n\s*if \(k0 < 0\) \{ loading\+\+; continue; \}[^\n]*\n\s*if \(k0 > 0\) fixBy\[id\] = 1;/); // todayCost
  assert.match(src, /const k0 = ownFrom\(id, c\.list, meta\);[^\n]*\n\s*if \(k0 < 0\) continue;/); // treeCost
  assert.match(src, /const k0 = ownFrom\(id, c\.list, meta\);[^\n]*\n\s*if \(k0 < 0\) return null;/); // timeFetchFrom
  assert.match(src, /if \(at > 0 && !\(at < born\) && !\(!born && execFromOlder\(id, x, fborn \|\| Infinity\)\)\) list\.push\(/); // loadCalls
  assert.match(src, /noteExecs\(id, c\.list\)/); // fetchCost 登记 executionId
  assert.match(src, /noteExecs\(id, c\.gens\)/); // loadConv0 登记 executionId
  assert.match(src, /const BOOK_V = 3;/);
  assert.match(read('inject.mjs'), /const COST_BOOK_V = 3;/);
});
