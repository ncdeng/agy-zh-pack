// inject.mjs 的 rebindOnLoad：页面刷新后重新挂 window.__agyZhAsk（2026-11-26）。
// 不开 Runtime 域时，Runtime.addBinding 只挂在当时已有的页面上，刷新后就没了（无头 Edge 实测：刷新前 function，刷新后 undefined；
// 加载完再挂一次，刷新后照样能调、注入程序也收得到）。Antigravity 2.35.2 里注入程序自动刷新刚打开的窗口以后，主窗口就没有这个函数了。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutInject, read } from './_helpers.mjs';

const code = cutInject("const ASK_BINDING = '__agyZhAsk';", 'function connect(');

test('页面加载完（Page.domContentEventFired）重新挂 __agyZhAsk；别的消息不管', async () => {
  const sent = [];
  const send = (method, params) => { sent.push([method, params]); return Promise.resolve({}); };
  const rebindOnLoad = new Function(code + '\nreturn rebindOnLoad;')();
  assert.equal(rebindOnLoad({ method: 'Page.domContentEventFired', params: { timestamp: 1 } }, send), true);
  assert.deepEqual(sent, [['Runtime.addBinding', { name: '__agyZhAsk' }]]);
  assert.equal(rebindOnLoad({ method: 'Page.loadEventFired', params: {} }, send), false);
  assert.equal(rebindOnLoad({ id: 3, result: {} }, send), false);
  assert.equal(sent.length, 1);
  // 挂失败（连接刚断）不抛错
  assert.equal(rebindOnLoad({ method: 'Page.domContentEventFired' }, () => Promise.reject(new Error('closed'))), true);
});

test('主窗口和插件框架的连接都在收到消息时先看要不要重新挂', () => {
  const src = read('inject.mjs').replace(/\r\n/g, '\n');
  const hits = src.match(/if \(rebindOnLoad\(m, send\)\) return;/g) || [];
  assert.equal(hits.length, 2);
  // 两处都在 Page.enable 之后才会收到加载事件：确认两个连接都开了 Page 域
  assert.equal((src.match(/send\('Page\.enable'\)/g) || []).length >= 2, true);
});
