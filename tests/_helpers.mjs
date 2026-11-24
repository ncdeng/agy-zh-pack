// 测试共用的小工具。测试用 Node.js 自带的 node:test 运行：node --test "tests/*.test.mjs"（需要 Node.js 22.13 以上，用到 node:sqlite）。
// 测试数据都是写在测试里的合成数据，不读本机的用量记录、对话库，在 GitHub Actions 上也能跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const readJson = (rel) => JSON.parse(read(rel).replace(/^\uFEFF/, ''));

// inject.mjs、statusbar.js 不是模块化的库（直接运行的脚本），测试时按标记截出一段代码单独求值。
// from：这段代码开头的文字（包含在截出的代码里）；to：下一段代码开头的文字（不包含）。找不到就报错，提醒测试跟着改。
const srcCache = new Map();
export function cut(rel, from, to) {
  if (!srcCache.has(rel)) srcCache.set(rel, read(rel).replace(/\r\n/g, '\n'));
  const src = srcCache.get(rel);
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw Error(`${rel} 里找不到 ${a < 0 ? from : to}（代码改过了？测试要跟着改）`);
  return src.slice(a, b);
}
export const cutInject = (from, to) => cut('inject.mjs', from, to);

export const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
export const T = (s) => new Date(s).getTime(); // 不带时区的写法按本地时间
export const H = 3600e3;
export const D = 86400e3;
