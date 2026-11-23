// agy-zh-pack 插件的 sidecar（v2.0）。
// Antigravity 的后台（language_server）在 Antigravity 运行时启动它；它退出后约 1～2 秒会被重新拉起，插件目录被删掉时会被停掉。
// 运行环境：Antigravity 自带的 Node（Electron 以 Node 模式运行，Node 24 起，有 node:sqlite），不用另装 Node.js。
// 做的事：
//   1. 跑注入程序（../../inject.mjs）：界面汉化、用量状态栏、词典和价格的在线更新。数据放在
//      ~/.gemini/antigravity/plugin_data/agy-zh-pack（插件目录更新时会整个换掉，数据不能放在里面）。
//   2. 侧边栏面板（../../lib/panel.mjs）：运行状态、在线更新开关、版本更新按钮。
//   3. Antigravity 没带调试端口启动时问要不要重开（../../lib/relaunch.mjs）。
//   4. 代码更新（../../lib/update.mjs）：面板上点了才装，装之前校验作者的签名。
// Antigravity 给 sidecar 的环境变量：AGY_BROWSER_ACTIVE_PORT_FILE（调试端口文件）、ANTIGRAVITY_SIDECAR_WEB_PORT（面板端口）、
//   ANTIGRAVITY_SIDECAR_UI_TOKEN（面板请求要带的令牌）、ANTIGRAVITY_LS_ADDRESS（这次启动的后台地址，用来区分每次启动）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // 插件目录
process.env.AGY_ZH_PLUGIN = '1';
process.env.AGY_ZH_PLUGIN_DIR = ROOT;
if (!process.env.AGY_ZH_DATA_DIR) process.env.AGY_ZH_DATA_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-zh-pack');

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
await load('inject.mjs'); // 注入程序（拿到单实例锁才开始工作；已有一个在跑就待命）
const zh = globalThis.__agyZh;
process.on('uncaughtException', (e) => zh.log(`sidecar uncaught: ${(e && e.stack) || e}`));
process.on('unhandledRejection', (e) => zh.log(`sidecar unhandled rejection: ${(e && e.stack) || e}`));

const update = await load('lib/update.mjs');
const relaunch = await load('lib/relaunch.mjs');
const panel = await load('lib/panel.mjs');
const ctx = { zh, root: ROOT, dataDir: process.env.AGY_ZH_DATA_DIR, update, relaunch };
relaunch.startRelaunchWatch(ctx);
panel.startPanel(ctx).catch((e) => zh.log(`panel failed: ${e.message}`));

// 插件文件被换掉了（重新运行安装包覆盖安装、手动复制新版本）就退出，Antigravity 会用新代码重新拉起。
// 判断依据是签名清单：安装程序和面板上的更新都最后才写它。每 5 秒看一次修改时间，内容真的变了才退出。
const MANIFEST = path.join(ROOT, 'plugin-manifest.json');
const readManifest = () => { try { return fs.readFileSync(MANIFEST, 'utf8'); } catch { return null; } };
let manifestText = readManifest();
fs.watchFile(MANIFEST, { interval: 5000 }, () => {
  const now = readManifest();
  if (now === null || now === manifestText) return;
  manifestText = now;
  zh.log('plugin files were replaced, restarting the sidecar to load the new code');
  setTimeout(() => process.exit(0), 1000);
});
