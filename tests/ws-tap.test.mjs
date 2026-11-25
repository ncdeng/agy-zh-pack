// statusbar.js 的 WebSocket 旁听（Antigravity 2.35 起页面经 /connect-websocket 访问本机后台）：
// 从 start 帧记方法名和令牌、只解析要旁听的流、热更新前就开着的流看形状认、令牌退回 localStorage
import test from 'node:test';
import assert from 'node:assert/strict';
import { cut } from './_helpers.mjs';

const code = cut('statusbar.js', '// ---------- 2.35 起：应用经 WebSocket 访问后台', '// 额度（5 小时、每周）');
const ORIGIN = 'https://127.0.0.1:62832';
const SVC = 'exa.language_server_pb.LanguageServerService';

// 每个测试一套新的环境：假的 S、location、localStorage、window、setTimeout
function setup({ storage = {}, appToken } = {}) {
  const got = [], timers = [];
  const S = { onMessage: (name, p) => got.push([name, p]), fetchQuota: () => {} };
  const env = {
    location: { origin: ORIGIN },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null) },
    window: { __APP_CONFIG__: { csrfToken: appToken } },
    setTimeout: (f, ms) => timers.push(ms),
  };
  const fns = new Function('S', 'location', 'localStorage', 'window', 'setTimeout', code + '\nreturn { lsFromStorage };')(
    S, env.location, env.localStorage, env.window, env.setTimeout);
  return { S, got, timers, ...fns };
}
// 假的 WebSocket 连接：只记 message 监听
const sock = (url = 'wss://127.0.0.1:62832/connect-websocket') => {
  const ls = [];
  return { url, ls, addEventListener: (t, f) => { if (t === 'message') ls.push(f); }, recv(s) { for (const f of ls) f({ data: s }); } };
};
const start = (sid, method, headers = {}, svc = SVC) =>
  JSON.stringify({ streamId: sid, type: 'start', procedure: `/${svc}/${method}`, stream: false, headers, payload: {} });
const data = (sid, payload) => JSON.stringify({ streamId: sid, type: 'data', payload });
const end = (sid) => JSON.stringify({ streamId: sid, type: 'end', statusCode: 0 });

test('start 帧：记下令牌和 x-host-client，拼成 grpc-web+json 请求头；别的请求头不要；第一次拿到才查额度', () => {
  const { S, timers } = setup();
  const ws = sock();
  S.wsSend(ws, start('a', 'GetUserStatus', { 'Content-Type': ['application/json'], 'x-codeium-csrf-token': ['tok-1'], 'x-host-client': ['h'], 'Connect-Timeout-Ms': ['4000'] }));
  assert.deepEqual(S.lsHeaders, { 'content-type': 'application/grpc-web+json', 'x-grpc-web': '1', 'x-codeium-csrf-token': 'tok-1', 'x-host-client': 'h' });
  assert.equal(S.lsService, ORIGIN + '/' + SVC);
  assert.equal(S.lsFrom, 'ws');
  assert.equal(S.wsProc.get('a'), 'GetUserStatus');
  assert.equal(timers.length, 1);
  S.wsSend(ws, start('b', 'RecordAnalyticsEvent', { 'x-codeium-csrf-token': ['tok-2'] }));
  assert.equal(S.lsHeaders['x-codeium-csrf-token'], 'tok-2'); // 令牌换了就跟着换
  assert.equal(timers.length, 1);
});

test('别的服务、没有令牌的 start 帧不改请求头；别的 WebSocket 和非文本帧不旁听；同一条连接只挂一次监听', () => {
  const { S } = setup();
  const ws = sock();
  S.wsSend(ws, start('a', 'Update', { 'x-codeium-csrf-token': ['t'] }, 'exa.actuator_pb.ActuatorService'));
  S.wsSend(ws, start('b', 'GetUserStatus', {}));
  assert.equal(S.lsHeaders, undefined);
  S.wsSend(ws, JSON.stringify({ streamId: 'a', type: 'ping' }));
  assert.equal(ws.ls.length, 1);
  const other = sock('wss://example.test/voice');
  S.wsSend(other, start('c', 'GetUserStatus', { 'x-codeium-csrf-token': ['t'] }));
  assert.equal(other.ls.length, 0);
  assert.equal(S.wsProc.has('c'), false);
  const bin = sock();
  S.wsSend(bin, new Uint8Array(4));
  assert.equal(bin.ls.length, 0);
});

test('收到的帧：要旁听的流交给 S.onMessage，别的流不解析，end 帧删掉记录', () => {
  const { S, got } = setup();
  const ws = sock();
  S.wsSend(ws, start('q', 'RetrieveUserQuotaSummary', { 'x-codeium-csrf-token': ['t'] }));
  S.wsSend(ws, start('m', 'GetMendelFlags', { 'x-codeium-csrf-token': ['t'] }));
  ws.recv(data('q', { response: { groups: [] } }));
  ws.recv('{"streamId":"m","type":"data","payload":{不是 JSON'); // 不旁听的流：只看开头，不解析，也不报错
  ws.recv(end('q'));
  ws.recv(JSON.stringify({ streamId: 'q', type: 'pong' }));
  assert.deepEqual(got, [['RetrieveUserQuotaSummary', { response: { groups: [] } }]]);
  assert.equal(S.wsProc.has('q'), false);
  assert.equal(S.wsProc.get('m'), 'GetMendelFlags');
});

test('热更新前就开着的流：带 update.conversationId 的认成状态流，别的记成 ? 以后不再解析，空 payload 先不认', () => {
  const { S, got } = setup();
  const ws = sock();
  S.wsSend(ws, JSON.stringify({ streamId: 'x', type: 'ping' })); // 应用发了一帧，连接才挂上监听
  ws.recv(data('old', {}));
  assert.equal(S.wsProc.has('old'), false);
  ws.recv(data('old', { update: { conversationId: 'c1', status: 'CASCADE_RUN_STATUS_RUNNING' } }));
  ws.recv(data('side', { sidecars: [1] }));
  ws.recv(data('side', { update: { conversationId: 'c2' } })); // 已经记成 ?，不再看
  assert.equal(S.wsProc.get('old'), 'StreamAgentStateUpdates');
  assert.equal(S.wsProc.get('side'), '?');
  assert.deepEqual(got.map((g) => g[0] + ':' + g[1].update.conversationId), ['StreamAgentStateUpdates:c1']);
});

test('帧的键顺序变了（payload 在前）：整帧解析，照样处理', () => {
  const { S, got } = setup();
  const ws = sock();
  S.wsSend(ws, start('u', 'GetUserStatus', { 'x-codeium-csrf-token': ['t'] }));
  ws.recv(JSON.stringify({ payload: { userStatus: { name: 'n' } }, type: 'data', streamId: 'u' }));
  ws.recv(JSON.stringify({ statusCode: 0, type: 'end', streamId: 'u' }));
  assert.deepEqual(got, [['GetUserStatus', { userStatus: { name: 'n' } }]]);
  assert.equal(S.wsProc.has('u'), false);
});

test('streamId 记录超过 5000 条时删掉最早的 1000 条', () => {
  const { S } = setup();
  const ws = sock();
  for (let i = 0; i <= 5000; i++) S.wsProc.set('s' + i, 'X');
  S.wsSend(ws, start('new', 'GetUserStatus', { 'x-codeium-csrf-token': ['t'] }));
  assert.equal(S.wsProc.size, 4002);
  assert.equal(S.wsProc.has('s0'), false);
  assert.equal(S.wsProc.has('s1000'), true);
  assert.equal(S.wsProc.get('new'), 'GetUserStatus');
});

test('还没看到应用发请求：先用 localStorage 里的令牌，再退到 __APP_CONFIG__；已经有请求头就不动', () => {
  let e = setup({ storage: { agy_session_csrf_token: 'ls-tok' }, appToken: '' });
  e.lsFromStorage();
  assert.equal(e.S.lsHeaders['x-codeium-csrf-token'], 'ls-tok');
  assert.equal(e.S.lsService, ORIGIN + '/' + SVC);
  assert.equal(e.S.lsFrom, 'storage');
  e.S.wsSend(sock(), start('a', 'GetUserStatus', { 'x-codeium-csrf-token': ['live'] }));
  assert.equal(e.S.lsHeaders['x-codeium-csrf-token'], 'live'); // 看到应用的请求就换成它正在用的
  e.lsFromStorage();
  assert.equal(e.S.lsHeaders['x-codeium-csrf-token'], 'live');

  e = setup({ appToken: 'cfg-tok' });
  e.lsFromStorage();
  assert.equal(e.S.lsHeaders['x-codeium-csrf-token'], 'cfg-tok');

  e = setup({ appToken: '' });
  e.lsFromStorage();
  assert.equal(e.S.lsHeaders, undefined);
});
