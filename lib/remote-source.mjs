// 在线更新（词典、规则、价格、最新版本号）从哪个镜像、按哪个版本下载。
// 镜像有四个：jsDelivr 的 cdn / fastly / gcore 三个节点，加上 GitHub raw。按分支（@main）下载时，各节点缓存刷新的快慢不一样，
// 某个节点可能好几个小时都给旧内容，清缓存也不一定清得到（11-23 实测 gcore 一直给 11-22 的旧词典和旧版本号）。
// 以前“上次能用的镜像排最前”，会一直粘在这个旧节点上：看不到新版本提示，词典也是旧的。现在：
//   1. 先问 GitHub main 分支最新的提交（一个很小的请求），所有文件都按这个提交下载（@<提交>）。按提交下载的内容不会变，
//      哪个镜像给的都一样新，也不会出现词典是新的、价格是旧的这种混搭。镜像还是上次能用的排最前，一个个试。
//   2. 问不到 GitHub（被限流、连不上），或者按提交哪个镜像都取不到，就按分支下载：同时向所有镜像取 meta.json，
//      用内容最新的那个（发布日期新的；日期一样比版本号）；一样新时上次能用的优先。
// 这个文件只做选择。取文件的函数由调用方传进来（注入程序在 Antigravity 页面里取，走 Antigravity 的网络设置）。

// 镜像地址里的分支换成某个提交（或标签）：jsDelivr 是 @main/，GitHub raw 是 /main/。都不是（测试用的本机地址）就原样返回
export const atRef = (base, ref) => (/@main\/$/.test(base) ? base.replace(/@main\/$/, `@${ref}/`) : /\/main\/$/.test(base) ? base.replace(/\/main\/$/, `/${ref}/`) : base);

const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
// 两份 meta 谁新：发布日期大的新，日期一样比版本号。大于 0 = a 新
export const cmpMeta = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || cmpVer(a.latest, b.latest);

const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u); } };
const parse = (text) => JSON.parse(String(text).replace(/^\uFEFF/, ''));

// o.bases      镜像地址（以 @main/ 或 /main/ 结尾）
// o.preferred  上次能用的镜像地址（排最前）
// o.refUrl     问 main 最新提交的地址（GitHub API 的 git/ref/heads/main）；空字符串 = 不问，直接按分支
// o.fetchText  (url) => Promise<string>，取不到抛错
// o.checkMeta  (obj) => 清理过的 meta，内容不对抛错
// 返回 { base 镜像地址, fileBase 实际下载用的地址, ref 提交（按分支时是 null）, metaText, how: 'commit' | 'branch', notes 没取到的原因 }
// 哪个镜像都取不到 meta.json 时抛错
export async function chooseSource(o) {
  const order = [...o.bases].sort((a, b) => (b === o.preferred) - (a === o.preferred));
  const notes = [];
  let ref = null;
  if (o.refUrl) {
    try {
      const j = parse(await o.fetchText(o.refUrl));
      const sha = j && j.object && j.object.sha;
      if (/^[0-9a-f]{40}$/.test(String(sha))) ref = sha; else notes.push('latest commit: unexpected answer');
    } catch (e) { notes.push(`latest commit: ${e.message}`); }
  }
  if (ref) {
    for (const b of order) {
      const fileBase = atRef(b, ref);
      if (fileBase === b) continue; // 这个地址不能按提交下载
      try {
        const metaText = await o.fetchText(fileBase + 'data/meta.json');
        o.checkMeta(parse(metaText));
        return { base: b, fileBase, ref, metaText, how: 'commit', notes };
      } catch (e) { notes.push(`${hostOf(b)}@${ref.slice(0, 7)}: ${e.message}`); }
    }
  }
  const got = await Promise.all(order.map(async (b) => {
    try {
      const metaText = await o.fetchText(b + 'data/meta.json');
      return { b, metaText, meta: o.checkMeta(parse(metaText)) };
    } catch (e) { notes.push(`${hostOf(b)}: ${e.message}`); return null; }
  }));
  let best = null;
  for (const g of got) if (g && (!best || cmpMeta(g.meta, best.meta) > 0)) best = g; // 一样新的保留排在前面的
  if (!best) throw Error(notes.join('; '));
  return { base: best.b, fileBase: best.b, ref: null, metaText: best.metaText, how: 'branch', notes };
}
