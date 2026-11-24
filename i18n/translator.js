// Antigravity 界面汉化：在页面里运行的翻译器（由 ../inject.mjs 注入，不要单独运行）。
//
// 做法：
//   - 只做“整段文字完全相同”的替换：文字节点去掉首尾空白后，在词典里查到才替换；
//     查不到再试 zh-CN.rules.json 里的正则规则（只用于 120 字以内的短文字；2026-11-22 从 80 放宽，
//     设置页的额度说明 “You have used some of your weekly limit, it will fully refresh in 6 days, 10 hours.” 有 85 字）。
//   - 只改文字节点的内容（nodeValue）和 placeholder / title 属性，不增删节点，
//     这样不会打乱 React 的渲染。React 把文字改回英文时，监听器会再翻一次。
//   - 跳过对话内容：助手回复、用户消息、代码、终端、输入框、可编辑区域。
//   - 不改 aria-label（应用和样式都靠它定位元素）。
//   - 换版本（v9）：新版接手旧版记下的原文，旧版翻过的文字也能按新词典重翻或恢复英文。
//   - 报错信息（v8）：译文照常显示，鼠标停在上面时用系统提示显示英文原文，方便搜索和向官方反馈。
//   - 翻过的文字节点和属性记下 [原文, 译文]（WeakMap，节点没了自动释放）。换词典（在线更新、改了词典文件）时按原文重翻：
//     改了译文的马上换上；新词典里没有了的（例如关掉在线更新后，只有在线词典才有的条目）恢复原文。
//     页面上的文字被应用改掉了（和记下的译文不一样）就当成新的原文。
//   - 性能（v6 起；v7 改了排除缓存）：回复流式输出时文字变化很密，大多在排除区域里。所以先判断排除再翻译，
//     文字节点所在元素“在排除区域里”的结果记 10 秒（WeakMap）；新加进来的元素（包括被挪动的）一律现查。
//     200 字以内文字的翻译结果也记下（最多 5000 条，换词典时清空）。
//   - 几句话拼成的说明（v11）：整段查不到时按句号拆开逐句翻，全部翻得出来才用。每句先查原文，再查去掉句号的原文、补上中文句号。
//     模型菜单的 “The original Gemini 4 model for advanced workflows. Leaving on Nov 30.” 就是这样拼的，后一句的日期用规则翻。
//   - 记下查不到译文的界面文字（v11）：只记像界面文字的（过滤路径、网址、邮箱、文件名、模型名、单个代号），数字换成 # 去重，
//     注入程序每 30 秒用 takeMissing() 取走，存进数据目录的 i18n-missing.json（只在本机），方便补词典。
//     不用翻的名字（Antigravity、Swarm 这类）在词典里写成原文和译文相同，就不会再被记下。
//   - 临时切回英文（v12）：按 Ctrl+Alt+E（macOS 是 Ctrl+Option+E）整页恢复英文，再按一次切回中文；插件面板里也有按钮。
//     只影响当前窗口、刷新后恢复中文，不改设置。按物理键位判断（不管键盘布局），AltGr+E（有的欧洲键盘用来打 €）不算。
//     切到英文时按记下的 [原文, 译文] 把页面上的译文换回原文，之后暂停翻译和记录没翻译的文字；切回中文时重新翻一遍。
//
// 被注入时以 (本函数)(词典, 规则, 选项) 的形式调用；再次调用只更新词典和规则并重新翻一遍。
// 选项（v12，插件框架用，比如 Antigravity 自带的 Swarm 面板；主窗口不传）：
//   exclude / allow：额外排除、放行的 CSS 选择器（框架里智能体写的内容：消息、任务标题等）；
//   rules：只在这个框架里用的规则（[正则, 替换]，比如 “From xxx”，放进通用规则会误翻主窗口）；
//   noMissing：不记录没翻译的文字（框架里没有交回注入程序的通道，内容也多）。
function agyI18n(DICT, RULES, OPTS) {
  'use strict';
  // 你自己或第三方起的名字：对话标题、项目名、文件树、文件名、路径栏、子任务标题；
  // v8 加上自动化名称、Coordinator 名称、分支 / 仓库 / worktree 名、SSH 主机、插件标题、MCP 服务器名、语音名。
  // 这些名字碰巧和词典里的词一样（比如文件夹叫 Downloads、自动化叫 Review）时，也不能被翻译。
  // 技能和规则的列表行没有 data-testid，没法单独排除；它们的名字一般是小写或文件名，和词典（区分大小写、整段相同）撞上的机会很小。
  const USER_NAMED = [
    '[data-testid="conversation-row-sidebar"] .truncate',
    '[data-testid="project-header"] .truncate',
    '[role="tree"]',
    '[data-testid="tab-file-tree-sidebar"]',
    '[data-testid="file-title-name"]',
    '[data-testid="breadcrumb-segment"]',
    '[data-testid="subagent-tab-header-title"]',
    '[data-testid="side-question-tab-header-title"]',
    '[data-testid="hover-card-title"]',
    '[data-testid="media-modal-title"]',
    '[data-testid="webview-download-filename"]',
    '[data-testid="automation-name"]',
    '[data-testid="coordinator-card-title"]',
    '[data-testid="branch-pill-label"]',
    '[data-testid="branch-repo-label"]',
    '[data-testid="jj-worktree-selector-label"]',
    '[data-testid="ssh-host-label"]',
    '[data-testid="ssh-config-file-name"]',
    '[data-testid="ssh-host-project-item"]',
    '[data-testid="project-selector-github-repo-item"]',
    '[data-testid="plugin-view-title-bar-title"]',
    '[data-testid="mobile-plugin-view-title"]',
    '[data-testid="plugins-submenu-item"]',
    '[data-testid="mcp-server-row"] .font-medium', // 行里的按钮（Configure、Sign out）照常翻译，只排除服务器名
    '[data-testid="voice-picker-name"]',
    '[data-testid="side-question-tab-header-name"]',
  ].join(',');
  const EXCLUDE = [
    '[data-markdown-root]',
    '[aria-label="User message"]',
    '[data-quotable]',
    'pre', 'code', 'kbd', 'samp',
    'textarea', 'input', 'select',
    '[contenteditable]:not([contenteditable="false"])',
    '.xterm', '.monaco-editor',
    'script', 'style', 'svg',
    '[data-agy-no-i18n]',
    USER_NAMED,
    ...((OPTS && OPTS.exclude) || []),
  ].join(',');
  // 属性（占位文字、悬停提示）只在对话内容和代码里跳过；输入框的占位文字要翻译
  const ATTR_EXCLUDE = [
    '[data-markdown-root]',
    '[aria-label="User message"]',
    '[data-quotable]',
    'pre', 'code', '.xterm', '.monaco-editor', '[data-agy-no-i18n]',
    USER_NAMED,
    ...((OPTS && OPTS.exclude) || []),
  ].join(',');
  // 助手回复（[data-quotable]）里的界面按钮：步骤摘要“Thought for 8s”“Worked for 1m”。
  // 回复整体被排除，这几个按钮单独放行（按钮里只有界面文字，没有回复正文）。
  const ALLOW = [
    '[data-testid="thinking-collapsible-trigger"]',
    '[data-testid="worked-for-collapsible"]',
    ...((OPTS && OPTS.allow) || []),
  ].join(',');
  const ATTRS = ['placeholder', 'title', 'data-placeholder', 'aria-placeholder'];
  const HAS_LATIN = /[A-Za-z]/;

  // 改了本文件的逻辑就把版本号加 1：已打开的窗口会停掉旧翻译器、换成新的，不用刷新。
  // 版本号相同时只更新词典和规则。
  const VERSION = 12;
  const existing = window.__agyI18n;
  // 选项（插件框架的排除 / 放行 / 专用规则）变了也要换成新的翻译器：旧的闭包里还是旧选项（v12）
  const OPTS_KEY = JSON.stringify(OPTS || null);
  if (existing && existing.version === VERSION && existing.optsKey === OPTS_KEY) {
    existing.update(DICT, RULES);
    return;
  }
  // 换版本：接手旧版记下的 [原文, 译文]（v9 起交出 state）。不接手的话，旧版翻过的文字新版认不出原文，
  // 词典里删掉的条目就恢复不了英文，要等刷新页面
  const inherited = (existing && existing.state) || null;
  if (existing) existing.disable();

  let dict = new Map();
  let rules = [];
  let memo = new Map(); // 文字 → 译文或 null（只记 200 字以内的；规则要逐条试，记下来同一段文字下次不用再试）
  const load = (d, r) => {
    dict = new Map(Object.entries(d || {}));
    memo = new Map();
    rules = [];
    for (const [pat, rep] of [...(r || []), ...((OPTS && OPTS.rules) || [])]) {
      try { rules.push([new RegExp(pat), rep]); } catch (e) { /* 规则写错就跳过 */ }
    }
  };
  load(DICT, RULES);

  // 一段短文字：先查词典，再试规则
  const lookup = (t) => {
    let v = dict.get(t);
    if (v === undefined && t.length <= 120) {
      for (const [re, rep] of rules) {
        if (re.test(t)) { v = t.replace(re, rep); break; }
      }
    }
    return v;
  };
  // 一句话：先查原文；以句号、问号、叹号结尾的，再查去掉标点的原文，补上中文标点
  const END_ZH = { '.': '。', '?': '？', '!': '！' };
  const sentence = (p) => {
    let v = lookup(p);
    if (v !== undefined) return v;
    const e = END_ZH[p[p.length - 1]];
    if (!e || p.endsWith('..')) return undefined; // “Loading...” 这类省略号不拆
    v = lookup(p.slice(0, -1));
    if (v === undefined) return undefined;
    return /[。？！.?!…]$/.test(v) ? v : v + e;
  };
  // 返回译文（保留原来的首尾空白）；不需要翻译时返回 null
  const translate = (s) => {
    if (!s || s.length > 1000 || !HAS_LATIN.test(s)) return null; // 内置技能说明有 400~600 字
    if (s.length > 200) return translateNow(s);
    let r = memo.get(s);
    if (r === undefined) {
      r = translateNow(s);
      if (memo.size >= 5000) memo.clear();
      memo.set(s, r);
    }
    return r;
  };
  const translateNow = (s) => {
    const t = s.trim();
    let v = lookup(t);
    // 步骤摘要这类“A, b, c”拼接文字：拆开逐段翻，全部翻得出来才用
    if (v === undefined && t.length <= 120 && t.includes(', ')) {
      const parts = t.split(', ').map((p, i) => lookup(i === 0 ? p : p[0].toUpperCase() + p.slice(1)));
      if (parts.every((p) => p !== undefined)) v = parts.join('，');
    }
    // 几句话拼成的说明：按句号拆开逐句翻，全部翻得出来才用（v11）。只有一句时，也试试去掉句号后能不能查到
    if (v === undefined && t.length <= 400 && /[.?!]$|[.?!]\s+[A-Z0-9]/.test(t)) {
      const parts = t.split(/(?<=[.?!])\s+(?=[A-Z0-9])/).map(sentence);
      if (parts.every((p) => p !== undefined)) v = parts.join('');
    }
    if (v === undefined || v === t) return null;
    const lead = s.slice(0, s.length - s.trimStart().length);
    const trail = s.slice(s.trimEnd().length);
    return lead + v + trail;
  };

  // 查不到译文的界面文字（v11）。同一个模式（数字换成 #）换词典前只交一次；交过的记在 missSeen，最多 5000 个
  const missSeen = new Set();
  let missNew = []; // [模式, 例子]，等注入程序取走
  const MISS_MODEL = /^(Gemini|Claude|GPT|Gemma|Grok|Llama|DeepSeek|Qwen|Kimi|Mistral|o\d)\b/i;
  const looksUi = (t) => {
    if (t.length < 2 || t.length > 300) return false;
    if (!/[A-Za-z]{2}/.test(t) || /[\u3000-\u9fff\uac00-\ud7af]/.test(t)) return false; // 没有英文单词，或者已经有中日韩文字
    if (/https?:|www\.|\S@\S|[A-Za-z]:\\|\\|(^|\s)[~.]?\/\S|\S\/\S*\//.test(t)) return false; // 网址、邮箱、路径
    if (/\.(js|mjs|cjs|ts|tsx|jsx|py|md|json|ya?ml|toml|txt|html?|css|go|rs|java|kt|swift|c|cc|cpp|h|hpp|sh|ps1|bat|exe|dll|log|png|jpe?g|gif|svg|pdf|zip|lock)\b/i.test(t)) return false; // 文件名
    if (!/\s/.test(t) && !/^[A-Z][a-z]+([A-Z][a-z]+)?[.:!?…]*$/.test(t)) return false; // 单个代号（只留 “Settings” 这样的单词）
    if (MISS_MODEL.test(t) && t.split(/\s+/).length <= 6 && !/[.!?]$/.test(t)) return false; // 模型名
    return true;
  };
  const noteMissing = (s) => {
    const t = s.trim();
    if ((OPTS && OPTS.noMissing) || missSeen.size >= 5000 || dict.has(t) || !looksUi(t)) return; // 词典里有的（包括原文和译文相同、故意不翻的名字）不记
    const k = t.replace(/\d+/g, '#');
    if (missSeen.has(k)) return;
    missSeen.add(k);
    missNew.push([k, t]);
    if (missNew.length > 500) missNew.shift();
  };

  const isExcluded = (el) => !el || (el.closest(EXCLUDE) !== null && el.closest(ALLOW) === null);
  // 文字变化（流式输出时最密）用的版本：只记“在排除区域里”的元素，记 10 秒。
  // 只记“在”：记“不在”的话，元素被挪进回复里会翻错；记 10 秒：元素被挪出排除区域、可编辑状态被关掉时，最晚 10 秒后照常翻译。
  const excludedAt = new WeakMap(); // 元素 → 判断时间
  const isExcludedCached = (el) => {
    if (!el) return true;
    const now = Date.now();
    const t = excludedAt.get(el);
    if (t !== undefined && now - t < 10000) return true;
    const x = isExcluded(el);
    if (x) excludedAt.set(el, now); else if (t !== undefined) excludedAt.delete(el);
    return x;
  };
  const isAttrExcluded = (el) => !el || el.closest(ATTR_EXCLUDE) !== null;

  const origText = (inherited && inherited.origText) || new WeakMap(); // 文字节点 → [原文, 译文]
  const origAttr = (inherited && inherited.origAttr) || new WeakMap(); // 元素 → { 属性名: [原文, 译文] }

  // 报错信息的英文原文放进父元素的 title（元素自己有 title 时不动）。标记 data-agy-orig，翻译属性时跳过这个 title；
  // 只认两个词以上的原文，单独的 “Failed” 这类状态词不加。同一个元素里有几段文字时，只有设置它的那段文字能清掉它；
  // 那段文字被删掉、或被换成别的节点时（v10），在 onMutations 里按 removedNodes 清掉。
  const ERROR_RE = /\b(fail(ed|ure|s)?|errors?|unable|cannot|can't|couldn't|could not|invalid|not found|denied|timed out|exceeded|unexpected)\b/i;
  const ORIG = 'data-agy-orig';
  const origOwner = (inherited && inherited.origOwner) || new WeakMap(); // 元素 → 设置 title 的文字节点
  const markOrig = (el, text, node) => {
    if (!el) return;
    const ours = el.hasAttribute(ORIG);
    if (text) {
      if (!ours && el.hasAttribute('title')) return;
      el.setAttribute(ORIG, '');
      if (el.getAttribute('title') !== text) el.setAttribute('title', text);
      origOwner.set(el, node);
    } else if (ours && origOwner.get(el) === node) {
      el.removeAttribute(ORIG);
      el.removeAttribute('title');
      origOwner.delete(el);
    }
  };
  const errorText = (src) => { const t = src.trim(); return /\s/.test(t) && ERROR_RE.test(t) ? t : null; };
  let paused = false; // 临时切回英文（v12）
  const doText = (node, checked) => {
    if (paused) return;
    const o = origText.get(node);
    if (!checked && !o && isExcludedCached(node.parentElement)) return; // 没翻过的、在排除区域里的：不用翻译就能跳过
    const v = node.nodeValue;
    const src = o && v === o[1] ? o[0] : v; // 还是我们写的译文：按原文重翻
    const r = translate(src);
    if (r === null) {
      if (o && src === o[0] && v !== src) node.nodeValue = src; // 新词典里没有了：恢复原文
      if (o) { origText.delete(node); markOrig(node.parentElement, null, node); }
      else noteMissing(src); // 没翻过的已经确认不在排除区域里（翻过的这次先不记，免得记下被挪进排除区域的文字）
      return;
    }
    if (!checked && isExcluded(node.parentElement)) return;
    origText.set(node, [src, r]);
    if (r !== v) node.nodeValue = r;
    markOrig(node.parentElement, errorText(src), node);
  };
  const doAttr = (el, a) => {
    if (paused) return;
    if (a === 'title' && el.hasAttribute(ORIG)) return; // 我们放的英文原文，不翻
    const v = el.getAttribute(a);
    if (!v) return;
    let m = origAttr.get(el);
    const o = m && m[a];
    const src = o && v === o[1] ? o[0] : v;
    const r = translate(src);
    if (r === null) {
      if (o && src === o[0] && v !== src) el.setAttribute(a, src);
      if (o) delete m[a]; else noteMissing(src);
      return;
    }
    if (!m) origAttr.set(el, (m = {}));
    m[a] = [src, r];
    if (r !== v) el.setAttribute(a, r);
  };
  const doAttrs = (el) => { for (const a of ATTRS) doAttr(el, a); };

  // 翻译一棵子树；root 本身已确认不在排除区域里。
  // 排除区域整棵跳过，所以再单独翻一遍子树里放行的按钮。
  const walk = (root) => {
    walkTree(root);
    if (root.nodeType === 1) walkAllowed(root);
  };
  const walkAllowed = (root) => {
    for (const a of root.querySelectorAll(ALLOW)) walkTree(a);
  };
  const walkTree = (root) => {
    if (root.nodeType === 3) { doText(root, true); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType !== 1 || !n.matches(EXCLUDE)) return NodeFilter.FILTER_ACCEPT;
        // 输入框、可编辑区域：只翻属性，不进去翻文字
        if (!n.matches(ATTR_EXCLUDE)) doAttrs(n);
        return NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n, true);
      else doAttrs(n);
    }
  };

  const onMutations = (muts) => {
    if (paused) return;
    for (const m of muts) {
      if (m.type === 'characterData') {
        doText(m.target, false);
      } else if (m.type === 'childList') {
        // 先处理删掉的：设置原文提示的文字节点没了，提示就过时了（新加的节点是报错的话，下面会重新设置）
        for (const n of m.removedNodes) if (n.nodeType === 3) markOrig(m.target, null, n);
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) doText(n, false);
          else if (n.nodeType === 1) {
            if (!isExcluded(n)) walk(n);
            else {
              if (!isAttrExcluded(n)) doAttrs(n);
              walkAllowed(n);
            }
          }
        }
      } else if (m.type === 'attributes') {
        if (!isAttrExcluded(m.target)) doAttr(m.target, m.attributeName);
      }
    }
  };

  const observer = new MutationObserver(onMutations);
  let started = false;
  const start = () => {
    if (started || !document.documentElement) return;
    started = true;
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
    if (document.body) walk(document.body);
  };
  start();
  document.addEventListener('DOMContentLoaded', () => { start(); walk(document.body); }, { once: true });

  // ---------- 临时切回英文（v12） ----------
  // 把整页记下的译文换回原文（文字节点和属性）。origText / origAttr 是 WeakMap，不能列举，所以遍历页面上的节点逐个查
  const restoreAll = () => {
    if (!document.body) return;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        const o = origText.get(n);
        if (o && n.nodeValue === o[1]) n.nodeValue = o[0];
      } else {
        const m = origAttr.get(n);
        if (m) for (const a of Object.keys(m)) if (n.getAttribute(a) === m[a][1]) n.setAttribute(a, m[a][0]);
      }
    }
  };
  let toastEl = null, toastTimer = 0;
  const toast = (text) => {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('data-agy-no-i18n', '');
      toastEl.style.cssText = 'position:fixed; left:50%; bottom:72px; transform:translateX(-50%); z-index:2147483646; padding:6px 14px; border-radius:8px;' +
        'font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color:#fff; background:rgba(30,30,30,.86); pointer-events:none; transition:opacity .3s';
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    if (!toastEl.isConnected) document.body.append(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; setTimeout(() => toastEl && toastEl.remove(), 350); }, 2200);
  };
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
  const KEY_TEXT = isMac ? 'Ctrl+Option+E' : 'Ctrl+Alt+E';
  const setPaused = (on, quiet) => {
    on = !!on;
    if (on === paused) return paused;
    if (on) { restoreAll(); paused = true; }
    else { paused = false; if (document.body) walk(document.body); }
    if (!quiet) toast(on ? '已临时切回英文 · 再按 ' + KEY_TEXT + ' 切回中文' : '已切回中文');
    return paused;
  };
  const onKey = (e) => {
    if (e.code !== 'KeyE' || !e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || e.repeat) return;
    if (e.getModifierState && e.getModifierState('AltGraph')) return; // AltGr+E（有的欧洲键盘打 €）不算
    e.preventDefault();
    e.stopPropagation();
    const on = setPaused(!paused);
    // 告诉注入程序，让别的窗口和插件框架（Swarm 面板）一起切换；没有这个通道（单独运行时）就只切当前页面
    try { if (typeof window.__agyZhAsk === 'function') window.__agyZhAsk(JSON.stringify({ t: 'english', on })); } catch (err) {}
  };
  window.addEventListener('keydown', onKey, true);

  window.__agyI18n = {
    version: VERSION,
    optsKey: OPTS_KEY,
    update(d, r) { load(d, r); missSeen.clear(); missNew = []; if (document.body && !paused) walk(document.body); },
    setPaused, // 插件面板的“切到英文 / 切回中文”按钮经注入程序调用（v12）
    get paused() { return paused; },
    takeMissing() { const a = missNew; missNew = []; return a; }, // 注入程序每 30 秒取一次（v11）
    disable() { observer.disconnect(); started = false; window.removeEventListener('keydown', onKey, true); if (toastEl) toastEl.remove(); delete window.__agyI18n; },
    state: { origText, origAttr, origOwner }, // 给下一个版本接手
    get size() { return dict.size; },
  };
}
