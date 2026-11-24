// 从官方价格页更新 data/prices.json（GitHub Actions 每天跑一次，见 .github/workflows/update-prices.yml；也可以手动跑）。
// 用法：node tools/update-prices.mjs [--gemini 本地文件] [--claude 本地文件] [--today YYYY-MM-DD]
//   不给本地文件就联网取：
//   - Gemini：AI Studio 价格页（带 Accept: text/markdown 拿到 Markdown 原文），每个模型 Standard 标签页的输入、输出、缓存读取三行；
//   - Claude：Google Cloud Vertex AI 合作模型价格页（HTML）。Antigravity 里的 Claude 经 Vertex 调用，所以用 Vertex 的价。
// 输出：
//   - data/prices.json：{ schema: 1, updated: 价格最后一次变化的日期, sources, models: { 模型 ID: { title, src, t } } }。
//     t = [[到哪天为止（不含，美国太平洋时间零点换价）或 null, { in 输入, cache 缓存读, cw 缓存写（只有 Claude）, out 输出（含思考） }], …]，
//     美元 / 百万 token。页面只写“through 某天 / starting 某天”，过了日子 Google 会把旧价删掉；这里保留已经过去的旧价，
//     状态栏给以前的天数算钱时还要用。
//   - 有变化才写文件。GITHUB_OUTPUT 里写 changed=true/false 和 problems=问题说明（工作流据此提交或开 issue）。
// 安全检查（任何一条不过，这个模型保留原来的价，记进 problems）：
//   - 必需的模型（REQUIRED，还在卖的那几个）都要解析出来；
//   - 和原来的价比，每个数只能在 0.2～5 倍之间（防止页面改版后把别的数字当成单价）；
//   - 按提示长度分档（prompts <= 200k）或写法看不懂的模型直接跳过，不猜。
// 只用 Node.js 自带的模块（需要 22 或更高版本，用到内置 fetch）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'data', 'prices.json');
const SOURCES = {
  gemini: 'https://aistudio.google.com/docs/pricing',
  claude: 'https://cloud.google.com/model-garden/partner-models/pricing',
};
// 状态栏单价表（statusbar.js 的 PRICES）用到的、还在卖的模型。页面上少了任何一个都算出问题（可能是页面改版了）。
// 已经宣布下线的模型不放进来：Google 会从价格页删掉它们，删掉以后 data/prices.json 照样留着原来的价（下线以前的调用还要算钱），
// 不算出问题。要是放着，删掉那天会开一个 issue；同标题的 issue 开着时工作流不再开新的，以后页面真改版了就看不出来。
// 2026-11-24 去掉 gemini-4-argon、gemini-3.8-flash：Antigravity 模型菜单写着 11-30 下线（Leaving on Nov 30）。
const REQUIRED = ['gemini-4-carbon', 'gemini-4-neon', 'gemini-4-hydrogen', 'claude-opus-5-5', 'claude-sonnet-5-5'];
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TODAY = arg('--today') || new Date().toISOString().slice(0, 10);
const problems = [];

// "November 30, 2026" → "2026-11-30"；plusDay 给 through（到这天为止）用：换价日是第二天
function isoDate(text, plusDay) {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text.trim());
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  const d = new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()] - 1, +m[2] + (plusDay ? 1 : 0)));
  return d.toISOString().slice(0, 10);
}

// 一格价格文字 → [[到哪天为止或 null, 单价], …]；看不懂返回 null
//   "$3.00 Implicit caching only …"                                  → [[null, 3]]
//   "$2.00 through November 30, 2026. $4.00 starting December 1, 2026." → [["2026-12-01", 2], [null, 4]]
function parseCell(text) {
  let s = String(text || '');
  s = s.replace(/\$[\d.,]+\s*\/\s*1,000,000 tokens per hour \(storage price\)(\s+(through|starting) [A-Za-z]+ \d{1,2}, \d{4}\.?)?/gi, ''); // 缓存存储费，不要
  if (/prompts\s*[<>]/i.test(s)) return null; // 按提示长度分档：状态栏只有一个价，不猜
  const ms = [...s.matchAll(/\$(\d+(?:\.\d+)?)(?:\s+(through|starting)\s+([A-Z][a-z]+ \d{1,2}, \d{4}))?/g)];
  if (!ms.length) return null;
  if (ms.length === 1 && !ms[0][2]) return [[null, +ms[0][1]]];
  const tiers = [];
  for (const m of ms) {
    const v = +m[1];
    if (m[2] === 'through') {
      const until = isoDate(m[3], true);
      if (!until) return null;
      tiers.push([until, v]);
    } else if (m[2] === 'starting') {
      const from = isoDate(m[3], false);
      if (!from || !tiers.length || tiers[tiers.length - 1][0] !== from) return null; // starting 要接在 through 后面，日子对得上
      tiers.push([null, v]);
    } else return null; // 好几个价又没写日子
  }
  if (tiers[tiers.length - 1][0] !== null) return null; // 最后一档要一直有效
  return tiers;
}
// 把输入、缓存、输出三列各自的分段合成一张表：换价日取三列的并集
function combine(cols) {
  const cuts = [...new Set(Object.values(cols).flatMap((t) => t.map((x) => x[0]).filter(Boolean)))].sort();
  const at = (t, start) => (t.find((x) => x[0] === null || (start ? x[0] > start : true)) || t[t.length - 1])[1];
  const out = [];
  let start = null;
  for (const until of [...cuts, null]) {
    const p = {};
    for (const [k, t] of Object.entries(cols)) p[k] = at(t, start);
    out.push([until, p]);
    start = until;
  }
  return out;
}

// ---------- Gemini：AI Studio 价格页（Markdown） ----------
function parseGemini(md) {
  const out = {};
  for (const sec of String(md).split(/^## /m).slice(1)) {
    const id = (/\{% id="([^"]+)" %\}/.exec(sec) || [])[1];
    if (!id || !/^gemini-\d/.test(id) || /image|live|tts|embedding|robotics|transcribe|translate|omni|nano|decision|banana/i.test(id)) continue;
    const title = sec.split('\n')[0].replace(/\{%.*?%\}/g, '').replace(/\s+/g, ' ').trim();
    const std = (sec.split('{% tab title="Standard" %}')[1] || '').split('{% /tab %}')[0];
    if (!std) continue;
    const rows = {};
    for (const chunk of std.split(/\n\s*---\s*\n/)) {
      const cells = chunk.split(/\n\s*\* /).map((c) => c.replace(/^\s*\*\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (cells.length < 3) continue;
      const f = cells[0];
      const k = /^Input price/i.test(f) ? 'in' : /^Output price/i.test(f) ? 'out' : /^Context caching price/i.test(f) ? 'cache' : null;
      if (k && !rows[k]) rows[k] = cells[cells.length - 1]; // 最后一格是付费档
    }
    if (!rows.in || !rows.out || !rows.cache) continue;
    const cols = {};
    for (const k of ['in', 'cache', 'out']) cols[k] = parseCell(rows[k]);
    if (Object.values(cols).some((c) => !c)) continue;
    out[id] = { title, src: 'gemini', t: combine(cols) };
  }
  return out;
}

// ---------- Claude：Vertex AI 合作模型价格页（HTML） ----------
// 页面是很多张表；每个模型名（如 “Claude Opus 5.5” 或单写 “Opus 5.5”）后面跟着 Input / Output / Cache Hit / 5m Cache Write 等格子。
// 有的格子有两个数（两列，比如区域和全球）：两个数一样才用，不一样就跳过这个模型。
function parseClaude(html) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const re = />\s*(?:Claude\s+)?(Opus|Sonnet|Haiku)\s+(\d+(?:\.\d+)?)\s*</g;
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ id: `claude-${m[1].toLowerCase()}-${m[2].replace('.', '-')}`, title: `Claude ${m[1]} ${m[2]}`, at: m.index });
  const out = {};
  const LABEL = /(5m Batch Cache Write|1h Batch Cache Write|Batch Cache Hit|Batch Input|Batch Output|5m Cache Write|1h Cache Write|Cache Hit|Input|Output)\s*((?:\$\d+(?:\.\d+)?\s*)+)/g;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (out[h.id]) continue;
    const end = Math.min(i + 1 < hits.length ? hits[i + 1].at : text.length, h.at + 6500);
    let chunk = text.slice(h.at + 1, end).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
    const next = chunk.slice(10).search(/Claude [A-Z][a-z]+ \d/); // 同一段里接着写了别的模型（例如 Fable），截掉
    if (next >= 0) chunk = chunk.slice(0, next + 10);
    const cells = {};
    let x;
    LABEL.lastIndex = 0;
    while ((x = LABEL.exec(chunk))) if (!cells[x[1]]) cells[x[1]] = [...x[2].matchAll(/\$(\d+(?:\.\d+)?)/g)].map((y) => +y[1]);
    const one = (k) => { const v = cells[k]; return v && v.length && v.every((y) => y === v[0]) ? v[0] : null; };
    const p = { in: one('Input'), cache: one('Cache Hit'), cw: one('5m Cache Write'), out: one('Output') };
    if ([p.in, p.cache, p.out].some((v) => v == null)) continue;
    if (p.cw == null) delete p.cw;
    out[h.id] = { title: h.title, src: 'claude', t: [[null, p]] };
  }
  return out;
}

// ---------- 和原来的价合并、检查 ----------
function checkRatio(id, oldT, newT) {
  if (!oldT) return true;
  const cur = (t) => (t.find((x) => x[0] === null || x[0] > TODAY) || t[t.length - 1])[1];
  const a = cur(oldT), b = cur(newT);
  for (const k of ['in', 'cache', 'out', 'cw']) {
    if (a[k] == null || b[k] == null) continue;
    const r = b[k] / a[k];
    if (!(r >= 0.2 && r <= 5)) { problems.push(`${id}: ${k} ${a[k]} → ${b[k]}，变化超过 5 倍，没有采用（请人工核对）`); return false; }
  }
  return true;
}
// 已经过去的旧价（until <= 今天）留着，接上页面上现在的价
function keepPast(oldT, newT) {
  const past = (oldT || []).filter((x) => x[0] && x[0] <= TODAY);
  const fut = newT.filter((x) => x[0] === null || x[0] > TODAY);
  const merged = [...past];
  for (const x of fut) if (!merged.some((y) => y[0] === x[0])) merged.push(x);
  return merged;
}

async function getText(url, accept) {
  const r = await fetch(url, { headers: { Accept: accept, 'User-Agent': 'agy-zh-pack price updater (+https://github.com/ncdeng/agy-zh-pack)' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  return r.text();
}
async function load(name, file, url, accept) {
  try { return file ? fs.readFileSync(file, 'utf8') : await getText(url, accept); }
  catch (e) { problems.push(`${name} 价格页取不到：${e.message}`); return null; }
}

const old = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return { models: {} }; } })();
const oldModels = old.models || {};
const md = await load('Gemini', arg('--gemini'), SOURCES.gemini, 'text/markdown');
const html = await load('Claude', arg('--claude'), SOURCES.claude, 'text/html');
const parsed = { ...(md ? parseGemini(md) : {}), ...(html ? parseClaude(html) : {}) };
const models = { ...oldModels }; // 页面上没有了的模型留着原来的价（下架以前的调用还要算钱）
for (const [id, e] of Object.entries(parsed)) {
  if (!checkRatio(id, oldModels[id] && oldModels[id].t, e.t)) continue;
  models[id] = { title: e.title, src: e.src, t: keepPast(oldModels[id] && oldModels[id].t, e.t) };
}
for (const id of REQUIRED) if (!parsed[id] && ((id.startsWith('gemini') && md) || (id.startsWith('claude') && html))) problems.push(`${id}: 页面上没解析出来（页面改版了？），保留原来的价`);
for (const id of REQUIRED) if (!models[id]) problems.push(`${id}: 没有价格`);

const sorted = Object.fromEntries(Object.keys(models).sort().map((k) => [k, models[k]]));
const changed = JSON.stringify(sorted) !== JSON.stringify(oldModels);
if (changed) {
  const data = { schema: 1, updated: TODAY, sources: SOURCES, models: sorted };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
}
const ids = Object.keys(parsed);
console.log(`parsed ${ids.length} models (${ids.filter((i) => i.startsWith('gemini')).length} Gemini, ${ids.filter((i) => i.startsWith('claude')).length} Claude); ` +
  (changed ? 'data/prices.json updated' : 'no change'));
for (const p of problems) console.log('problem: ' + p);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n` + `problems<<EOF\n${problems.join('\n')}\nEOF\n`);
}
