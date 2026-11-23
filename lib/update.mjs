// 代码更新（v2.0，插件模式）：侧边栏面板上点了“更新”才装；装之前用作者的公钥校验签名，签名不对就不装。
//
// 发版时（tools/release.mjs sign）在作者电脑上生成 plugin-manifest.json：
//   { payload: "<JSON 字符串>", sig: "<Ed25519 签名，base64>" }，payload = { name, version, date, files: [[路径, sha256, 字节数], …] }。
//   私钥只在作者电脑上（Windows DPAPI 加密保存），GitHub 上没有；下面的公钥随插件一起安装。
//   所以 GitHub 账号或仓库被人改了，也装不进没签过名的代码。
// 更新步骤：
//   1. 最新版本号来自在线更新取到的 data/meta.json（在线更新关着就不查新版本）；只装比现在新的版本。
//   2. 取那个版本标签下的 plugin-manifest.json（jsDelivr 的 @v<版本>，备用 raw.githubusercontent.com），校验签名和内容格式。
//   3. 按清单取每个文件，逐个核对 sha256 和大小；全部对上才继续。文件经 Antigravity 页面下载（走它的网络和代理），没有窗口时用 Node 直接下载。
//   4. 先存到数据目录的 update/v<版本>/，把现在的文件备份到 backup/v<现在的版本>/，再逐个替换插件目录里的文件，删掉新版本不再有的文件。
//      替换中途出错就用备份恢复。
//   5. 写 update-state.json，1.5 秒后退出进程，Antigravity 自动用新代码重新拉起 sidecar；已打开的窗口会被重新注入。
// 启动时还会核对插件目录里的文件和 plugin-manifest.json 是否一致（integrity），结果显示在面板上。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 作者的发版公钥（Ed25519）。换钥匙要发一个用旧钥匙签名的新版本。
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApWl/GdB5iX9JPE2sf6cE+ByeWagdYkE/RZoiIOJgDdg=
-----END PUBLIC KEY-----
`;
const MANIFEST = 'plugin-manifest.json';
const SAFE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const ALLOWED_TOP = new Set(['plugin.json', 'inject.mjs', 'statusbar.js', 'debug-port.ps1', 'LICENSE', 'i18n', 'lib', 'sidecars', 'assets']);
const REQUIRED = ['plugin.json', 'inject.mjs', 'sidecars/core/main.mjs', 'sidecars/core/sidecar.json', 'lib/update.mjs'];
const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};

// 校验签名和内容格式，返回 payload；不对就抛错
export function verifyManifest(text, publicKey = PUBLIC_KEY) {
  let m;
  try { m = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { throw Error('清单不是 JSON'); }
  if (!m || typeof m.payload !== 'string' || typeof m.sig !== 'string') throw Error('清单格式不对');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(m.payload, 'utf8'), publicKey, Buffer.from(m.sig, 'base64')); } catch (e) { throw Error('签名校验出错：' + e.message); }
  if (!ok) throw Error('签名不对，不是作者发布的版本');
  const p = JSON.parse(m.payload);
  if (p.name !== 'agy-zh-pack' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p.version) || !Array.isArray(p.files) || !p.files.length) throw Error('清单内容不对');
  let total = 0;
  const seen = new Set();
  for (const f of p.files) {
    if (!Array.isArray(f) || f.length !== 3) throw Error('清单里的文件格式不对');
    const [rel, hash, size] = f;
    if (typeof rel !== 'string' || !SAFE_PATH.test(rel) || !ALLOWED_TOP.has(rel.split('/')[0]) || seen.has(rel)) throw Error('清单里有不允许的路径：' + rel);
    if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isInteger(size) || size < 0 || size > MAX_FILE) throw Error('清单里的文件信息不对：' + rel);
    seen.add(rel);
    total += size;
  }
  if (total > MAX_TOTAL) throw Error('清单里的文件太大');
  for (const r of REQUIRED) if (!seen.has(r)) throw Error('清单缺少 ' + r);
  return p;
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const stateFile = (ctx) => path.join(ctx.dataDir, 'update-state.json');
const setState = (ctx, o) => { fs.mkdirSync(ctx.dataDir, { recursive: true }); fs.writeFileSync(stateFile(ctx), JSON.stringify({ ...o, at: Date.now() })); };

// 插件目录里的文件和已安装的清单是否一致（启动时算一次）
let integrity = null;
export function checkIntegrity(ctx) {
  const file = path.join(ctx.root, MANIFEST);
  if (!fs.existsSync(file)) return (integrity = { status: 'no-manifest' });
  let p;
  try { p = verifyManifest(fs.readFileSync(file, 'utf8')); } catch (e) { return (integrity = { status: 'bad-manifest', error: e.message }); }
  const changed = [];
  for (const [rel, hash] of p.files) {
    let buf;
    try { buf = fs.readFileSync(path.join(ctx.root, rel)); } catch { changed.push(rel); continue; }
    if (sha256(buf) !== hash) changed.push(rel);
  }
  return (integrity = { status: changed.length ? 'modified' : 'ok', version: p.version, changed });
}

export function status(ctx) {
  const st = ctx.zh.status();
  const meta = st.remote && st.remote.meta;
  const latest = meta && meta.latest;
  const state = readJson(stateFile(ctx), { status: 'idle' });
  if (['downloading', 'verifying', 'installing'].includes(state.status) && Date.now() - state.at > 5 * 60e3) state.status = 'failed';
  return {
    current: ctx.zh.version, latest: latest || '', date: (meta && meta.date) || '', online: st.online,
    available: !!latest && cmpVer(latest, ctx.zh.version) > 0, state, integrity: integrity || checkIntegrity(ctx),
  };
}

// 版本标签下的下载地址：jsDelivr 的 @main 换成 @v<版本>，raw.githubusercontent.com 的 /main/ 换成 /v<版本>/；
// 测试用的地址（AGY_REMOTE_BASE）后面接 v<版本>/
const tagBases = (ctx, ver) => {
  const good = ctx.zh.lastGoodBase();
  const bases = ctx.zh.remoteBases().sort((a, b) => (b === good) - (a === good));
  return bases.map((b) => (/@main\/$/.test(b) ? b.replace(/@main\/$/, `@v${ver}/`) : /\/main\/$/.test(b) ? b.replace(/\/main\/$/, `/v${ver}/`) : `${b}v${ver}/`));
};
async function getText(ctx, url) {
  try { return await ctx.zh.fetchText(url); } catch (e) {
    if (!/no Antigravity window/.test(e.message)) throw e;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); // 没有连上的窗口：Node 直接下载（会用 HTTP(S)_PROXY）
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return r.text();
  }
}

let busy = false;
export async function install(ctx, expected) {
  if (busy) throw Error('更新正在进行');
  const s = status(ctx);
  if (!s.available || (expected && s.latest !== expected)) throw Error('没有可以装的新版本（请先检查更新）');
  const ver = s.latest;
  const stage = path.join(ctx.dataDir, 'update', 'v' + ver); // 下载的文件先放这里，全部核对通过才替换
  busy = true;
  const log = ctx.zh.log;
  try {
    setState(ctx, { status: 'downloading', version: ver });
    log(`update: installing v${ver}`);
    // 1. 清单：哪个地址能取到、签名对，就用哪个
    let manifestText = '', p = null, base = '';
    const errs = [];
    for (const b of tagBases(ctx, ver)) {
      try {
        const t = await getText(ctx, b + MANIFEST);
        p = verifyManifest(t);
        manifestText = t; base = b;
        break;
      } catch (e) { errs.push(`${new URL(b).host}: ${e.message}`); }
    }
    if (!p) throw Error('没取到有效的签名清单（' + errs.join('；') + '）');
    if (p.version !== ver || cmpVer(ver, ctx.zh.version) <= 0) throw Error(`清单里的版本是 ${p.version}，不是要装的 ${ver}`);
    // 2. 文件：逐个核对
    setState(ctx, { status: 'verifying', version: ver });
    fs.rmSync(stage, { recursive: true, force: true });
    for (const [rel, hash, size] of p.files) {
      // 插件文件只能是 UTF-8 文本（签名时 tools/plugin-files.mjs 会拦下二进制），按文字下载再编回字节不会变
      const buf = Buffer.from(await getText(ctx, base + rel), 'utf8');
      if (buf.length !== size || sha256(buf) !== hash) throw Error('文件校验不对：' + rel);
      fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
      fs.writeFileSync(path.join(stage, rel), buf);
    }
    // 3. 备份现在的文件，再替换
    setState(ctx, { status: 'installing', version: ver });
    const oldList = (() => { try { return verifyManifest(fs.readFileSync(path.join(ctx.root, MANIFEST), 'utf8')).files.map((f) => f[0]); } catch { return p.files.map((f) => f[0]); } })();
    const backup = path.join(ctx.dataDir, 'backup', 'v' + ctx.zh.version);
    fs.rmSync(backup, { recursive: true, force: true });
    for (const rel of new Set([...oldList, MANIFEST])) {
      const src = path.join(ctx.root, rel);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true });
      fs.copyFileSync(src, path.join(backup, rel));
    }
    const done = [];
    try {
      for (const [rel] of p.files) {
        const dst = path.join(ctx.root, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(stage, rel), dst + '.agy-new');
        fs.renameSync(dst + '.agy-new', dst);
        done.push(rel);
      }
      const keep = new Set(p.files.map((f) => f[0]));
      for (const rel of oldList) if (!keep.has(rel)) fs.rmSync(path.join(ctx.root, rel), { force: true });
      fs.writeFileSync(path.join(ctx.root, MANIFEST), manifestText);
    } catch (e) {
      log(`update: replacing files failed (${e.message}), restoring v${ctx.zh.version}`);
      for (const rel of new Set([...oldList, ...done, MANIFEST])) {
        const b = path.join(backup, rel);
        try { if (fs.existsSync(b)) fs.copyFileSync(b, path.join(ctx.root, rel)); else if (done.includes(rel)) fs.rmSync(path.join(ctx.root, rel), { force: true }); } catch {}
      }
      throw Error('替换文件时出错，已恢复原来的版本：' + e.message);
    }
    fs.rmSync(stage, { recursive: true, force: true });
    setState(ctx, { status: 'installed', version: ver, from: ctx.zh.version });
    log(`update: v${ctx.zh.version} -> v${ver} installed via ${new URL(base).host}, restarting the sidecar`);
    setTimeout(() => process.exit(0), 1500); // Antigravity 会用新代码重新拉起 sidecar
    return { status: 'installed', version: ver };
  } catch (e) {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} // 下了一半的文件不留
    setState(ctx, { status: 'failed', version: ver, error: String(e.message).slice(0, 300) });
    log(`update failed: ${e.message}`);
    throw e;
  } finally {
    busy = false;
  }
}
