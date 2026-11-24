// 找 Antigravity 界面里还没有译文的英文（维护用，2026-11-24 加）。Antigravity 升级以后跑一次，在用户看到之前补词典。
//
//   node tools/find-ui-strings.mjs [--port-file <DevToolsActivePort 文件>] [--no-page] [--no-plugins]
//
// 1. 主窗口：经调试端口连上 Antigravity 主窗口，在页面里取它加载的同源前端脚本（.js），提取界面文字。
//    压缩过的代码只取常见的界面属性（children、label、title、placeholder、tooltip、description 等）的字符串值，减少误报。
// 2. 自带插件：读 ~/.gemini/antigravity/builtin/plugins/<插件>/ 下的 .js / .mjs / .html（没压缩，按更宽的规则提取）。
// 3. 和 i18n/zh-CN.json、i18n/zh-CN.rules.json 比对（也按翻译器的逗号、句号拆分试一遍），列出还没有译文的，按来源分组。
// 4. 结果写进 dist/ui-strings.md（给人看）和 dist/ui-strings.json（下次比对用）；和上一次相比新出现的标 NEW。
//
// 只读：不改 Antigravity，不改词典。提取是按规则猜的，会混进代码里的字符串、日志、报错，要人工挑出界面文字再翻。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const PORT_FILE = opt('--port-file') || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort'));
const PLUGINS_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'builtin', 'plugins');
const OUT_MD = path.join(ROOT, 'dist', 'ui-strings.md');
const OUT_JSON = path.join(ROOT, 'dist', 'ui-strings.json');

// ---------- 词典和规则：判断一段文字有没有译文（和翻译器一样：整段 → 规则 → 逗号拆 → 句号拆） ----------
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'zh-CN.json'), 'utf8').replace(/^﻿/, ''));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'zh-CN.rules.json'), 'utf8')).map(([p]) => new RegExp(p));
const lookup = (t) => dict[t] !== undefined || (t.length <= 120 && rules.some((re) => re.test(t)));
const sentence = (p) => lookup(p) || (/[.?!]$/.test(p) && !p.endsWith('..') && lookup(p.slice(0, -1)));
export function covered(t) {
  if (lookup(t)) return true;
  if (t.length <= 120 && t.includes(', ') && t.split(', ').every((p, i) => lookup(i === 0 ? p : p[0].toUpperCase() + p.slice(1)))) return true;
  if (t.length <= 400 && /[.?!]$|[.?!]\s+[A-Z0-9]/.test(t) && t.split(/(?<=[.?!])\s+(?=[A-Z0-9])/).every(sentence)) return true;
  return false;
}

// ---------- 像不像界面文字 ----------
export function looksUi(s) {
  if (s.length < 2 || s.length > 200) return false;
  if (!/[A-Za-z]{2}/.test(s) || /[　-鿿]/.test(s)) return false;
  if (/[{};=<>]|=>|\$\{|\\[nt]|^\.|^#|^--|::|\(\)|https?:|\/\/|^[a-z0-9_.:/-]+$|^[A-Z0-9_]+$|^[a-z]+[A-Z]\w*$/.test(s)) return false;
  if (/^(var|calc|rgba?|hsla?|translate|scale|rotate|url|color-mix|linear-gradient)\(/.test(s)) return false;
  if (/\b\d+(px|em|rem|vh|vw|ms|s)\b/.test(s)) return false;
  if (/[-:]/.test(s) && /^[a-z0-9:/[\]._-]+(\s+[a-z0-9:/[\]._-]+)+$/.test(s)) return false; // CSS 类名列表（text-red-600 dark:text-red-500）
  if (/^[a-z-]+:\s*[\w#%().,\s-]+;?$/.test(s) && !/[A-Z]/.test(s)) return false; // CSS 声明（width: 22%）
  if (!/\s/.test(s) && !/^[A-Z][a-z]+([A-Z][a-z]+)?[.:!?…]*$/.test(s)) return false; // 单个词只留 “Settings” 这样的
  return /^[A-Z"'(@…+]/.test(s) || /\s/.test(s);
}
const unesc = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(['"`\\])/g, '$1').replace(/\s+/g, ' ').trim();

// 压缩过的代码：只取界面属性的字符串值
const UI_KEYS = 'children|label|title|placeholder|tooltip|description|text|header|heading|subtitle|subheading|message|caption|helperText|emptyText|confirmText|cancelText|confirmLabel|cancelLabel|buttonText|actionLabel|ariaLabel|"aria-label"|alt|hint|summary|body|detail|content';
const KEY_RE = new RegExp(`(?:${UI_KEYS})\\s*:\\s*(?:"((?:[^"\\\\\\n]|\\\\.){2,200})"|'((?:[^'\\\\\\n]|\\\\.){2,200})'|\`((?:[^\`\\\\$]|\\\\.){2,200})\`)`, 'g');
const CHILDREN_ARR_RE = /children\s*:\s*\[([^\]]{2,600})\]/g;
const STR_RE = /"((?:[^"\\\n]|\\.){2,200})"|'((?:[^'\\\n]|\\.){2,200})'/g;
export function extractMinified(src) {
  const out = new Set();
  for (const m of src.matchAll(KEY_RE)) out.add(unesc(m[1] ?? m[2] ?? m[3]));
  for (const m of src.matchAll(CHILDREN_ARR_RE)) for (const s of m[1].matchAll(STR_RE)) out.add(unesc(s[1] ?? s[2]));
  return [...out].filter(looksUi);
}
// 没压缩的源码（自带插件）：所有引号字符串、模板字符串里按 ${…} 和标签切开的片段、HTML 文字和 title / placeholder / aria-label
export function extractSource(src) {
  const out = new Set();
  for (const m of src.matchAll(STR_RE)) out.add(unesc(m[1] ?? m[2]));
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) for (const p of m[1].split(/\$\{(?:[^{}]|\{[^{}]*\})*\}|<[^>]*>/)) out.add(unesc(p));
  for (const m of src.matchAll(/>([^<>{}]+)</g)) out.add(unesc(m[1]));
  for (const m of src.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) out.add(unesc(m[1]));
  return [...out].filter(looksUi);
}

// ---------- 主窗口的前端脚本 ----------
async function pageScripts() {
  const port = fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/)[0].trim();
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\//.test(t.url));
  if (!page) throw Error('没找到 Antigravity 主窗口（要带 --remote-debugging-port=0 启动）');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(Error('连不上主窗口')); });
  const expr = `(async () => {
    const urls = [...new Set([...document.scripts].map((s) => s.src)
      .concat(performance.getEntriesByType('resource').map((e) => e.name)))]
      .filter((u) => u && u.startsWith(location.origin) && /\\.m?js(\\?|$)/.test(u));
    const out = [];
    for (const u of urls) { try { out.push([u.slice(location.origin.length), await (await fetch(u)).text()]); } catch (e) {} }
    return JSON.stringify(out);
  })()`;
  const v = await new Promise((r) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result && d.result.result ? d.result.result.value : null); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  ws.close();
  if (typeof v !== 'string') throw Error('取页面脚本失败');
  return JSON.parse(v);
}
function pluginFiles() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(PLUGINS_DIR); } catch { return out; }
  const walk = (dir, plugin) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, plugin); }
      else if (/\.(m?js|html)$/.test(e.name)) out.push([plugin, p]);
    }
  };
  for (const n of names) { try { walk(path.join(PLUGINS_DIR, n), n); } catch {} }
  return out;
}

// ---------- 主程序 ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const groups = new Map(); // 来源 → Set(文字)
  const addAll = (src, list) => { const g = groups.get(src) || new Set(); for (const s of list) g.add(s); groups.set(src, g); };
  if (!argv.includes('--no-page')) {
    try {
      const scripts = await pageScripts();
      for (const [u, text] of scripts) addAll('主窗口', extractMinified(text));
      console.log(`主窗口：${scripts.length} 个前端脚本`);
    } catch (e) { console.log(`主窗口：跳过（${e.message}）`); }
  }
  if (!argv.includes('--no-plugins')) {
    const files = pluginFiles();
    for (const [plugin, f] of files) addAll('插件 ' + plugin, extractSource(fs.readFileSync(f, 'utf8')));
    console.log(`自带插件：${files.length} 个文件（${PLUGINS_DIR}）`);
  }
  let last = new Set();
  try { last = new Set(JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')).missing.map((x) => x.t)); } catch {}
  const missing = [];
  for (const [src, set] of groups) for (const t of set) if (!covered(t)) missing.push({ src, t, isNew: last.size > 0 && !last.has(t) });
  missing.sort((a, b) => a.src.localeCompare(b.src) || a.t.localeCompare(b.t));
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ at: new Date().toISOString(), missing: missing.map(({ src, t }) => ({ src, t })) }, null, 1));
  let md = `# 还没有译文的界面文字（${new Date().toLocaleString()}）\n\n提取是按规则猜的，会混进代码里的字符串，要人工挑。NEW = 上一次没有。\n`;
  for (const [src] of groups) {
    const items = missing.filter((x) => x.src === src);
    md += `\n## ${src}（${items.length} 条）\n\n` + items.map((x) => `- ${x.isNew ? '**NEW** ' : ''}${JSON.stringify(x.t)}`).join('\n') + '\n';
  }
  fs.writeFileSync(OUT_MD, md);
  for (const [src, set] of groups) {
    const items = missing.filter((x) => x.src === src);
    console.log(`${src}：候选 ${set.size} 条，没有译文的 ${items.length} 条${last.size ? `，其中新出现 ${items.filter((x) => x.isNew).length} 条` : ''}`);
  }
  console.log(`报告：${OUT_MD}`);
}
