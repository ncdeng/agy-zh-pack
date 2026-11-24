// 推到 main 的数据文件：词典、规则、价格表、最新版本号。插件在线更新时会用 inject.mjs 的校验函数检查，
// 校验不过的文件插件不用；这里用同样的函数先查一遍，免得推上去才发现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, cutInject } from './_helpers.mjs';

const dict = readJson('i18n/zh-CN.json');
const rules = readJson('i18n/zh-CN.rules.json');
const code = cutInject('const isObj =', 'const REMOTE_CHECK');
const check = new Function('assets', code + '\nreturn { checkDict, checkRules, checkPrices, checkMeta };')({ dict, rules });

test('词典：键和译文都是非空字符串，插件的校验能通过', () => {
  for (const [k, v] of Object.entries(dict)) {
    assert.ok(k.trim() && k === k.trim(), `键要去掉首尾空白：${JSON.stringify(k)}`);
    assert.equal(typeof v, 'string', `译文不是字符串：${k}`);
    assert.ok(v.length > 0, `译文是空的：${k}`);
  }
  assert.equal(Object.keys(check.checkDict(dict)).length, Object.keys(dict).length, '校验时有条目被丢掉了（键或译文太长）');
});

test('规则：每条都是 [正则, 替换]，正则能编译，插件的校验能通过', () => {
  for (const r of rules) {
    assert.ok(Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'string', JSON.stringify(r));
    assert.doesNotThrow(() => new RegExp(r[0]), r[0]);
    assert.ok(r[0].startsWith('^') && r[0].endsWith('$'), `规则要整段匹配（以 ^ 开头、$ 结尾）：${r[0]}`);
  }
  assert.equal(check.checkRules(rules).length, rules.length);
  assert.equal(new Set(rules.map((r) => r[0])).size, rules.length, '有重复的规则');
});

test('价格表和最新版本号：插件的校验能通过', () => {
  const p = check.checkPrices(readJson('data/prices.json'));
  assert.ok(Object.keys(p.models).length >= 3);
  const meta = check.checkMeta(readJson('data/meta.json'));
  assert.match(meta.latest, /^\d+\.\d+\.\d+$/);
});
