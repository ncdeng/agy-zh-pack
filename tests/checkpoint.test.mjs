// inject.mjs 的 readCheckpoint（压缩查看器）：从对话日志里取最近一次压缩的接续消息，数请求和 artifact，取出摘要
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cutInject } from './_helpers.mjs';

const code = cutInject('function readCheckpoint(', 'const mtimes = {};');
const make = (brain) => new Function('fs', 'path', 'BRAIN_DIR', code + '\nreturn readCheckpoint;')(fs, path, brain);

test('取最近一次压缩：请求数、artifact 数、摘要、日志路径', (t) => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'agyckpt-'));
  t.after(() => fs.rmSync(brain, { recursive: true, force: true }));
  const conv = '00000000-0000-4000-8000-000000000001';
  const dir = path.join(brain, conv, '.system_generated', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const ck = (step, n, sum) => JSON.stringify({ step_index: step, type: 'CHECKPOINT', created_at: '2026-11-24T12:49:27Z',
    content: '# Resuming from a compaction\n\n# User Requests\n' + Array.from({ length: n }, (_, i) => `${i + 1}. request ${i + 1}`).join('\n') +
      '\n<summary>\n' + sum + '\n</summary>\n\n[ARTIFACT: a]\nPath: x\n\n[ARTIFACT: b]\nPath: y\n\n# Conversation Logs\n...' });
  fs.writeFileSync(path.join(dir, 'transcript_full.jsonl'), [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'hi' }),
    ck(212, 2, 'old summary'),
    JSON.stringify({ step_index: 300, type: 'PLANNER_RESPONSE', content: 'x' }),
    ck(702, 3, '1. **Task Overview**\n   - done'),
  ].join('\n') + '\n');
  const o = make(brain)(conv);
  assert.equal(o.n, 2);
  assert.equal(o.step, 702);
  assert.equal(o.requests, 3);
  assert.equal(o.artifacts, 2);
  assert.equal(o.summary, '1. **Task Overview**\n   - done');
  assert.equal(o.log, path.join(dir, 'transcript_full.jsonl'));
});

test('没有日志、没有压缩记录：返回说明', (t) => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'agyckpt-'));
  t.after(() => fs.rmSync(brain, { recursive: true, force: true }));
  const conv = '00000000-0000-4000-8000-000000000002';
  assert.match(make(brain)(conv).err, /没有日志文件/);
  const dir = path.join(brain, conv, '.system_generated', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'hi' }) + '\n');
  assert.match(make(brain)(conv).err, /没有压缩记录/);
});
