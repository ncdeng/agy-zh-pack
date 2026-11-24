// 额度记录：每天每个额度桶用掉了多少、谷歌提前重置额度的事件（2026-11-24 从 inject.mjs 拆出来，方便单独测试）。
// 这里只有纯函数，不读写文件；读写 usage-history.json / quota-samples.json 在 inject.mjs。
//
// 一个桶在某一天的额度记录（比例都是 0～1）：
//   n 组名、w 窗口（weekly / 5h）、r 当前周期的重置时间（毫秒）、s 当前这一段开始时的已用比例、l 最近一次读数、
//   m 当天最高、t 最近一次读数的时间（毫秒，v4 起才有）、
//   p 当天已经结束的几段 [[重置时间, 开始时的已用比例, 最后的已用比例], …]（v4 起；最多 QUOTA_SEGS 段，更早的折进 c0）、
//   c 已经结束的各段合计（= c0 + 各段的净变化）、u 当天用掉的 = c + max(0, l − s)。
// 按净变化算（2026-11-22）：同一个周期里已用比例会来回起伏，实测 6 分钟里 Gemini 每周额度 1.699% → 1.594%。
// 换周期：重置时间前后差 1 小时以上。没用过的桶重置时间是“现在 + 7 天 / 5 小时”，跟着时间走，每次读数只差几分钟，算同一个周期。
// 分段（v4，2026-11-24）：谷歌 11-24 提前重置 Gemini 每周额度时，Windows 上实测读数来回跳了一次：
//   04:05 旧周期 7.78% → 04:08 归零（新重置时间 12-01）→ 04:14 又读到旧周期 8.49% 和旧重置时间 → 04:19 再归零。
//   v3 把每次换重置时间都当成“新周期从 0 起”，04:14 那次把旧周期的 7.21% 起点当成 0，多算了 7.78 个百分点
//   （当天记成 15.13%，实际约 7.35%）。v4 记住当天已经结束的几段，读数跳回其中一段时接着那一段算。
export const r4 = (x) => Math.round(x * 1e4) / 1e4;
export const samePeriod = (r1, r2) => Math.abs((+r1 || 0) - (+r2 || 0)) < 3600e3;
export const QUOTA_SEGS = 8;
const segUse = (x) => Math.max(0, (+x[2] || 0) - (+x[1] || 0));
const segSum = (q) => (+q.c0 || 0) + (Array.isArray(q.p) ? q.p.reduce((t, x) => t + segUse(x), 0) : 0);
// 提前重置：换了周期，而且旧周期的重置时间还没到（还差 1 小时以上），旧周期也用过（没用过的桶重置时间跟着现在走，不算）
const isEarly = (oldReset, oldUsed, at) => (+oldUsed || 0) > 0 && (+oldReset || 0) - at > 3600e3;

// qs：某一天、某个账号的 { 桶 ID: 额度记录 }；buckets：[{ id, name, w, used, reset }]；
// prev(id)：这个桶在今天以前最近的一条记录；at：这次读数的时间（毫秒，回放采样时是采样时间）；
// onReset(b, ev)：看到换周期时调用。ev = { was 旧重置时间, from 旧周期最后的已用比例, after 最后一次看到旧周期的时间, early 是不是提前重置,
//   back 是不是读数跳回了已经结束的一段（这时 was / from 是被换下来的那一段）}。
export function noteQuota(qs, buckets, prev, at, onReset) {
  at = +at || Date.now();
  for (const b of buckets) {
    let q = qs[b.id];
    if (!q) {
      const p = prev(b.id);
      let s = b.used;
      if (p) {
        const back = samePeriod(p.r, b.reset) ? null : (Array.isArray(p.p) ? p.p : []).find((x) => samePeriod(x[0], b.reset));
        if (samePeriod(p.r, b.reset)) s = +p.l || 0; // 还在同一个周期：接着前一天最后的值算（中间没观察到的部分算到今天）
        else if (back) s = +back[2] || 0; // 前一天最后正好停在跳回去的状态
        else {
          s = 0; // 周期换了：从 0 算
          if (onReset) onReset(b, { was: +p.r, from: +p.l || 0, after: +p.t || 0, early: isEarly(p.r, p.l, at), back: false });
        }
      }
      q = qs[b.id] = { n: b.name, w: b.w, l: r4(b.used), m: r4(b.used), r: b.reset, s: r4(s), c: 0, p: [] };
    } else {
      if (q.s === undefined) { q.s = r4(Math.max(0, (+q.l || 0) - (+q.u || 0))); q.c = 0; } // 迁移漏掉的旧记录：保持原来的 u
      if (!Array.isArray(q.p)) { q.p = []; q.c0 = r4(+q.c || 0); } // v3 的记录：已经结算的部分整个当成 c0
      if (!samePeriod(q.r, b.reset)) {
        const cur = [q.r, +q.s || 0, +q.l || 0];
        const i = q.p.findIndex((x) => samePeriod(x[0], b.reset));
        if (i >= 0) { // 跳回当天已经结束的一段：接着那一段算，换下来的这段留着
          const back = q.p.splice(i, 1)[0];
          q.p.push(cur);
          q.s = +back[1] || 0;
          if (onReset) onReset(b, { was: cur[0], from: cur[2], after: +q.t || 0, early: false, back: true });
        } else { // 新周期：从 0 起
          q.p.push(cur);
          q.s = 0;
          if (onReset) onReset(b, { was: cur[0], from: cur[2], after: +q.t || 0, early: isEarly(cur[0], cur[2], at), back: false });
        }
        while (q.p.length > QUOTA_SEGS) q.c0 = r4((+q.c0 || 0) + segUse(q.p.shift()));
      }
    }
    q.l = r4(b.used);
    q.c = r4(segSum(q));
    q.u = r4(q.c + Math.max(0, q.l - (+q.s || 0)));
    q.m = r4(Math.max(+q.m || 0, b.used));
    q.r = b.reset;
    q.t = at;
    if (b.name) q.n = b.name;
    if (b.w) q.w = b.w;
  }
}

// ---------- 提前重置的事件 ----------
// list：[{ k 账号键, id 桶 ID, n 组名, w 窗口, at 看到重置的时间, after 最后一次看到旧周期的时间（0 = 不知道）,
//   from 重置前的已用比例, was 原定的重置时间, flips 读数来回跳了几次 }]（毫秒、比例 0～1）。
// 只记每周额度（5 小时额度一天本来就换好几次，提前重置看不出来，也没人关心）。
// 读数来回跳（谷歌那边一时没生效完）：同一个旧周期只记一条；跳回去又换下来时，把那段最后的已用比例补进 from（取较大的）。
export function noteResetEvent(list, key, b, at, ev) {
  if (b.w !== 'weekly') return null;
  const old = list.find((e) => e.k === key && e.id === b.id && samePeriod(e.was, ev.was));
  if (old) {
    if (ev.back) { old.from = r4(Math.max(+old.from || 0, +ev.from || 0)); old.flips = (+old.flips || 0) + 1; }
    return null;
  }
  if (ev.back || !ev.early) return null;
  const e = { k: key, id: b.id, n: b.name || '', w: b.w, at, after: +ev.after || 0, from: r4(+ev.from || 0), was: +ev.was };
  list.push(e);
  return e;
}

// ---------- 每周额度的周期记录（2026-11-24 加） ----------
// 每次换周期（自然到期或提前重置）记一条：{ k 账号键, id 桶 ID, n 组名, start 周期开始（原定重置时间 − 7 天）,
//   end 周期结束（提前重置 = 看到重置的时间；自然到期 = 原定重置时间）, used 结束前最后的已用比例, early 是不是提前重置 }。
// 面板按 start～end 之间这台电脑的花费 ÷ used 推出那个周期的 cap，攒几个周期就能看出额度有没有变。
// 只记用过的周期（used > 0）；读数来回跳时同一个周期只记一条，跳回去又换下来时 used 取较大的。
const WEEK_MS = 7 * 86400e3;
export function noteCycleEnd(list, key, b, at, ev) {
  if (b.w !== 'weekly' || !(+ev.was > 0)) return null;
  const old = list.find((e) => e.k === key && e.id === b.id && samePeriod(e.start + WEEK_MS, ev.was));
  if (old) {
    if (ev.back) old.used = r4(Math.max(+old.used || 0, +ev.from || 0));
    return null;
  }
  if (ev.back || !(+ev.from > 0)) return null;
  const e = { k: key, id: b.id, n: b.name || '', start: +ev.was - WEEK_MS, end: ev.early ? at : Math.min(+ev.was, at), used: r4(+ev.from), early: !!ev.early };
  list.push(e);
  return e;
}

// ---------- 用细粒度采样回放额度记录（v4 上线时跑一次） ----------
// samples：{ 账号键: [[时间, 桶 ID, 已用比例, 重置时间], …] }（只有每周额度，见 inject.mjs 的 noteSamples）。
// 对采样覆盖了一整天的日子（这个账号最早的一笔采样不晚于那天 0 点 + 1 小时），按 v4 的算法重算那天的每周额度记录，
// 顺带补出那天的提前重置事件。采样和实时记录是同一次查询记下的，回放出来的就是 v4 当时实时会记的数。
// days：usage-history.json 的 days；prevOf(day, key, id)：那天以前最近的一条记录（按日子从早到晚回放，后一天会用到前一天重算后的记录）；
// dayOf(ms)：本地日期 'YYYY-MM-DD'；dayStart(day)：那天本地 0 点的毫秒。返回改动清单。
export function replayFromSamples(days, samples, prevOf, dayOf, dayStart, onEvent) {
  const changes = [];
  for (const [key, list] of Object.entries(samples || {})) {
    if (!Array.isArray(list) || !list.length) continue;
    const firstAt = list[0][0];
    const byDay = new Map(); // 日子 → Map(时间 → [[桶 ID, 已用比例, 重置时间]])
    for (const x of list) {
      if (!Array.isArray(x) || x.length < 4) continue;
      const d = dayOf(x[0]);
      if (!byDay.has(d)) byDay.set(d, new Map());
      const m = byDay.get(d);
      if (!m.has(x[0])) m.set(x[0], []);
      m.get(x[0]).push([x[1], x[2], x[3]]);
    }
    for (const day of [...byDay.keys()].sort()) {
      if (firstAt > dayStart(day) + 3600e3) continue; // 那天开头没有采样：不重算
      const rec = days[day] && days[day].qa && days[day].qa[key];
      if (!rec) continue;
      const qs = {};
      for (const [at, items] of [...byDay.get(day)].sort((a, b) => a[0] - b[0])) {
        const buckets = items.map(([id, used, reset]) => ({ id, name: (rec[id] && rec[id].n) || '', w: 'weekly', used, reset }));
        noteQuota(qs, buckets, (id) => prevOf(day, key, id), at, (b, ev) => onEvent && onEvent(key, b, at, ev));
      }
      for (const [id, q] of Object.entries(qs)) {
        const old = rec[id];
        if (old) { q.m = r4(Math.max(q.m, +old.m || 0)); if (old.n) q.n = old.n; }
        if (!old || Math.abs((+old.u || 0) - q.u) >= 1e-4) changes.push(`${day} ${id} ${old ? old.u : '-'} -> ${q.u}`);
        rec[id] = q;
      }
    }
  }
  return changes;
}
