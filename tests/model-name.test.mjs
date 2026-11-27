// 状态栏的模型一项（2026-11-27，issue #4）：接口返回的模型名只在和界面名对不上时显示（多半是在灰测新模型），
// 对得上、不比较的模型、还没查到接口名时只在悬停说明里；模型列表里没有的模型照写接口名
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut } from './_helpers.mjs';

const block = cut('statusbar.js', '  // ---------- 模型 ----------', '  // ---------- 一次模型调用');
// 页面里的依赖换成最小的替身：el 返回 { cls, text }，seg 返回 { pieces, tip }
function make({ models = {}, resp = {}, lastResp = {}, cfg = {} } = {}) {
  const S = {
    models: new Map(Object.entries(models).map(([k, label]) => [k, { label }])),
    respModel: new Map(Object.entries(resp)),
    enumResp: new Map(Object.entries(lastResp)),
    execModel: new Map(), enumModel: new Map(Object.entries(cfg)),
    needResp: () => {},
  };
  const el = (tag, cls, text) => ({ cls, text });
  const seg = (k, ic, pieces, tip) => ({ pieces, tip });
  return new Function('S', 'el', 'seg', 'ICON', block + '\nreturn { sameModel, modelSeg };')(S, el, seg, () => '');
}
const md = (key, exec = 'e1') => ({ executionId: exec, modelUsage: { model: key } });
const texts = (s) => s.pieces.map((p) => (typeof p === 'string' ? p : p.text));
const real = (s) => s.pieces.find((p) => typeof p !== 'string');

test('接口名和界面名比较：点号按连字符，Claude 后面带推理强度也算对得上', () => {
  const { sameModel } = make();
  assert.equal(sameModel('Gemini 4 Neon (High)', 'gemini-4-neon'), true);
  assert.equal(sameModel('Gemini 3.8 Flash (High)', 'gemini-3.8-flash'), true);
  assert.equal(sameModel('Gemini 3.5 Flash-Lite', 'gemini-3.5-flash-lite'), true);
  assert.equal(sameModel('Claude Opus 5.5 (High)', 'claude-opus-5-5-high'), true);
  assert.equal(sameModel('Claude Opus 5.5 (Medium)', 'claude-opus-5-5'), true);
  assert.equal(sameModel('Claude Sonnet 4.6 (Thinking)', 'claude-sonnet-4-6-thinking'), true);
  // 本机记录里真的出现过的灰测名
  assert.equal(sameModel('Gemini 3.8 Flash (High)', 'gemini-3.8-flash-n'), false);
  assert.equal(sameModel('Gemini 4 Argon (High)', 'gemini-4-neon'), false);
  assert.equal(sameModel('Claude Opus 5.5 (High)', 'claude-opus-5-6-high'), false);
  assert.equal(sameModel('Claude Opus 5.5 (High)', 'claude-opus-5-5-low'), false); // 推理强度对不上也算
  // 不比较：Orchestrator、GPT-OSS 的接口名是另一套；没有界面名或接口名
  assert.equal(sameModel('Orchestrator (Carbon)', 'gemini-pro-orchestrator'), null);
  assert.equal(sameModel('GPT-OSS 120B (Medium)', 'openai/gpt-oss-120b'), null);
  assert.equal(sameModel('', 'gemini-4-neon'), null);
  assert.equal(sameModel('Gemini 4 Neon (High)', ''), null);
});

test('对得上：状态栏只写界面名和档位，接口名在悬停说明里', () => {
  const { modelSeg } = make({ models: { M532: 'Gemini 4 Neon (High)' }, resp: { e1: { name: 'gemini-4-neon', full: '' } } });
  const s = modelSeg(md('M532'));
  assert.deepEqual(texts(s), ['Gemini 4 Neon', 'High']);
  assert.match(s.tip, /接口返回的模型：gemini-4-neon/);
  assert.doesNotMatch(s.tip, /灰测/);
});

test('对不上：后面用黄字（.odd）写接口名，悬停说明写可能是灰测', () => {
  const { modelSeg } = make({ models: { M318: 'Gemini 3.8 Flash (High)' }, resp: { e1: { name: 'gemini-3.8-flash-n', full: '' } } });
  const s = modelSeg(md('M318'));
  assert.deepEqual(texts(s), ['Gemini 3.8 Flash', 'High', 'gemini-3.8-flash-n']);
  assert.equal(real(s).cls, 'tx real odd');
  assert.match(s.tip, /可能是灰测版本$/);
});

test('这次还没查到、用这个模型上次的接口名：对不上才写（斜体 .prev），说明里注明是上次的', () => {
  let { modelSeg } = make({ models: { M318: 'Gemini 3.8 Flash (High)' }, lastResp: { M318: 'gemini-3.8-flash-n' } });
  let s = modelSeg(md('M318'));
  assert.equal(real(s).cls, 'tx real odd prev');
  assert.match(s.tip, /这是这个模型上次的结果/);
  ({ modelSeg } = make({ models: { M318: 'Gemini 3.8 Flash (High)' }, lastResp: { M318: 'gemini-3.8-flash' } }));
  assert.deepEqual(texts(modelSeg(md('M318'))), ['Gemini 3.8 Flash', 'High']);
});

test('不比较的模型和只有配置名时不写接口名；模型列表里没有的模型照写接口名', () => {
  let { modelSeg } = make({ models: { M667: 'Orchestrator (Carbon)' }, resp: { e1: { name: 'gemini-pro-orchestrator', full: '' } } });
  assert.deepEqual(texts(modelSeg(md('M667'))), ['Orchestrator', 'Carbon']);
  // 还没查到接口名，只有配置名（gemini-4-argon-high）：不写
  ({ modelSeg } = make({ models: { M417: 'Gemini 4 Argon (High)' }, cfg: { M417: 'gemini-4-argon-high' } }));
  assert.deepEqual(texts(modelSeg(md('M417'))), ['Gemini 4 Argon', 'High']);
  // 不在模型列表里（子代理用的 M530）：接口名是唯一的名字，不标黄
  ({ modelSeg } = make({ resp: { e1: { name: 'gemini-4-hydrogen-tiered-high', full: '' } } }));
  const s = modelSeg(md('M530'));
  assert.deepEqual(texts(s), ['gemini-4-hydrogen-tiered-high']);
  assert.equal(real(s).cls, 'tx real');
});
