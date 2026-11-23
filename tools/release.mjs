// 发版签名工具（v2.0）。只在作者电脑（Windows）上用：私钥用 DPAPI 加密保存，只有这个 Windows 账号能解开，脚本不打印私钥。
//
//   node tools/release.mjs keygen   第一次用：生成 Ed25519 钥匙。私钥 → %USERPROFILE%\.secrets\agy-zh-pack-release.dpapi，
//                                   公钥写进 lib/update.mjs（随插件安装，用来校验更新）。已有私钥文件就不覆盖。
//   node tools/release.mjs sign     生成并签名 plugin-manifest.json：版本取 plugin.json（要和 inject.mjs 的 PACK_VERSION 一致），
//                                   文件按 tools/plugin-files.mjs 的清单，每个文件 sha256（CRLF 统一成 LF）。签完马上用公钥自检。
//   node tools/release.mjs verify   用 lib/update.mjs 里的公钥校验 plugin-manifest.json，并核对每个文件。
//   node tools/release.mjs export <文件>   备份私钥：解开 DPAPI，存成明文 PEM 文件，并用 NTFS 权限限制成只有当前 Windows 账号能读
//                                   （文件所在的文件夹也一样）。存完读回来核对公钥指纹。不能存进本仓库。
//   node tools/release.mjs import <文件>   从备份恢复：核对备份里的私钥和 lib/update.mjs 的公钥是一对，再用 DPAPI 加密存回
//                                   %USERPROFILE%\.secrets\agy-zh-pack-release.dpapi（重装系统、换电脑后用）。
//
// 私钥丢了（重装系统、换电脑、换账号）就签不了新版本，已安装的插件也收不到更新，只能让用户手动装一次带新公钥的版本。
// 所以要用 export 备份一份。DPAPI 文件在 C 盘，重装系统会没；备份放 D 盘。
// 明文备份的防护：别的 Windows 账号读不了；以本账号身份运行的程序照样能读（这一点和 DPAPI 一样）；硬盘被人拿走能直接读。
// 备份文件不要放进仓库、网盘，也不要发给任何人。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUGIN_FILES, readPluginFile } from './plugin-files.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY_FILE = path.join(os.homedir(), '.secrets', 'agy-zh-pack-release.dpapi');
const UPDATE_JS = path.join(ROOT, 'lib', 'update.mjs');
const MANIFEST = path.join(ROOT, 'plugin-manifest.json');

// DPAPI（CurrentUser）：用 Windows PowerShell 5.1（自带 System.Security），明文只经过管道，不落盘、不打印
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ps = (script, input) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
  { input, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 });
const protect = (text, file) => ps(
  'Add-Type -AssemblyName System.Security; $t = [Console]::In.ReadToEnd(); ' +
  '$p = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($t), $null, "CurrentUser"); ' +
  `[IO.File]::WriteAllBytes(${psq(file)}, $p); 'saved'`, text);
const unprotect = (file) => ps(
  'Add-Type -AssemblyName System.Security; ' +
  `$p = [IO.File]::ReadAllBytes(${psq(file)}); ` +
  '$b = [Security.Cryptography.ProtectedData]::Unprotect($p, $null, "CurrentUser"); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))');

const fingerprint = (pubPem) => crypto.createHash('sha256').update(crypto.createPublicKey(pubPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
const embeddedPublicKey = () => {
  const m = /const PUBLIC_KEY = `([\s\S]*?)`;/.exec(fs.readFileSync(UPDATE_JS, 'utf8'));
  if (!m || /REPLACE_WITH/.test(m[1])) throw Error('lib/update.mjs 里还没有公钥，先运行 keygen');
  return m[1];
};

function keygen() {
  if (process.platform !== 'win32') throw Error('只在 Windows 上用（私钥靠 DPAPI 保存）');
  if (fs.existsSync(KEY_FILE)) throw Error('私钥文件已经存在，不覆盖：' + KEY_FILE);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (!/saved/.test(protect(priv, KEY_FILE))) throw Error('私钥没存上');
  // 存完马上解开核对一次（确认以后签得了名）
  if (unprotect(KEY_FILE).trim() !== priv.trim()) throw Error('私钥存储核对失败');
  let js = fs.readFileSync(UPDATE_JS, 'utf8');
  js = js.replace(/const PUBLIC_KEY = `[\s\S]*?`;/, () => 'const PUBLIC_KEY = `' + pub + '`;');
  fs.writeFileSync(UPDATE_JS, js);
  console.log('私钥已加密保存：' + KEY_FILE);
  console.log('公钥已写进 lib/update.mjs，指纹 ' + fingerprint(pub));
}

// 私钥 PEM 对应的公钥指纹；和 lib/update.mjs 里的公钥对不上就报错
const checkPair = (privPem) => {
  const fp = fingerprint(crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: 'spki', format: 'pem' }));
  const want = fingerprint(embeddedPublicKey());
  if (fp !== want) throw Error(`私钥和 lib/update.mjs 里的公钥不是一对（私钥 ${fp}，公钥 ${want}）`);
  return fp;
};
// 只让当前账号能访问：去掉继承来的权限，只给当前账号完全控制（文件夹的权限让里面的文件也继承）
const userOnly = (p, isDir = false) => {
  const who = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
  execFileSync('icacls', [p, '/inheritance:r', '/grant:r', `${who}:${isDir ? '(OI)(CI)F' : 'F'}`], { encoding: 'utf8', windowsHide: true });
  const acl = execFileSync('icacls', [p], { encoding: 'utf8', windowsHide: true });
  const lines = acl.split(/\r?\n/).map((l) => l.replace(p, '').trim()).filter((l) => l && !/^Successfully|^已成功/.test(l));
  if (lines.length !== 1 || !lines[0].toLowerCase().startsWith(who.toLowerCase() + ':')) throw Error('权限没设对：' + lines.join(' | '));
  return who;
};

function exportKey() {
  if (process.platform !== 'win32') throw Error('只在 Windows 上用');
  const target = path.resolve(process.argv[3] || '');
  if (!process.argv[3]) throw Error('用法：node tools/release.mjs export <备份文件路径>');
  if (target.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep)) throw Error('不能把私钥存进本仓库：' + target);
  const priv = unprotect(KEY_FILE);
  const fp = checkPair(priv);
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target, 'utf8').trim() === priv.trim()) { userOnly(target); console.log('备份已经存在，内容一致，权限已重新设好：' + target); return; }
    throw Error('目标文件已存在、内容不同，不覆盖：' + target);
  }
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const who = userOnly(dir, true); // 先锁文件夹，再写文件（文件继承文件夹的权限）
  fs.writeFileSync(target, priv, { flag: 'wx' });
  userOnly(target);
  if (checkPair(fs.readFileSync(target, 'utf8')) !== fp) throw Error('备份读回来核对失败');
  console.log(`私钥已备份：${target}`);
  console.log(`公钥指纹 ${fp}（读回来核对过）。文件和所在文件夹只有 ${who} 能访问。`);
}

function importKey() {
  if (process.platform !== 'win32') throw Error('只在 Windows 上用（私钥靠 DPAPI 保存）');
  if (!process.argv[3]) throw Error('用法：node tools/release.mjs import <备份文件路径>');
  const priv = fs.readFileSync(path.resolve(process.argv[3]), 'utf8');
  const fp = checkPair(priv);
  if (fs.existsSync(KEY_FILE)) {
    let cur = null;
    try { cur = unprotect(KEY_FILE); } catch {}
    if (cur && cur.trim() === priv.trim()) { console.log('DPAPI 里已经是这把私钥，不用恢复（指纹 ' + fp + '）'); return; }
    const old = KEY_FILE + '.old-' + Date.now();
    fs.renameSync(KEY_FILE, old);
    console.log('原来的私钥文件（' + (cur ? '是另一把钥匙' : '这个账号解不开') + '）改名留着：' + old);
  }
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (!/saved/.test(protect(priv, KEY_FILE))) throw Error('私钥没存上');
  if (unprotect(KEY_FILE).trim() !== priv.trim()) throw Error('私钥存储核对失败');
  console.log(`私钥已恢复到 ${KEY_FILE}（DPAPI 加密，指纹 ${fp}）`);
}

function buildPayload() {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
  const pack = (/const PACK_VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'inject.mjs'), 'utf8')) || [])[1];
  if (plugin.version !== pack) throw Error(`版本号对不上：plugin.json ${plugin.version}，inject.mjs PACK_VERSION ${pack}`);
  const files = PLUGIN_FILES.map((rel) => {
    const buf = readPluginFile(fs, path.join(ROOT, rel));
    return [rel, crypto.createHash('sha256').update(buf).digest('hex'), buf.length];
  });
  return { name: 'agy-zh-pack', version: plugin.version, date: new Date().toISOString().slice(0, 10), files };
}

async function sign() {
  const pub = embeddedPublicKey();
  const payload = JSON.stringify(buildPayload());
  const priv = unprotect(KEY_FILE);
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(priv)).toString('base64');
  const text = JSON.stringify({ payload, sig, key: fingerprint(pub) }, null, 2) + '\n';
  fs.writeFileSync(MANIFEST, text);
  const p = await verify();
  console.log(`已签名 plugin-manifest.json：v${p.version}，${p.files.length} 个文件，公钥指纹 ${fingerprint(pub)}`);
}

async function verify() {
  const { verifyManifest } = await import(pathToFileURL(UPDATE_JS).href);
  const p = verifyManifest(fs.readFileSync(MANIFEST, 'utf8'), embeddedPublicKey());
  for (const [rel, hash, size] of p.files) {
    const buf = readPluginFile(fs, path.join(ROOT, rel));
    if (buf.length !== size || crypto.createHash('sha256').update(buf).digest('hex') !== hash) throw Error('文件和清单对不上：' + rel);
  }
  const listed = new Set(p.files.map((f) => f[0]));
  for (const rel of PLUGIN_FILES) if (!listed.has(rel)) throw Error('清单里少了 ' + rel);
  if (process.argv[2] === 'verify') console.log(`清单签名正确，${p.files.length} 个文件都对得上（v${p.version}）`);
  return p;
}

const cmd = process.argv[2];
const run = { keygen, sign, verify, export: exportKey, import: importKey }[cmd];
if (!run) { console.error('用法：node tools/release.mjs keygen | sign | verify | export <文件> | import <文件>'); process.exit(1); }
Promise.resolve().then(run).catch((e) => { console.error('出错了：' + e.message); process.exit(1); });
