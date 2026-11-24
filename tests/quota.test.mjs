// lib/quota.mjs：每周额度按周期分段、提前重置事件、周期记录、用细粒度采样回放（合成场景，按 2026-11-24 两台电脑的真实读数改写）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, near, T, H, D } from './_helpers.mjs';

const { noteQuota, noteResetEvent, noteCycleEnd, replayFromSamples, QUOTA_SEGS } = await import(pathToFileURL(path.join(ROOT, 'lib/quota.mjs')).href);

test('读数来回跳（新旧两个周期轮流出现）：u 按两段相加，只记 1 条提前重置', () => {
  const qs = {}, ev = [];
  const prev = { r: T('2026-11-29T09:41:21'), l: 0.0721, s: 0.0423, c: 0, u: 0.0298, m: 0.0799, w: 'weekly', n: 'G' };
  const step = (at, used, reset) => noteQuota(qs, [{ id: 'gemini-weekly', name: 'G', w: 'weekly', used, reset }], () => prev, T(at),
    (b, e) => noteResetEvent(ev, 'k', b, T(at), e));
  step('2026-11-24T00:12:14', 0.0721, T('2026-11-29T09:41:21'));
  step('2026-11-24T04:05:39', 0.0778, T('2026-11-29T09:41:21'));
  step('2026-11-24T04:08:30', 0, T('2026-12-01T04:05:33'));
  step('2026-11-24T04:14:12', 0.0849, T('2026-11-29T09:41:21'));
  step('2026-11-24T04:19:54', 0, T('2026-12-01T04:16:57'));
  for (let t = T('2026-11-24T04:23:00'); t < T('2026-11-24T09:31:00'); t += 171e3) step(new Date(t).toISOString(), 0, t + 7 * D); // 没用：重置时间跟着走
  step('2026-11-24T09:34:00', 0.005, T('2026-12-01T09:31:25'));
  step('2026-11-24T11:42:28', 0.0271, T('2026-12-01T09:31:25'));
  step('2026-11-24T11:45:19', 0.0141, T('2026-12-01T09:31:25'));
  step('2026-11-24T17:06:04', 0.0607, T('2026-12-01T09:31:25'));
  const q = qs['gemini-weekly'];
  assert.ok(near(q.u, 0.0735), `u = ${q.u}，应为 0.0735（旧周期 7.21% → 8.49%，加新周期 0 → 6.07%）`);
  assert.equal(ev.length, 1);
  assert.ok(near(ev[0].from, 0.0849));
  assert.equal(ev[0].flips, 1);
  assert.equal(ev[0].at, T('2026-11-24T04:08:30'));
  assert.equal(ev[0].after, T('2026-11-24T04:05:39'));
  assert.equal(ev[0].was, T('2026-11-29T09:41:21'));
});

test('自然到期（原定重置时间已过）不算提前重置', () => {
  const qs = {}, ev = [];
  const step = (at, used, reset) => noteQuota(qs, [{ id: 'gemini-weekly', name: 'G', w: 'weekly', used, reset }], () => null, T(at),
    (b, e) => noteResetEvent(ev, 'k', b, T(at), e));
  step('2026-11-29T09:30:00', 0.40, T('2026-11-29T09:41:21'));
  step('2026-11-29T09:43:00', 0.0, T('2026-12-06T09:43:00'));
  step('2026-11-29T10:00:00', 0.01, T('2026-12-06T09:58:00'));
  assert.equal(ev.length, 0);
  assert.ok(near(qs['gemini-weekly'].u, 0.01), `u = ${qs['gemini-weekly'].u}`);
});

test('没用过的额度，重置时间跟着往后走：不算提前重置', () => {
  const qs = {}, ev = [];
  const step = (at, used, reset) => noteQuota(qs, [{ id: '3p-weekly', name: 'C', w: 'weekly', used, reset }], () => null, T(at),
    (b, e) => noteResetEvent(ev, 'k', b, T(at), e));
  step('2026-11-24T08:00:00', 0, T('2026-12-01T08:00:00'));
  step('2026-11-24T13:00:00', 0, T('2026-12-01T13:00:00'));
  assert.equal(ev.length, 0);
});

test('跨天：前一天用过、原定时间没到，今天第一笔读数已经是新周期 → 提前重置', () => {
  const qs = {}, ev = [];
  const prev = { r: T('2026-11-29T00:54:11'), l: 0.1754, t: T('2026-11-23T23:58:00'), w: 'weekly', n: 'G' };
  noteQuota(qs, [{ id: 'gemini-weekly', name: 'G', w: 'weekly', used: 0, reset: T('2026-12-01T08:55:45') }], () => prev, T('2026-11-24T09:00:00'),
    (b, e) => noteResetEvent(ev, 'k', b, T('2026-11-24T09:00:00'), e));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].after, prev.t);
  assert.ok(near(ev[0].from, 0.1754));
  assert.equal(qs['gemini-weekly'].s, 0);
});

test('5 小时额度一天换很多次周期：段数封顶，u 不丢', () => {
  const qs = {};
  let expect = 0;
  for (let i = 0; i < 12; i++) {
    const r = T('2026-11-24T05:00:00') + i * 5 * H;
    noteQuota(qs, [{ id: 'gemini-5h', name: 'G', w: '5h', used: 0.1, reset: r }], () => null, r - 4 * H);
    noteQuota(qs, [{ id: 'gemini-5h', name: 'G', w: '5h', used: 0.3, reset: r }], () => null, r - 1 * H);
    expect += i === 0 ? 0.2 : 0.3; // 第一次见到时起点是当时的值 0.1
  }
  const q = qs['gemini-5h'];
  assert.ok(q.p.length <= QUOTA_SEGS, `段数 ${q.p.length}`);
  assert.ok(near(q.u, expect, 1e-3), `u = ${q.u}，应为 ${expect.toFixed(4)}`);
});

test('v3 的旧记录（只有 c、没有分段）接着用', () => {
  const qs = { 'gemini-weekly': { n: 'G', w: 'weekly', l: 0.0607, m: 0.0922, r: T('2026-12-01T09:31:25'), s: 0, c: 0.0906, u: 0.1513 } };
  noteQuota(qs, [{ id: 'gemini-weekly', name: 'G', w: 'weekly', used: 0.0610, reset: T('2026-12-01T09:31:25') }], () => null, T('2026-11-24T17:10:00'));
  assert.ok(near(qs['gemini-weekly'].u, 0.1516), `u = ${qs['gemini-weekly'].u}`);
  assert.equal(qs['gemini-weekly'].c0, 0.0906);
});

test('周期记录：来回跳只记 1 个周期，起止时间和用量正确', () => {
  const qs = {}, cyc = [];
  const prev = { r: T('2026-11-29T09:41:21'), l: 0.0721, w: 'weekly' };
  const st = (at, u, r) => noteQuota(qs, [{ id: 'gemini-weekly', name: 'G', w: 'weekly', used: u, reset: r }], () => prev, T(at),
    (b, ev) => noteCycleEnd(cyc, 'k', b, T(at), ev));
  st('2026-11-24T00:12:00', 0.0721, T('2026-11-29T09:41:21'));
  st('2026-11-24T04:05:39', 0.0778, T('2026-11-29T09:41:21'));
  st('2026-11-24T04:08:30', 0, T('2026-12-01T04:05:33'));
  st('2026-11-24T04:14:12', 0.0849, T('2026-11-29T09:41:21'));
  st('2026-11-24T04:19:54', 0, T('2026-12-01T04:16:57'));
  assert.equal(cyc.length, 1);
  assert.equal(cyc[0].early, true);
  assert.equal(cyc[0].used, 0.0849);
  assert.equal(cyc[0].start, T('2026-11-22T09:41:21'));
  assert.equal(cyc[0].end, T('2026-11-24T04:08:30'));
});

test('周期记录：自然到期时结束时间是原定的重置时间', () => {
  const qs = {}, cyc = [];
  const st = (at, u, r) => noteQuota(qs, [{ id: '3p-weekly', name: 'C', w: 'weekly', used: u, reset: r }], () => null, T(at),
    (b, ev) => noteCycleEnd(cyc, 'k', b, T(at), ev));
  st('2026-11-29T21:00:00', 0.30, T('2026-11-29T21:56:24'));
  st('2026-11-29T22:10:00', 0, T('2026-12-06T22:10:00'));
  assert.equal(cyc.length, 1);
  assert.equal(cyc[0].early, false);
  assert.equal(cyc[0].end, T('2026-11-29T21:56:24'));
  assert.equal(cyc[0].used, 0.3);
});

test('周期记录：没用过的周期和 5 小时额度都不记', () => {
  const qs = {}, cyc = [];
  const st = (at, id, w, u, r) => noteQuota(qs, [{ id, name: 'X', w, used: u, reset: r }], () => null, T(at),
    (b, ev) => noteCycleEnd(cyc, 'k', b, T(at), ev));
  st('2026-11-24T08:00:00', '3p-weekly', 'weekly', 0, T('2026-12-01T08:00:00'));
  st('2026-11-24T13:00:00', '3p-weekly', 'weekly', 0, T('2026-12-01T13:00:00'));
  st('2026-11-24T08:00:00', 'g-5h', '5h', 0.2, T('2026-11-24T10:00:00'));
  st('2026-11-24T11:00:00', 'g-5h', '5h', 0.01, T('2026-11-24T16:00:00'));
  assert.equal(cyc.length, 0);
});

test('用采样回放：改正当天的记录、记下提前重置；再回放一次没有变化、事件不重复', () => {
  const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dayStart = (day) => new Date(day + 'T00:00:00').getTime();
  const R1 = T('2026-11-29T09:00:00'), R2 = T('2026-12-01T08:00:00');
  // 当天的记录是旧算法算的（u 偏大），采样从 00:05 开始，覆盖了当天开头
  const days = { '2026-11-24': { qa: { k: { 'gemini-weekly': { n: 'G', w: 'weekly', l: 0.02, m: 0.15, r: R2, s: 0.10, c: 0, u: 0.12 } } } } };
  const samples = { k: [
    [T('2026-11-24T00:05:00'), 'gemini-weekly', 0.10, R1],
    [T('2026-11-24T06:00:00'), 'gemini-weekly', 0.15, R1],
    [T('2026-11-24T08:00:00'), 'gemini-weekly', 0, R2], // 提前重置：原定 11-29，还没到
    [T('2026-11-24T10:00:00'), 'gemini-weekly', 0.02, R2],
  ] };
  const events = [];
  const onEvent = (key, b, at, ev) => noteResetEvent(events, key, b, at, ev);
  const ch = replayFromSamples(days, samples, () => null, dayOf, dayStart, onEvent);
  const q = days['2026-11-24'].qa.k['gemini-weekly'];
  assert.equal(ch.length, 1, ch.join(' | '));
  assert.ok(near(q.u, 0.07), `u = ${q.u}，应为 0.07（旧周期 10% → 15%，加新周期 0 → 2%）`);
  assert.equal(q.n, 'G');
  assert.ok(near(q.m, 0.15), '最大值保留旧记录里较大的那个');
  assert.equal(events.length, 1);
  assert.ok(near(events[0].from, 0.15));
  const ch2 = replayFromSamples(days, samples, () => null, dayOf, dayStart, onEvent);
  assert.equal(ch2.length, 0);
  assert.equal(events.length, 1);
});

test('那天开头没有采样：不回放', () => {
  const days = { '2026-11-24': { qa: { k: { 'gemini-weekly': { n: 'G', w: 'weekly', u: 0.5 } } } } };
  const samples = { k: [[T('2026-11-24T12:00:00'), 'gemini-weekly', 0.10, T('2026-11-29T09:00:00')]] };
  const ch = replayFromSamples(days, samples, () => null, (ms) => '2026-11-24', () => T('2026-11-24T00:00:00'));
  assert.equal(ch.length, 0);
  assert.equal(days['2026-11-24'].qa.k['gemini-weekly'].u, 0.5);
});
