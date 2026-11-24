// inject.mjs 的 writeFileSafe / readJsonKeep：先写临时文件再改名；读不出来的文件改名留底，不被新数据覆盖
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cutInject } from './_helpers.mjs';

const code = cutInject('function writeFileSafe(', '// ---------- 单实例');
const logs = [];
const { writeFileSafe, readJsonKeep } = new Function('fs', 'path', 'log', code + '\nreturn { writeFileSafe, readJsonKeep };')(fs, path, (m) => logs.push(m));

test('写、读、BOM、坏文件留底', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agyio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'usage-history.json');
  assert.equal(readJsonKeep(f), null, '没有文件 → null');
  writeFileSafe(f, JSON.stringify({ x: 1 }));
  assert.equal(readJsonKeep(f).x, 1);
  assert.deepEqual(fs.readdirSync(dir), ['usage-history.json'], '没有留下临时文件');
  fs.writeFileSync(f, '\uFEFF{"y":2}');
  assert.equal(readJsonKeep(f).y, 2, '带 BOM 的能读');
  fs.writeFileSync(f, '{"days":{"2026-11-2');
  assert.equal(readJsonKeep(f), null, '坏文件 → null');
  const names = fs.readdirSync(dir);
  assert.ok(!names.includes('usage-history.json'), '坏文件被改名');
  assert.ok(names.some((n) => /^usage-history\.bad-\d{12}\.json$/.test(n)), '留底的名字：' + names.join(','));
  assert.ok(logs.some((l) => /unreadable/.test(l)), '记了日志');
  writeFileSafe(f, '{"z":3}');
  assert.equal(readJsonKeep(f).z, 3);
  assert.equal(fs.readdirSync(dir).length, 2, '之后照常写新文件，留底的还在');
});
