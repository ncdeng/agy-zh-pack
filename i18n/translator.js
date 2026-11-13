// Antigravity 界面汉化：在页面里运行的翻译器（由 ../inject.mjs 注入，不要单独运行）。
//
// 做法：
//   - 只做“整段文字完全相同”的替换：文字节点去掉首尾空白后，在词典里查到才替换；
//     查不到再试 zh-CN.rules.json 里的正则规则（只用于 80 字以内的短文字）。
//   - 只改文字节点的内容（nodeValue）和 placeholder / title 属性，不增删节点，
//     这样不会打乱 React 的渲染。React 把文字改回英文时，监听器会再翻一次。
//   - 跳过对话内容：助手回复、用户消息、代码、终端、输入框、可编辑区域。
//   - 不改 aria-label（应用和样式都靠它定位元素）。
//
// 被注入时以 (本函数)(词典, 规则) 的形式调用；再次调用只更新词典和规则并重新翻一遍。
function agyI18n(DICT, RULES) {
  'use strict';
  // 你自己起的名字：对话标题、项目名、文件树、文件名、路径栏、子任务标题。
  // 这些名字碰巧和词典里的词一样（比如文件夹叫 Downloads）时，也不能被翻译。
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
  ].join(',');
  // 属性（占位文字、悬停提示）只在对话内容和代码里跳过；输入框的占位文字要翻译
  const ATTR_EXCLUDE = [
    '[data-markdown-root]',
    '[aria-label="User message"]',
    '[data-quotable]',
    'pre', 'code', '.xterm', '.monaco-editor', '[data-agy-no-i18n]',
    USER_NAMED,
  ].join(',');
  // 助手回复（[data-quotable]）里的界面按钮：步骤摘要“Thought for 8s”“Worked for 1m”。
  // 回复整体被排除，这几个按钮单独放行（按钮里只有界面文字，没有回复正文）。
  const ALLOW = [
    '[data-testid="thinking-collapsible-trigger"]',
    '[data-testid="worked-for-collapsible"]',
  ].join(',');
  const ATTRS = ['placeholder', 'title', 'data-placeholder', 'aria-placeholder'];
  const HAS_LATIN = /[A-Za-z]/;

  // 改了本文件的逻辑就把版本号加 1：已打开的窗口会停掉旧翻译器、换成新的，不用刷新。
  // 版本号相同时只更新词典和规则。
  const VERSION = 3;
  const existing = window.__agyI18n;
  if (existing && existing.version === VERSION) {
    existing.update(DICT, RULES);
    return;
  }
  if (existing) existing.disable();

  let dict = new Map();
  let rules = [];
  const load = (d, r) => {
    dict = new Map(Object.entries(d || {}));
    rules = [];
    for (const [pat, rep] of r || []) {
      try { rules.push([new RegExp(pat), rep]); } catch (e) { /* 规则写错就跳过 */ }
    }
  };
  load(DICT, RULES);

  // 一段短文字：先查词典，再试规则
  const lookup = (t) => {
    let v = dict.get(t);
    if (v === undefined && t.length <= 80) {
      for (const [re, rep] of rules) {
        if (re.test(t)) { v = t.replace(re, rep); break; }
      }
    }
    return v;
  };
  // 返回译文（保留原来的首尾空白）；不需要翻译时返回 null
  const translate = (s) => {
    if (!s || s.length > 1000 || !HAS_LATIN.test(s)) return null; // 内置技能说明有 400~600 字
    const t = s.trim();
    let v = lookup(t);
    // 步骤摘要这类“A, b, c”拼接文字：拆开逐段翻，全部翻得出来才用
    if (v === undefined && t.length <= 120 && t.includes(', ')) {
      const parts = t.split(', ').map((p, i) => lookup(i === 0 ? p : p[0].toUpperCase() + p.slice(1)));
      if (parts.every((p) => p !== undefined)) v = parts.join('，');
    }
    if (v === undefined || v === t) return null;
    const lead = s.slice(0, s.length - s.trimStart().length);
    const trail = s.slice(s.trimEnd().length);
    return lead + v + trail;
  };

  const isExcluded = (el) => !el || (el.closest(EXCLUDE) !== null && el.closest(ALLOW) === null);
  const isAttrExcluded = (el) => !el || el.closest(ATTR_EXCLUDE) !== null;

  const doText = (node, checked) => {
    const r = translate(node.nodeValue);
    if (r === null) return;
    if (!checked && isExcluded(node.parentElement)) return;
    node.nodeValue = r;
  };
  const doAttrs = (el) => {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const r = translate(v);
      if (r !== null) el.setAttribute(a, r);
    }
  };

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
    for (const m of muts) {
      if (m.type === 'characterData') {
        doText(m.target, false);
      } else if (m.type === 'childList') {
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
        const el = m.target;
        const v = el.getAttribute(m.attributeName);
        const r = translate(v);
        if (r !== null && !isAttrExcluded(el)) el.setAttribute(m.attributeName, r);
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

  window.__agyI18n = {
    version: VERSION,
    update(d, r) { load(d, r); if (document.body) walk(document.body); },
    disable() { observer.disconnect(); started = false; delete window.__agyI18n; },
    get size() { return dict.size; },
  };
}
