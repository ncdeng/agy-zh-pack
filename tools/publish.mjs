// 一条命令发版（2026-11-24 加）。只在作者电脑（Windows）上用：签名要 DPAPI 里的私钥（见 tools/release.mjs）。
//
//   node tools/publish.mjs <版本号> --title "<Release 标题>" --notes <发布说明.md> --message <提交说明.txt> [--check] [--from <步骤>]
//
// 发版前先把代码、README（中英文）改好，新文件先 git add。脚本按顺序做下面几步，任何一步失败就停下，并说明停在哪一步、怎么接着做：
//   test     跑 tests/ 里的测试（node --test）
//   bump     改版本号：inject.mjs 的 PACK_VERSION、plugin.json 的 version
//   sign     node tools/release.mjs sign（生成并签名 plugin-manifest.json）
//   build    node package/build.mjs，复制成 dist/agy-zh-pack-v<版本号>.zip
//   commit   git add -u（改过的已跟踪文件）+ plugin-manifest.json，提交，打标签 v<版本号>，按标签里的文件核对签名清单
//   push     推送 main 和标签
//   release  在 GitHub 上建 Release，上传安装包，下载回来核对 sha256
//   meta     data/meta.json 的 latest 改成新版本号、date 改成今天，提交并推送
// meta 放在最后：插件按 meta.json 判断有没有新版本，一改就会提示用户更新，所以要等代码、标签、Release 都好了再改。
//
//   --check        只检查条件、跑测试，不改任何文件（发版前先跑一次）
//   --from <步骤>  从某一步接着做（前面的步骤做完了、后面某一步失败时用），例如 --from push
//
// 开始前检查：版本号格式、比现在的版本新；在 main 分支；本地 main 不落后于 origin/main（update-prices 工作流每天可能往 main 推价格表，
// 落后的话先 git pull --rebase）；没有未跟踪的新文件；标签还不存在；发布说明和提交说明文件存在；gh 已登录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STEPS = ['test', 'bump', 'sign', 'build', 'commit', 'push', 'release', 'meta'];

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const version = argv[0];
const title = opt('--title');
const notes = opt('--notes') && path.resolve(opt('--notes'));
const message = opt('--message') && path.resolve(opt('--message'));
const checkOnly = argv.includes('--check');
const from = opt('--from') || 'test';
const usage = '用法：node tools/publish.mjs <版本号> --title "<Release 标题>" --notes <发布说明.md> --message <提交说明.txt> [--check] [--from <步骤>]';
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail(`版本号要写成 1.2.3 这样。\n${usage}`);
if (!STEPS.includes(from)) fail(`--from 只能是：${STEPS.join(' / ')}`);
const tag = `v${version}`;
const zipName = `agy-zh-pack-${tag}.zip`;
const zipPath = path.join(ROOT, 'dist', zipName);
const doStep = (s) => !checkOnly && STEPS.indexOf(s) >= STEPS.indexOf(from);

// ---------- 小工具 ----------
function fail(msg) { console.error(`\n✖ ${msg}`); process.exit(1); }
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...o });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const ok = (cmd, args) => { try { execFileSync(cmd, args, { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } };
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let current = '';
function step(name, fn) {
  if (!doStep(name)) return;
  current = name;
  console.log(`\n=== ${name} ===`);
  try { fn(); }
  catch (e) {
    const done = STEPS.slice(STEPS.indexOf(from), STEPS.indexOf(name));
    fail(`停在“${name}”这一步：${e.message.split('\n')[0]}\n  已经做完：${done.join('、') || '（没有）'}。` +
      `\n  查明原因后接着做：node tools/publish.mjs ${version} --title "${title || ''}" --notes "${notes || ''}" --message "${message || ''}" --from ${name}`);
  }
}

// ---------- 开始前检查 ----------
console.log(`发布 ${tag}${checkOnly ? '（只检查）' : from !== 'test' ? `（从 ${from} 接着做）` : ''}`);
const before = (s) => checkOnly || STEPS.indexOf(from) <= STEPS.indexOf(s); // 这一步还要做
const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`现在在 ${branch} 分支，要在 main 上发版`);
if (before('push')) {
  run('git', ['fetch', '-q', 'origin', 'main']);
  const behind = Number(out('git', ['rev-list', '--count', 'HEAD..origin/main']));
  if (behind) fail(`本地 main 比 origin/main 落后 ${behind} 个提交（可能是 update-prices 工作流推的价格表），先 git pull --rebase`);
}
const untracked = out('git', ['status', '--porcelain']).split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3));
if (untracked.length && before('commit')) fail(`有未跟踪的新文件，要发布的先 git add，不要的加进 .gitignore：\n  ${untracked.join('\n  ')}`);
const packVersion = (/const PACK_VERSION = '([\d.]+)'/.exec(readText('inject.mjs')) || [])[1];
if (before('bump') && !newer(version, packVersion)) fail(`${version} 不比现在的版本 ${packVersion} 新`);
if (before('commit') && ok('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) fail(`本地已经有标签 ${tag}`);
if (before('push') && out('git', ['ls-remote', '--tags', 'origin', tag])) fail(`GitHub 上已经有标签 ${tag}`);
if (before('commit') && !(message && fs.existsSync(message) && fs.readFileSync(message, 'utf8').trim())) fail(`提交说明文件不存在或是空的：${message || '（没给 --message）'}`);
if (before('release')) {
  if (!title) fail('没给 --title');
  if (!(notes && fs.existsSync(notes) && fs.readFileSync(notes, 'utf8').trim())) fail(`发布说明文件不存在或是空的：${notes || '（没给 --notes）'}`);
  if (!ok('gh', ['auth', 'status'])) fail('gh 没登录（gh auth status 不通过）');
}
console.log('检查通过');

// ---------- 各步骤 ----------
if (checkOnly || from === 'test') { // --check 也跑测试
  current = 'test';
  console.log('\n=== test ===');
  try { run(process.execPath, ['--test', 'tests/*.test.mjs']); } catch { fail('测试没通过，没有改任何文件'); }
  if (checkOnly) { console.log('\n✔ 检查和测试都通过，可以发版'); process.exit(0); }
}

step('bump', () => {
  const edit = (rel, re, rep) => {
    const t = readText(rel);
    if (!re.test(t)) throw Error(`${rel} 里找不到版本号`);
    fs.writeFileSync(path.join(ROOT, rel), t.replace(re, rep));
  };
  edit('inject.mjs', /const PACK_VERSION = '[\d.]+';/, `const PACK_VERSION = '${version}';`);
  edit('plugin.json', /"version": "[\d.]+"/, `"version": "${version}"`);
  console.log(`inject.mjs、plugin.json：${packVersion} → ${version}`);
});

step('sign', () => run(process.execPath, ['tools/release.mjs', 'sign']));

step('build', () => {
  run(process.execPath, ['package/build.mjs'], { env: { ...process.env, AGY_ZH_PUBLISH: '1' } }); // 不显示“记得改 meta.json”的提醒
  fs.copyFileSync(path.join(ROOT, 'dist', 'agy-zh.zip'), zipPath);
  console.log(`${zipName}  sha256 ${sha256(zipPath)}`);
});

step('commit', () => {
  run('git', ['add', '-u']);
  run('git', ['add', 'plugin-manifest.json']);
  const staged = out('git', ['diff', '--cached', '--name-only']);
  if (!staged) throw Error('没有要提交的改动');
  console.log('要提交的文件：\n  ' + staged.split('\n').join('\n  '));
  run('git', ['commit', '-q', '-F', message]);
  run('git', ['tag', '-a', tag, '-m', tag]);
  // 按标签里的文件核对签名清单（和用户更新时一样，CRLF 统一成 LF 再算 sha256）
  const m = JSON.parse(out('git', ['show', `${tag}:plugin-manifest.json`]));
  const p = JSON.parse(m.payload);
  if (p.version !== version) throw Error(`签名清单里的版本是 ${p.version}`);
  const bad = p.files.filter(([f, h]) => {
    const b = execFileSync('git', ['show', `${tag}:${f}`], { cwd: ROOT, maxBuffer: 64 << 20 });
    const x = crypto.createHash('sha256').update(b).digest('hex');
    return !(x === h || x.startsWith(h));
  }).map(([f]) => f);
  if (bad.length) throw Error(`标签里这些文件和签名清单对不上：${bad.join(', ')}`);
  console.log(`${out('git', ['log', '--oneline', '-1'])}；标签 ${tag}；签名清单 ${p.files.length} 个文件都对得上`);
});

step('push', () => {
  run('git', ['push', 'origin', 'main']);
  run('git', ['push', 'origin', tag]);
});

step('release', () => {
  if (!fs.existsSync(zipPath)) throw Error(`找不到 ${zipPath}（要从 build 重做）`);
  run('gh', ['release', 'create', tag, `${zipPath}#agy-zh 安装包（Windows / macOS）`, '--title', title, '--notes-file', notes, '--latest']);
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-zh-release-'));
  try {
    run('gh', ['release', 'download', tag, '-p', zipName, '-D', dl]);
    const a = sha256(zipPath), b = sha256(path.join(dl, zipName));
    if (a !== b) throw Error(`下载回来的安装包 sha256 对不上：本地 ${a}，GitHub ${b}`);
    console.log(`下载回来核对过：sha256 ${a}`);
  } finally { fs.rmSync(dl, { recursive: true, force: true }); }
});

step('meta', () => {
  const rel = 'data/meta.json';
  const t = readText(rel);
  const j = JSON.parse(t);
  j.latest = version;
  j.date = today();
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(j, null, 2) + '\n');
  run('git', ['add', rel]);
  run('git', ['commit', '-q', '-m', `data/meta.json：最新版本改成 ${version}（发布 ${tag} 后最后一步）`]);
  run('git', ['push', 'origin', 'main']);
});

console.log(`\n✔ ${tag} 发布完成：https://github.com/ncdeng/agy-zh-pack/releases/tag/${tag}`);
console.log('  已安装 v2.0.x 的电脑：插件面板 → 版本 → 更新（或者等插件 6 小时内自己发现新版本）。');
