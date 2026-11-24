// 缓存没命中多花的钱（statusbar.js 的 missScan）：原因判断、门槛、多花的钱怎么算
import test from 'node:test';
import assert from 'node:assert/strict';
import { cut, near } from './_helpers.mjs';

const missScan = new Function(cut('statusbar.js', 'const MISS_MIN_TOK', '// 原因：面板上的短名') + '\nreturn missScan;')();

// 合成的单价（每百万 token 美元）：Gemini 只有输入 / 缓存读，Claude 还有缓存写
const GEM = { name: 'Carbon', p: { in: 4, cache: 0.4, out: 20 } };
const CLA = { name: 'Opus 5.5', p: { in: 5, cache: 0.5, cw: 6.25, out: 25 } };
const S = 1000;
// 一次调用：at 秒、上下文里的新增输入 / 缓存读 / 缓存写、首字 + 生成秒数、步骤序号
const call = (at, pr, inp, cr, cw = 0, { dur = 0, step = 0 } = {}) => ({ at: at * S, ttft: dur / 2, stream: dur / 2, step, cc: { pr, inp, cr, cw } });

test('缓存接上了：不算没命中', () => {
  const r = missScan([call(0, GEM, 300000, 0), call(20, GEM, 5000, 300000)], { user: [], ckpt: [] });
  assert.deepEqual(r, [null, null]);
});

test('隔了 1 分钟以上：中间有你的消息算 user，没有算 turn，不知道算 wait', () => {
  const list = [call(0, GEM, 300000, 0, 0, { step: 1 }), call(400, GEM, 310000, 0, 0, { step: 5 })];
  const u = missScan(list, { user: [3], ckpt: [] })[1];
  assert.equal(u.cause, 'user');
  assert.equal(u.tok, 300000); // min(上一次 30 万, 这次 31 万) − 缓存读 0
  assert.ok(near(u.usd, 300000 * (4 - 0.4) / 1e6)); // 按全价输入 − 缓存读单价
  assert.equal(u.idle, 400 * S);
  assert.equal(u.from, 'Carbon');
  assert.equal(missScan(list, { user: [], ckpt: [] })[1].cause, 'turn');
  assert.equal(missScan(list, { user: [7], ckpt: [] })[1].cause, 'turn'); // 你的消息在这次调用之后，不算
  assert.equal(missScan(list, null)[1].cause, 'wait');
});

test('间隔从上一次调用结束算：开始隔了 90 秒、上一次生成了 50 秒，只隔 40 秒，算 other', () => {
  const r = missScan([call(0, GEM, 200000, 0, 0, { dur: 50 }), call(90, GEM, 210000, 0)], null);
  assert.equal(r[1].cause, 'other');
  assert.equal(r[1].idle, 40 * S);
});

test('压缩：中间有压缩那一步，或者输入少了 40% 以上', () => {
  const a = missScan([call(0, GEM, 400000, 0, 0, { step: 1 }), call(30, GEM, 380000, 0, 0, { step: 9 })], { user: [], ckpt: [4] });
  assert.equal(a[1].cause, 'compact');
  const b = missScan([call(0, GEM, 400000, 0), call(30, GEM, 100000, 0)], null);
  assert.equal(b[1].cause, 'compact');
  assert.equal(b[1].tok, 100000); // 只算两次都有的那部分
});

test('换了模型：这个模型第一次出现，上一次大调用是别的模型', () => {
  const r = missScan([call(0, GEM, 300000, 0), call(10, CLA, 0, 0, 300000)], { user: [], ckpt: [] });
  assert.equal(r[1].cause, 'model');
  assert.equal(r[1].from, 'Carbon');
  assert.ok(near(r[1].usd, 300000 * (6.25 - 0.5) / 1e6)); // Claude 没命中时写进缓存：按缓存写单价 − 缓存读单价
  // 换回原来的模型：和那个模型自己的上一次比（这里 20 秒内，缓存还在）
  const back = missScan([call(0, GEM, 300000, 0), call(10, CLA, 0, 0, 300000), call(20, GEM, 5000, 300000)], { user: [], ckpt: [] });
  assert.equal(back[2], null);
});

test('漏掉不到 2 万 token 不算；小调用不当作比较的对象', () => {
  assert.equal(missScan([call(0, GEM, 50000, 0), call(10, GEM, 15000, 40000)], null)[1], null); // 漏 1 万
  // 中间夹一次 5000 token 的小调用（比如起标题），后面那次还是和前面的大调用比
  const r = missScan([call(0, GEM, 300000, 0), call(5, GEM, 5000, 0), call(400, GEM, 310000, 0)], null);
  assert.equal(r[1], null);
  assert.equal(r[2].tok, 300000);
  assert.equal(r[2].cause, 'wait');
});

test('没有单价的调用跳过', () => {
  const r = missScan([call(0, GEM, 300000, 0), { at: 10 * S, step: 0, cc: { pr: null, inp: 300000, cr: 0, cw: 0 } }, call(20, GEM, 5000, 300000)], null);
  assert.deepEqual(r, [null, null, null]);
});
