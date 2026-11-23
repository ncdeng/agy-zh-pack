// 插件包含的文件（相对仓库根目录 = 插件根目录）。发版签名（tools/release.mjs）、打包（package/build.mjs）、安装（package/app/setup.mjs）都按这个清单。
// 加了新文件要加进来；lib/update.mjs 的 ALLOWED_TOP 也要允许它所在的顶层目录。
// 只能是 UTF-8 文本文件（更新时文件按文字下载、再编回 UTF-8 字节；二进制会坏掉，见 lib/update.mjs），
// 算 sha256 前一律把 CRLF 换成 LF（和 git 仓库里存的一样，jsDelivr 给的也是这个）。
export const PLUGIN_FILES = [
  'plugin.json',
  'assets/logo.svg',
  'sidecars/core/sidecar.json',
  'sidecars/core/main.mjs',
  'lib/panel.mjs',
  'lib/relaunch.mjs',
  'lib/update.mjs',
  'lib/remote-source.mjs',
  'inject.mjs',
  'statusbar.js',
  'debug-port.ps1',
  'i18n/translator.js',
  'i18n/zh-CN.json',
  'i18n/zh-CN.rules.json',
  'LICENSE',
];
// 读一个插件文件，统一成 LF；有 BOM 或不是 UTF-8 文本就报错
// （浏览器 fetch 的 text() 会去掉 BOM、把无效字节换成 U+FFFD，签进了清单也只会装出坏文件）
export function readPluginFile(fs, file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw Error('文件开头有 BOM：' + file);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { throw Error('插件文件只能是 UTF-8 文本，不能是二进制文件：' + file); }
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
}
