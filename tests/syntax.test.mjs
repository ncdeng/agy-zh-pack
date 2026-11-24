// 插件文件和工具脚本：语法检查；插件文件清单里的文件都在、都能按 UTF-8 读；两处版本号一致；插件面板网页里的脚本能编译
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, read, readJson } from './_helpers.mjs';

const { PLUGIN_FILES, readPluginFile } = await import(pathToFileURL(path.join(ROOT, 'tools/plugin-files.mjs')).href);

test('插件文件清单里的文件都在，都是没有 BOM 的 UTF-8 文本', () => {
  for (const f of PLUGIN_FILES) assert.doesNotThrow(() => readPluginFile(fs, path.join(ROOT, f)), f);
});

test('JS 文件都能通过 node --check', () => {
  const files = [...PLUGIN_FILES.filter((f) => /\.(m?js)$/.test(f)),
    ...fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => 'tools/' + f),
    ...fs.readdirSync(path.join(ROOT, 'tools', 'dev')).filter((f) => f.endsWith('.mjs')).map((f) => 'tools/dev/' + f),
    'package/build.mjs'];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f}：${String(e.stderr || e.message).trim().split('\n').slice(0, 5).join('\n')}`); }
  }
});

test('inject.mjs 和 plugin.json 的版本号一致', () => {
  const v = (/const PACK_VERSION = '([\d.]+)'/.exec(read('inject.mjs')) || [])[1];
  assert.ok(v, '找不到 PACK_VERSION');
  assert.equal(readJson('plugin.json').version, v);
});

test('插件面板网页里的脚本能编译', () => {
  const s = read('lib/panel.mjs').replace(/\r\n/g, '\n');
  const a = s.indexOf('const PAGE = `');
  const b = s.lastIndexOf('</html>`;');
  assert.ok(a >= 0 && b > a, '找不到 PAGE');
  // PAGE 是模板字符串：先按 JS 求值得到真正的网页文本，再取出 <script> 里的代码
  const page = new Function('return `' + s.slice(a + 'const PAGE = `'.length, b + '</html>'.length) + '`;')();
  const m = page.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, '网页里没有 <script>');
  assert.doesNotThrow(() => new Function(m[1]));
});
