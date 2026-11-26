// i18n/translator.js：用假的页面（一个元素 + 若干文字节点）跑真词典和规则，看译文和 takeMissing() 记下的文字
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, readJson } from './_helpers.mjs';

const DICT = readJson('i18n/zh-CN.json');
const RULES = readJson('i18n/zh-CN.rules.json');

// 翻译一组文字，返回 { out: 每段的译文（没翻就是 null）, missing: takeMissing() 的结果, api: window.__agyI18n }
function run(texts) {
  const el = { nodeType: 1, closest: () => null, matches: () => false, hasAttribute: () => false, getAttribute: () => null,
    setAttribute() {}, removeAttribute() {}, querySelectorAll: () => [] };
  const nodes = texts.map((s) => ({ nodeType: 3, nodeValue: s, parentElement: el }));
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = {
    documentElement: {}, body: el, addEventListener() {},
    createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] || null }; },
  };
  const agyI18n = new Function(read('i18n/translator.js') + '\nreturn agyI18n;')();
  agyI18n(DICT, RULES);
  const api = globalThis.window.__agyI18n;
  return { out: nodes.map((n, i) => (n.nodeValue === texts[i] ? null : n.nodeValue)), missing: api.takeMissing(), api, nodes };
}

test('临时切回英文：换回原文、暂停翻译和记录；切回中文时重新翻译', () => {
  const { api, nodes } = run(['Leaving Soon', 'Brand new button']);
  assert.equal(nodes[0].nodeValue, '即将下线');
  assert.equal(api.setPaused(true, true), true);
  assert.equal(api.paused, true);
  assert.equal(nodes[0].nodeValue, 'Leaving Soon', '译文换回原文');
  api.update(DICT, RULES); // 暂停时换词典：不翻译、不记录
  assert.equal(nodes[0].nodeValue, 'Leaving Soon');
  assert.deepEqual(api.takeMissing(), []);
  assert.equal(api.setPaused(false, true), false);
  assert.equal(nodes[0].nodeValue, '即将下线', '切回中文');
});

test('词典和规则：整段、日期规则、评论条数', () => {
  const { out } = run(['Leaving Soon', 'Leaving on Nov 30', 'Leaving on December 1', '1 Comment', '12 Comments', 'Comments']);
  assert.deepEqual(out, ['即将下线', '11 月 30 日下线', '12 月 1 日下线', '1 条评论', '12 条评论', DICT.Comments]);
});

test('Antigravity 2.35.2 的新文字：换模型的提示、附带提问的来源、上下文用量条、排队消息里等后台任务', () => {
  const { out } = run([
    'Applies to messages sent after this turn', 'Copied to clipboard', 'Started from', 'Started during “Godot 4.7 Engineer”',
    'Skills: 91 tokens', 'Show 1 breakdown', 'Waiting on 1 background task: Re-run tests',
    'Waiting on 2 subagents and 3 background tasks: a, b, +1 more', 'Waiting on 2 subagents',
  ]);
  assert.deepEqual(out, [
    '从这一轮之后发出的消息开始生效', '已复制到剪贴板', '发起自', '运行中发起自“Godot 4.7 Engineer”',
    '技能：91 个 token', '显示 1 项明细', '正在等待 1 个后台任务：Re-run tests',
    '正在等待 2 个子智能体和 3 个后台任务：a, b, +1 more', '正在等待 2 个子智能体',
  ]);
});

test('按句翻译：每句都翻得出来才用，有一句翻不出来整段保持英文', () => {
  const { out } = run([
    'Use Hydrogen for better quality with lower quota usage. Leaving on Dec 15.',
    'Use Hydrogen for better quality with lower quota usage.',
    'Use Hydrogen for better quality with lower quota usage. Something totally new here.',
    'Loading...',
  ]);
  assert.equal(out[0], '建议改用 Hydrogen：质量更好，用的额度更少。12 月 15 日下线。');
  assert.equal(out[1], '建议改用 Hydrogen：质量更好，用的额度更少。');
  assert.equal(out[2], null);
  assert.equal(out[3], DICT['Loading...'] === undefined ? null : DICT['Loading...'], '省略号不拆');
});

test('保留首尾空白；原文和译文相同的条目不改', () => {
  const { out } = run(['  Leaving Soon  ', 'Swarm']);
  assert.equal(out[0], '  即将下线  ');
  assert.equal(out[1], null);
});

test('记下没翻译的界面文字：过滤路径、网址、邮箱、文件名、模型名、代号，数字换成 # 去重，词典里有的不记', () => {
  const { missing, api } = run([
    'Something totally new here.', 'Brand new button', 'Brand new button', 'Retry in 5 seconds', 'Retry in 12 seconds',
    'Settings2', 'src/app/main.ts', 'C:\\Users\\x', 'someone@example.com', 'https://example.com/x', 'README.md', 'claude-opus',
    'Gemini 3.8 Flash', 'Claude Opus 5.5 (Thinking)', '12:30', 'Reviewer', '设置 Foo', 'x', 'Swarm', 'Antigravity',
  ]);
  assert.deepEqual(missing, [
    ['Something totally new here.', 'Something totally new here.'],
    ['Brand new button', 'Brand new button'],
    ['Retry in # seconds', 'Retry in 5 seconds'],
    ['Reviewer', 'Reviewer'],
  ]);
  assert.deepEqual(api.takeMissing(), [], '取走以后清空');
  assert.equal(api.version, 12);
});
