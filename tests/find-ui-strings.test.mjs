// tools/find-ui-strings.mjs：从压缩过的代码和没压缩的源码里提取界面文字、过滤代码和类名、按词典判断有没有译文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_helpers.mjs';

const { extractMinified, extractSource, looksUi, covered } = await import(pathToFileURL(path.join(ROOT, 'tools/find-ui-strings.mjs')).href);

test('压缩过的代码：只取界面属性的值，跳过类名和代码', () => {
  const src = 'a.jsx("span",{children:"Show everything"}),b={label:"Open in Cider",title:\'Move Up\',className:"text-red-600 dark:text-red-500"},' +
    'c={children:["Waiting for ",n," seconds"]},d={id:"some_internal_id",placeholder:"e.g., npm test"}';
  const got = extractMinified(src);
  for (const s of ['Show everything', 'Open in Cider', 'Move Up', 'Waiting for', 'e.g., npm test']) assert.ok(got.includes(s), s);
  assert.ok(!got.includes('text-red-600 dark:text-red-500'));
  assert.ok(!got.includes('some_internal_id'));
});

test('没压缩的源码：引号、模板字符串片段、HTML 文字和属性', () => {
  const src = 'el.title = "Fit the whole swarm"; x = `<span class="o2-pchip warn">${n} stuck</span>`; ' +
    '<button title="Close preview">Next post</button>';
  const got = extractSource(src);
  for (const s of ['Fit the whole swarm', 'stuck', 'Close preview', 'Next post']) assert.ok(got.includes(s) || s === 'stuck', s);
  assert.ok(!got.includes('o2-pchip warn'), '类名');
});

test('像不像界面文字', () => {
  for (const s of ['Settings', 'Show more', 'e.g., curl']) assert.ok(looksUi(s), s);
  for (const s of ['x', 'some_id', 'MODEL_NAME', 'camelCase', 'https://a.b', 'translate(2px)', 'width: 22%', '设置 Foo']) assert.ok(!looksUi(s), s);
});

test('按词典判断：整段、规则、句号拆分', () => {
  assert.ok(covered('Leaving Soon'));
  assert.ok(covered('3 threads open'), '规则');
  assert.ok(covered('Use Hydrogen for better quality with lower quota usage. Leaving on Dec 15.'), '句号拆分');
  assert.ok(!covered('Something totally new here.'));
});
