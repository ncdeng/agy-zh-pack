// inject.mjs 读 agy CLI 对话库（readCliDb）：用 node:sqlite 造一个和真库同样结构的小库，字段按真库的 protobuf 字段号编码
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { cutInject } from './_helpers.mjs';

const code = cutInject('function pbGet(', '// packed') + cutInject('function pbVarints(', 'const dayOf')
  + cutInject('const pbDur =', 'function readCliDb(') + cutInject('function readCliDb(', '// 同一次调用') + cutInject('const cliCallKey =', 'const dayMs');
const { readCliDb, cliCallKey, pbGet, pbVarints } = new Function(code + '\nreturn { readCliDb, cliCallKey, pbGet, pbVarints };')();

// 最小的 protobuf 编码：varint 字段、长度型字段（Buffer / 字符串）、packed varint
const varint = (n) => { const b = []; do { let c = n % 128; n = Math.floor(n / 128); if (n) c |= 0x80; b.push(c); } while (n); return Buffer.from(b); };
const fv = (f, n) => Buffer.concat([varint(f * 8), varint(n)]);
const fb = (f, v) => { const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8'); return Buffer.concat([varint(f * 8 + 2), varint(b.length), b]); };
const packed = (f, list) => fb(f, Buffer.concat(list.map(varint)));
const dur = (sec) => Buffer.concat([fv(1, Math.floor(sec)), fv(2, Math.round((sec % 1) * 1e9))]);

test('protobuf 读取：varint、长度型、packed、多字节 varint', () => {
  const m = Buffer.concat([fv(1, 300), fb(2, 'abc'), packed(3, [1, 200, 70000])]);
  assert.equal(pbGet(m, 1), 300);
  assert.equal(pbGet(m, 2).toString(), 'abc');
  assert.deepEqual(pbVarints(pbGet(m, 3)), [1, 200, 70000]);
  assert.equal(pbGet(m, 9), undefined);
});

test('读 CLI 对话库：按步骤找时间、按 executionId 兜底、跳过没有用量的、去重键', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agycli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '00000000-0000-0000-0000-000000000001.db');
  const db = new DatabaseSync(file);
  db.exec('create table steps (idx integer, metadata blob); create table gen_metadata (data blob);');
  const t1 = 1795500000, t2 = 1795500600; // 秒
  const step = (idx, sec, exec) => db.prepare('insert into steps values (?, ?)').run(idx, Buffer.concat([fb(1, fv(1, sec)), fb(12, exec)]));
  step(1, t1, 'exec-a');
  step(2, t1 + 30, 'exec-a');
  step(5, t2, 'exec-b');
  const usage = ({ inp = 0, out = 0, cw = 0, cr = 0, think = 0, vis = 0, rid }) => Buffer.concat([fv(2, inp), fv(3, out), fv(4, cw), fv(5, cr), fv(9, think), fv(10, vis), ...(rid ? [fb(11, rid)] : [])]);
  const gen = (cm, steps, exec) => db.prepare('insert into gen_metadata values (?)').run(Buffer.concat([fb(1, cm), ...(steps ? [packed(2, steps)] : []), fb(4, exec)]));
  // 1. 步骤 2 有时间；输出取 max(字段 3, 思考 + 可见)
  gen(Buffer.concat([fb(4, usage({ inp: 1000, out: 50, cr: 9000, think: 40, vis: 30, rid: 'req-1' })), fb(11, dur(1.25)), fb(12, dur(8.5)), fb(19, 'gemini-4-neon'), fb(21, 'Gemini 4 Neon')]), [2], 'exec-a');
  // 2. 步骤 99 不存在：用 exec-b 第一个步骤的时间；没有请求 ID
  gen(Buffer.concat([fb(4, usage({ inp: 500, out: 20, cw: 100 })), fb(19, 'claude-opus-5-5')]), [99], 'exec-b');
  // 3. 没有任何用量：跳过
  gen(Buffer.concat([fb(4, usage({})), fb(19, 'gemini-4-neon')]), [1], 'exec-a');
  // 4. 找不到时间（步骤和 executionId 都对不上）：跳过
  gen(Buffer.concat([fb(4, usage({ inp: 1 })), fb(19, 'gemini-4-neon')]), [77], 'exec-z');
  db.close();

  const calls = readCliDb(DatabaseSync, file);
  assert.equal(calls.length, 2);
  const [a, b] = calls;
  // [时间, 模型名, 输入, 缓存读, 缓存写, 输出, 首字秒, 生成秒, 界面名, 请求 ID]
  assert.deepEqual(a, [(t1 + 30) * 1000, 'gemini-4-neon', 1000, 9000, 0, 70, 1.25, 8.5, 'Gemini 4 Neon', 'req-1']);
  assert.deepEqual(b, [t2 * 1000, 'claude-opus-5-5', 500, 0, 100, 20, 0, 0, '', '']);
  assert.equal(cliCallKey('conv1', a), 'req-1', '有请求 ID 时按请求 ID 去重');
  assert.equal(cliCallKey('conv1', b), `conv1:${t2 * 1000}:500:20`, '没有请求 ID 时用 对话 + 时间 + token 数');
});
