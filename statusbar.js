// Antigravity 输入框上方的用量状态栏（由 inject.mjs 注入，不要单独运行）。
//
// 数据来源：旁听应用自己和后台进程之间的两个接口（只读，不发请求）：
//   - StreamAgentStateUpdates：对话状态流。里面有 contextWindowUsage（上下文用量），
//     以及每次模型调用的 modelUsage（输入/输出/思考/缓存 token）和时间戳
//     createdAt（开始）、viewableAt（首字出现）、finishedGeneratingAt（生成结束）。
//   - GetUserStatus：各模型的名称和额度（quotaInfo.remainingFraction / resetTime）。
// 另外自己向本机后台查几个只读接口：额度（RetrieveUserQuotaSummary）、接口返回的模型名
// （GetCascadeTrajectoryGeneratorMetadata）、子代理是否还在跑（GetAllCascadeTrajectories）。
// 计算：首字 = viewableAt − createdAt；速度 = 输出 token ÷（finishedGeneratingAt − viewableAt）。
//
// 唯一会改内容的地方：上下文上限（见下面 CTX_LIMIT，默认关闭）。打开后，应用发给后台的请求里如果带 cascadeConfig，
// 就补上 checkpointConfig.maxTokenLimit，把压缩线从默认的 256K 提高。CTX_LIMIT 是 0 时完全不改请求。
//
// 旁听要在应用脚本运行前装好（注入器用 addScriptToEvaluateOnNewDocument 保证），
// 所以第一次装上后要刷新一次窗口（Ctrl+R）或重启 Antigravity 才有数据。
function agyStatusBar() {
  'use strict';
  // 再次注入时（改了本文件）：数据和旁听保留，只替换显示部分
  const S = window.__agyStats || (window.__agyStats = { convs: new Map(), models: new Map(), render: () => {} });
  const FIRST = !S.tapped;
  S.tapped = true;
  // early：fetch 包装是不是在应用脚本之前装好的（addScriptToEvaluateOnNewDocument 注入时页面还在 loading）。
  // 晚到的包装接不住应用已经建好的连接，用量（和打开时的 512K）都不生效；注入器看到 early=false 且窗口刚打开，会自动刷新一次。
  if (FIRST) S.early = document.readyState === 'loading';
  const WATCH = /LanguageServerService\/(StreamAgentStateUpdates|GetUserStatus|RetrieveUserQuotaSummary)\b/;

  // ---------- 上下文上限（2026-11-09 加） ----------
  // 后台（language_server.exe 的 utils.GetCheckpointConfig）默认把 Gemini / Claude 的上下文预算压到 256,000，
  // 超过就压缩。请求的 cascadeConfig.checkpointConfig.maxTokenLimit 可以改这个预算：
  // agy CLI 在 /model 里选 512K 时发的就是 maxTokenLimit = 512000（CLI 的 buildCascadeConfigInternal）。
  // 这里照着做：只改 Gemini / Claude 模型（GPT-OSS 等上下文小的模型不动），应用自己已经设了值就不动。
  // 改 CTX_LIMIT 或下面的改写逻辑不用刷新窗口（fetch 包装每次都调最新的 S.rewrite）；
  // 但旧版状态栏装的 fetch 包装不会调 S.rewrite，所以第一次升级到这一版要刷新一次窗口。
  //
  // 默认关闭（0）。这项会改变发给 Google 服务器的请求内容，Antigravity 的服务条款第 6 条禁止干扰服务，
  // 可能导致账号被暂停；而且上下文越长，每一轮消耗的额度越多。要打开，自己承担风险，把下面改成 512000。
  const CTX_LIMIT = 0;                 // 0 = 关闭，不改任何请求；512000 = 和 agy CLI 选 512K 时一样
  const CTX_MODELS = /^(Gemini|Claude)\b/;
  S.ctxLimit = CTX_LIMIT;
  const enc = new TextEncoder();
  const dec8 = new TextDecoder();
  const toBytes = (b) => (b instanceof Uint8Array ? b
    : b instanceof ArrayBuffer ? new Uint8Array(b)
    : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null);
  // 输入请求体（字符串，或 grpc-web 帧：1 字节标志 + 4 字节长度 + JSON），返回改好的新请求体；不用改就返回 null
  S.rewrite = (body) => {
    const limit = S.ctxLimit;
    if (!(limit > 0) || body == null) return null;
    let text;
    let framed = false;
    if (typeof body === 'string') text = body;
    else {
      const u = toBytes(body);
      if (!u || u.length < 2) return null;
      if (u[0] === 0 && u.length >= 5 && new DataView(u.buffer, u.byteOffset + 1, 4).getUint32(0) === u.length - 5) {
        framed = true;
        text = dec8.decode(u.subarray(5));
      } else if (u[0] === 0x7b) text = dec8.decode(u); // 不带帧头的 JSON
      else return null;
    }
    if (text.indexOf('"cascadeConfig"') < 0) return null;
    let j;
    try { j = JSON.parse(text); } catch (e) { return null; }
    const cc = j && j.cascadeConfig;
    const pc = cc && cc.plannerConfig;
    if (!pc || pc.customModelInfoOverride) return null; // 自定义模型不动（CLI 也是这样）
    const model = S.models.get(pc.planModel);
    if (!model || !CTX_MODELS.test(model.label)) return null;
    const ck = cc.checkpointConfig || {};
    if (ck.maxTokenLimit) return null;
    cc.checkpointConfig = Object.assign({}, ck, { maxTokenLimit: limit });
    S.ctxApplied = { at: new Date().toISOString(), model: model.label, limit };
    const out = JSON.stringify(j);
    if (!framed) return typeof body === 'string' ? out : enc.encode(out);
    const p = enc.encode(out);
    const f = new Uint8Array(5 + p.length);
    new DataView(f.buffer).setUint32(1, p.length);
    f.set(p, 5);
    return f;
  };

  // ---------- 数据：解析 grpc-web+json 帧 ----------
  // 旁听和解析都挂在 S 上（S.onResponse / S.tap / S.onMessage），fetch 包装每次调最新版本，
  // 所以改这里的逻辑不用刷新窗口（只有 fetch 包装本身是第一次注入时装的）。
  // 调试：S.debugMax > 0 时把最近几条状态更新（长字符串截断、长数组截短）存在 S.debug 里。
  // 平时关着（0）；排查时在页面里设 window.__agyStats.debugMax = 40 再复现。
  if (S.debugMax === undefined) S.debugMax = 0;
  const compact = (v, depth) => {
    if (typeof v === 'string') return v.length > 160 ? v.slice(0, 160) + '…(' + v.length + ')' : v;
    if (!v || typeof v !== 'object') return v;
    if (depth > 14) return '…';
    if (Array.isArray(v)) {
      const a = v.length > 8 ? [...v.slice(0, 4), '…' + (v.length - 8) + ' more…', ...v.slice(-4)] : v;
      return a.map((x) => compact(x, depth + 1));
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = compact(v[k], depth + 1);
    return o;
  };
  // 代理（主代理和子代理）按 cascadeId 记：每个代理最近一次模型调用的元数据。
  // 子代理的步骤有时会混在主对话的流里（例如 teamwork 接管），所以按步骤自己的
  // metadata.sourceTrajectoryStepInfo.cascadeId 归属，没有这个字段才算到流的 conversationId 上。
  S.agents = S.agents || new Map();     // cascadeId → { id, last, lastAt }
  S.subInfo = S.subInfo || new Map();   // 子代理 cascadeId → { parent, typeName, role, model, modelTier, inherit }
  S.rootOf = S.rootOf || new Map();     // conversationId → rootConversationId
  S.casStatus = S.casStatus || new Map(); // cascadeId → { status, at }：后台对话摘要里的运行状态（见 S.fetchCascades）
  S.subPhase = S.subPhase || new Map();   // 子代理 cascadeId → { running, doneAt }：本页面看到它从运行到结束的时刻（见 subVisible）
  S.execModel = S.execModel || new Map(); // executionId → 后台实际模型名（plannerConfig.modelName）
  // 模型编号 → 最近一次见到的实际模型名。存在本地（localStorage），子代理的流没打开时也能显示实际名。
  const ENUM_KEY = 'agy.statusbar.enumModel';
  if (!S.enumModel) {
    S.enumModel = new Map();
    try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(ENUM_KEY) || '{}'))) S.enumModel.set(k, v); } catch (e) {}
  }
  const tms = (iso) => (iso ? Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1')) : NaN);
  const takeGenMetas = (tu) => {
    const g = tu.generatorMetadatasUpdate && tu.generatorMetadatasUpdate.generatorMetadatas;
    if (!Array.isArray(g)) return;
    let changed = false;
    for (const gm of g) {
      const pc = gm && gm.plannerConfig;
      if (!pc || !pc.modelName) continue;
      if (gm.executionId) S.execModel.set(gm.executionId, pc.modelName);
      if (pc.planModel && S.enumModel.get(pc.planModel) !== pc.modelName) { S.enumModel.set(pc.planModel, pc.modelName); changed = true; }
    }
    if (changed) try { localStorage.setItem(ENUM_KEY, JSON.stringify(Object.fromEntries(S.enumModel))); } catch (e) {}
  };
  const takeSteps = (tu, convId) => {
    const steps = tu.stepsUpdate && tu.stepsUpdate.steps;
    if (!Array.isArray(steps)) return;
    for (const st of steps) {
      if (!st || typeof st !== 'object') continue;
      const md = st.metadata || {};
      const src = md.sourceTrajectoryStepInfo;
      // 子代理调用：运行中是 invokeSubagent 步骤，完成后包在 generic.result.payload 里
      const inv = st.invokeSubagent ||
        (st.generic && st.generic.result && st.generic.result.payload && st.generic.result.payload.invokeSubagent);
      if (inv && Array.isArray(inv.subagents)) {
        const parent = (src && src.cascadeId) || convId;
        inv.subagents.forEach((a, i) => {
          const r = inv.results && inv.results[i];
          if (r && r.conversationId) {
            S.subInfo.set(r.conversationId, {
              parent, typeName: a.typeName, role: a.role, model: a.model, modelTier: a.modelTier, inherit: !!a.inherit,
            });
          }
        });
      }
      if (!md.modelUsage || !md.createdAt) continue;
      // 思考时长（界面上的 “Thought for 4s”）在规划回复步骤里，算 tok/s 要用，挂到元数据上
      if (st.plannerResponse && st.plannerResponse.thinkingDuration) md._thinkDur = st.plannerResponse.thinkingDuration;
      const id = (src && src.cascadeId) || convId;
      const ag = S.agents.get(id) || { id };
      if (!ag.last || md.createdAt >= ag.last.createdAt) {
        ag.last = md;
        ag.lastAt = tms(md.finishedGeneratingAt || md.completedAt || md.createdAt);
      }
      S.agents.set(id, ag);
    }
  };
  S.onMessage = (method, j) => {
    if (method === 'RetrieveUserQuotaSummary') {
      const r = (j && j.response) || j || {};
      if (Array.isArray(r.groups)) { S.quota = { at: Date.now(), groups: r.groups, description: r.description }; S.render(); }
      S.quotaRaw = compact(j, 0);
      return;
    }
    if (method === 'GetUserStatus') {
      const cfgs = j && j.userStatus && j.userStatus.cascadeModelConfigData && j.userStatus.cascadeModelConfigData.clientModelConfigs;
      if (!Array.isArray(cfgs)) return;
      for (const c of cfgs) {
        const key = c.modelOrAlias && c.modelOrAlias.model;
        if (key) S.models.set(key, { label: c.label || c.modelId || key, modelId: c.modelId, quota: c.quotaInfo || null });
      }
      S.render();
      return;
    }
    if (S.debugMax > 0) {
      S.debug = S.debug || [];
      S.debug.push({ at: new Date().toISOString(), msg: compact(j, 0) });
      if (S.debug.length > S.debugMax) S.debug.splice(0, S.debug.length - S.debugMax);
    }
    const u = j && j.update;
    if (!u || !u.conversationId) return;
    const cid = u.conversationId;
    const c = S.convs.get(cid) || { firstSeen: Date.now() };
    if (u.contextWindowUsage) c.ctx = u.contextWindowUsage;
    if (u.status) c.status = u.status;
    if (u.compactionInfo) c.compactions = (u.compactionInfo.compactedAtStepIndices || []).slice();
    const mtu = u.mainTrajectoryUpdate;
    if (mtu && mtu.metadata && mtu.metadata.rootConversationId) S.rootOf.set(cid, mtu.metadata.rootConversationId);
    const tus = [mtu].concat(Object.values(u.subtrajectoryUpdates || {}), Object.values(u.stepScopedSubtrajectoryUpdates || {}));
    for (const tu of tus) {
      if (!tu || typeof tu !== 'object') continue;
      try { takeGenMetas(tu); takeSteps(tu, cid); } catch (e) { /* 单个轨迹格式变了就跳过 */ }
    }
    c.updated = Date.now();
    S.convs.set(cid, c);
    S.lastConv = cid;
    S.render();
  };

  S.tap = (method, stream) => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = new Uint8Array(0);
    const pump = () => reader.read().then(({ value, done }) => {
      if (done) return;
      const nb = new Uint8Array(buf.length + value.length);
      nb.set(buf); nb.set(value, buf.length); buf = nb;
      while (buf.length >= 5) {
        const flag = buf[0];
        const len = new DataView(buf.buffer, buf.byteOffset + 1, 4).getUint32(0);
        if (buf.length < 5 + len) break;
        const body = buf.subarray(5, 5 + len);
        buf = buf.slice(5 + len);
        if (flag & 0x80) continue; // 结尾的 trailers 帧
        try { S.onMessage(method, JSON.parse(dec.decode(body))); } catch (e) { /* 数据格式变了就忽略 */ }
      }
      return pump();
    }).catch(() => {});
    pump();
  };

  // 返回替换后的 Response（不旁听就返回原对象）
  S.onResponse = (url, res) => {
    const m = WATCH.exec(url);
    if (!m || !res.body || !/json/.test(res.headers.get('content-type') || '')) return res;
    const [a, b] = res.body.tee();
    S.tap(m[1], b);
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
  };

  // 请求发出前：记下应用访问后台用的地址和请求头（自己查额度时照用），再按需改写请求体（上下文上限）
  S.beforeFetch = (url, init) => {
    if (!init) return init;
    try {
      const h = {};
      new Headers(init.headers || {}).forEach((v, k) => { if (k !== 'content-length') h[k] = v; });
      if (/grpc-web/.test(h['content-type'] || '')) {
        const first = !S.lsHeaders;
        S.lsHeaders = h;
        S.lsService = url.replace(/\/[A-Za-z]+(\?.*)?$/, '');
        if (first && typeof S.fetchQuota === 'function') setTimeout(() => S.fetchQuota(), 1500);
      }
    } catch (e) {}
    if (init.body != null && typeof S.rewrite === 'function') {
      const nb = S.rewrite(init.body);
      if (nb) return Object.assign({}, init, { body: nb });
    }
    return init;
  };

  // 额度（5 小时、每周）：后台接口 RetrieveUserQuotaSummary。应用只在打开“查看用量”时才调，
  // 所以这里每 3 分钟自己查一次（只读，和应用发的请求一样；forceRefresh=false，用后台的缓存）。
  // 走 window.fetch（也就是上面的包装），返回结果由旁听交给 S.onMessage。
  S.fetchQuota = () => {
    if (!S.lsHeaders || !S.lsService || S.quotaPending) return;
    S.quotaPending = true;
    const p = enc.encode('{}');
    const f = new Uint8Array(5 + p.length);
    new DataView(f.buffer).setUint32(1, p.length);
    f.set(p, 5);
    window.fetch(S.lsService + '/RetrieveUserQuotaSummary', { method: 'POST', headers: S.lsHeaders, body: f })
      .then((r) => r.arrayBuffer())
      .catch(() => {})
      .then(() => { S.quotaPending = false; });
  };

  // 向本机后台发一个一元请求（grpc-web+json），返回解析好的 JSON；拿不到就是 null
  const lsCall = (method, body) => {
    if (!S.lsHeaders || !S.lsService) return Promise.resolve(null);
    const p = enc.encode(JSON.stringify(body));
    const f = new Uint8Array(5 + p.length);
    new DataView(f.buffer).setUint32(1, p.length);
    f.set(p, 5);
    return window.fetch(S.lsService + '/' + method, { method: 'POST', headers: S.lsHeaders, body: f })
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const b = new Uint8Array(buf);
        if (b.length < 5 || (b[0] & 0x80)) return null;
        const len = new DataView(b.buffer, b.byteOffset + 1, 4).getUint32(0);
        return JSON.parse(dec8.decode(b.subarray(5, 5 + len)));
      })
      .catch(() => null);
  };

  // 接口返回的实际模型名（chatModel.responseModel，例如 gemini-4-argon）。状态流里没有，
  // 要按“对话 ID + 调用序号（sourceTrajectoryStepInfo.metadataIndex）”向本机后台查
  // GetCascadeTrajectoryGeneratorMetadata（只读，不经过 Google，不耗额度）。每次模型调用结束后查一次，
  // 按 executionId 记住；同时按模型编号存一份到 localStorage，首页和还没查到时用“上次的”。
  S.respModel = S.respModel || new Map();   // executionId → { name, full }
  S.respPending = S.respPending || new Map(); // executionId → { busy, tries, at }
  const RESP_KEY = 'agy.statusbar.respModel';
  if (!S.enumResp) {
    S.enumResp = new Map();
    try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(RESP_KEY) || '{}'))) S.enumResp.set(k, v); } catch (e) {}
  }
  S.needResp = (md) => {
    if (!md || !md.executionId || S.respModel.has(md.executionId)) return;
    if (!md.finishedGeneratingAt && !md.completedAt) return; // 这次调用还没结束
    const src = md.sourceTrajectoryStepInfo;
    if (!src || !src.cascadeId) return;
    const st = S.respPending.get(md.executionId) || { busy: false, tries: 0, at: 0 };
    if (st.busy || st.tries >= 3 || Date.now() - st.at < 8000) return;
    st.busy = true; st.tries++; st.at = Date.now();
    S.respPending.set(md.executionId, st);
    lsCall('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: src.cascadeId, generatorMetadataOffset: Number(src.metadataIndex) || 0 })
      .then((j) => {
        const g = j && Array.isArray(j.generatorMetadata) ? j.generatorMetadata[0] : null;
        const cm = g && g.chatModel;
        if (!cm || !cm.responseModel) return;
        if (g.executionId && g.executionId !== md.executionId) return; // 序号对不上同一次调用就不认
        S.respModel.set(md.executionId, { name: cm.responseModel, full: cm.responseModelFull || '' });
        const key = (md.modelUsage && md.modelUsage.model) || md.generatorModel;
        if (key && S.enumResp.get(key) !== cm.responseModel) {
          S.enumResp.set(key, cm.responseModel);
          try { localStorage.setItem(RESP_KEY, JSON.stringify(Object.fromEntries(S.enumResp))); } catch (e) {}
        }
        S.render();
      })
      .then(() => { st.busy = false; }, () => { st.busy = false; });
  };

  // 子代理是否还在跑（2026-11-09 加）：向本机后台查 GetAllCascadeTrajectories（只读，不经过 Google，
  // 一次返回本机所有对话的摘要，几个对话约 10 KB）。每个对话有 status（IDLE / RUNNING / BUSY / CANCELING），
  // 子代理还带 trajectoryMetadata.parentConversationId / rootConversationId / subagentSpec。
  // 子代理的状态流只在应用需要时才打开，流里的 status 常常没有或是旧的，所以以这里为准。
  // 有对话在跑时每 3 秒查一次，否则每 15 秒；窗口不可见时不查（见下面 start 里的定时器）。
  const ACTIVE = /RUNNING|BUSY|CANCELING/;
  S.fetchCascades = () => {
    if (S.casPending && Date.now() - (S.casAskAt || 0) < 15000) return; // 上一次还没回来（超过 15 秒就不等了）
    S.casPending = true;
    S.casAskAt = Date.now();
    lsCall('GetAllCascadeTrajectories', {})
      .then((j) => {
        const ts = j && j.trajectorySummaries;
        if (!ts || typeof ts !== 'object') return;
        const now = Date.now();
        let changed = false;
        let active = false;
        for (const [id, s] of Object.entries(ts)) {
          if (!s || typeof s !== 'object') continue;
          const status = String(s.status || '');
          const prev = S.casStatus.get(id);
          if (!prev || prev.status !== status) changed = true;
          S.casStatus.set(id, { status, at: now });
          if (ACTIVE.test(status)) active = true;
          const tm = s.trajectoryMetadata || {};
          if (tm.rootConversationId && tm.rootConversationId !== id) S.rootOf.set(id, tm.rootConversationId);
          // 子代理的子代理（例如 DeepInvestigator 派出的 Worker）的调用步骤在中间那层的流里，那个流不一定打开，从摘要补上
          const spec = tm.subagentSpec;
          if (spec && tm.parentConversationId && !S.subInfo.has(id)) {
            S.subInfo.set(id, {
              parent: tm.parentConversationId, typeName: spec.typeName, role: spec.role,
              model: spec.model, modelTier: spec.modelTier, inherit: !!spec.inherit,
            });
            changed = true;
          }
        }
        S.casActive = active;
        if (changed) S.render();
      })
      .then(() => { S.casPending = false; }, () => { S.casPending = false; });
  };

  const origFetch = window.fetch;
  if (FIRST) window.fetch = function (input, init) {
    let url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) {}
    if (url.indexOf('LanguageServerService/') < 0) return origFetch.apply(this, arguments);
    if (typeof S.beforeFetch === 'function') {
      try { init = S.beforeFetch(url, init) || init; } catch (e) { /* 出错就原样发出 */ }
    }
    const p = init === undefined ? origFetch.call(this, input) : origFetch.call(this, input, init);
    return p.then((res) => {
      try { return typeof S.onResponse === 'function' ? S.onResponse(url, res) : res; } catch (e) { return res; }
    });
  };

  // ---------- 显示 ----------
  const fmtK = (n) => {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
    return String(n);
  };
  const t = (iso) => (iso ? Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1')) : NaN);
  const pad = (x) => String(x).padStart(2, '0');
  const fmtReset = (iso) => {
    const d = new Date(t(iso));
    if (isNaN(d)) return '';
    const now = new Date();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.toDateString() === now.toDateString() ? hm : (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
  };
  const familyQuota = (model) => {
    if (!model) return null;
    if (model.quota) return model.quota;
    const base = String(model.label).replace(/\s*\(.*\)\s*$/, '');
    for (const m of S.models.values()) if (m.quota && String(m.label).replace(/\s*\(.*\)\s*$/, '') === base) return m.quota;
    return null;
  };

  // 当前页面对应的根对话：URL 里的对话如果是子代理，就顺着父链找到根
  const rootOf = (id) => {
    for (let i = 0; i < 10 && id && S.subInfo.has(id); i++) id = S.subInfo.get(id).parent;
    return (id && S.rootOf.get(id)) || id;
  };
  // 对话页：URL 里的对话。其他页面（首页/新对话）：只认进入这个页面之后才开始的对话
  // （刚发出第一条消息、地址还没跳到 /c/… 的那一小会儿），不再拿上一个对话的数据来显示。
  const currentRoot = () => {
    const m = /\/c\/([0-9a-f-]{36})/.exec(location.pathname);
    if (m) return rootOf(m[1]);
    let best = null;
    let bestAt = S.navAt || 0;
    for (const [cid, c] of S.convs) if (c.firstSeen > bestAt) { best = cid; bestAt = c.firstSeen; }
    return best ? rootOf(best) : null;
  };
  // 输入框下方模型按钮当前选中的模型（aria-label 不受汉化影响，如 "Select model, current: Gemini 4 Argon High"）
  const selectedLabel = () => {
    const t = document.querySelector('[data-testid="model-selector-trigger"]');
    return ((t && t.getAttribute('aria-label')) || '').replace(/^Select model, current:\s*/, '').split(' · ')[0].trim();
  };
  const selectedKey = () => {
    const want = selectedLabel().toLowerCase().replace(/[()\s]/g, '');
    if (!want) return '';
    for (const [k, v] of S.models) if (String(v.label).toLowerCase().replace(/[()\s]/g, '') === want) return k;
    return '';
  };
  const isRunning = (id) => /RUNNING/.test((S.convs.get(id) || {}).status || '');

  // 外观仿 CCometixLine 的 cometix 预设：每项“彩色图标 + 同色文字”，项之间用浅灰竖线分隔，
  // 同一项里的数值用“ · ”连接。主代理两行，每个在跑的子代理一行（跑完 10 秒后收起）。图标用 Google Fonts 的 Material Symbols。
  // 配色：浅色主题用 Catppuccin Latte（几种偏淡的颜色调深了），深色主题用 Catppuccin Mocha。
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  // 一项：kind 决定颜色（见 CSS 里的 --k-*），icon 是 Material Symbols 图标名
  const seg = (kind, icon, pieces, title, colorKind) => {
    const s = el('span', 'seg k-' + (colorKind || kind));
    if (title) s.title = title;
    if (icon) s.append(el('span', 'ic', icon));
    const list = pieces.filter(Boolean);
    list.forEach((p, i) => {
      // 文字之间用“·”；进度条后面只留空隙
      const prevText = typeof list[i - 1] === 'string' || (list[i - 1] && list[i - 1].classList && list[i - 1].classList.contains('tx'));
      if (i) s.append(prevText ? el('span', 'dot', '·') : el('span', 'gap'));
      s.append(typeof p === 'string' ? el('span', 'tx', p) : p);
    });
    return s;
  };
  // 10 格进度条
  const cells = (frac, colorKind) => {
    const box = el('span', 'cells k-' + colorKind);
    const on = Math.max(0, Math.min(10, Math.round(frac * 10)));
    for (let i = 0; i < 10; i++) box.append(el('i', i < on ? 'on' : ''));
    return box;
  };
  const level = (pct, warnAt, critAt, normal) => (pct >= critAt ? 'crit' : pct >= warnAt ? 'warn' : normal);

  // ---------- 模型 ----------
  const modelKey = (md) => (md && ((md.modelUsage && md.modelUsage.model) || md.generatorModel)) || '';
  // 配置名（plannerConfig.modelName，例如 gemini-4-argon-high）
  const cfgName = (md, key) => (md && S.execModel.get(md.executionId)) || (key ? S.enumModel.get(key) : '') || '';
  // 界面名 "Gemini 4 Argon (High)" 去掉括号里的推理强度，就是接口正常返回的名字 "gemini-4-argon"。
  // Gemini 的接口名对不上就标黄（可能是灰测版本或被换了模型）。点号按连字符比较；Claude 的命名规则不同，不比较。
  const baseName = (label) => label.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase().trim().replace(/[\s.]+/g, '-');
  const modelSeg = (md, fallbackKey, tier) => {
    const key = modelKey(md) || fallbackKey || '';
    const info = S.models.get(key);
    const label = info ? info.label : '';
    if (md) S.needResp(md);
    const resp = md ? S.respModel.get(md.executionId) : null;
    const lastResp = !resp && key ? S.enumResp.get(key) : '';   // 这个模型上次查到的接口名
    const cfg = cfgName(md, key);
    const shown = (resp && resp.name) || lastResp || cfg;
    const pieces = [];
    if (label) {
      const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
      pieces.push(...(m ? [m[1], m[2]] : [label]));
    }
    let odd = false;
    if (shown) {
      const fromApi = !!(resp || lastResp);
      odd = fromApi && !!label && /^gemini/i.test(label) && shown.replace(/\./g, '-') !== baseName(label);
      pieces.push(el('span', 'tx real' + (odd ? ' odd' : '') + (fromApi && !resp ? ' prev' : ''), shown));
    }
    if (!pieces.length && tier) pieces.push(tier.replace(/^MODEL_TIER_/, '').toLowerCase().replace(/^./, (c) => c.toUpperCase()) + ' 档');
    if (!pieces.length && key) pieces.push(key.replace(/^MODEL_/, ''));
    const tip = '界面名：' + (label || '（不在模型列表里）') +
      '\n接口返回的模型：' + (resp ? resp.name + (resp.full ? '（' + resp.full + '）' : '') : lastResp ? lastResp + '（这个模型上次的结果，本次还没查到）' : '（还没查到）') +
      '\n配置名：' + (cfg || '?') + '\n编号：' + (key || '?') +
      (odd ? '\n接口返回的模型名和界面名对不上，可能是灰测版本' : '');
    return pieces.length ? seg('model', 'auto_awesome', pieces, tip) : null;
  };

  // ---------- 一次模型调用：首字、速度、token ----------
  const callSegs = (md) => {
    const mu = md && md.modelUsage;
    if (!mu) return [];
    const out = [];
    const t0 = tms(md.createdAt), t1 = tms(md.viewableAt), t2 = tms(md.finishedGeneratingAt || md.completedAt);
    if (t1 > t0) out.push(seg('timing', 'hourglass_top', [((t1 - t0) / 1000).toFixed(1) + 's'], '首字时间：从发出请求到第一个字出现（含思考）'));
    // 速度 = 输出 token（含思考）÷ 生成用时。思考 token 是在首字出现之前生成的，所以有思考时起点取
    // “首字时刻 − 思考时长”（不早于发出请求），没有思考时从首字出现算起。
    // （11-09 之前只用“首字→结束”做分母，思考 token 却算在分子里，Flash 算出过 1637 tok/s 这种错数。）
    const outTok = Number(mu.outputTokens) || 0;
    const thinkTok = Number(mu.thinkingOutputTokens) || 0;
    const thinkMs = parseFloat(md._thinkDur) * 1000;
    let start = t1;
    if (thinkTok > 0) start = thinkMs > 0 && t1 - thinkMs > t0 ? t1 - thinkMs : t0;
    if (!(start > 0)) start = t0;
    const span = t2 - start;
    if (outTok > 0 && span > 50) {
      out.push(seg('timing', 'speed', [Math.round(outTok / (span / 1000)) + ' tok/s'],
        '生成速度：输出 ' + outTok.toLocaleString() + ' token' + (thinkTok > 0 ? '（含思考 ' + thinkTok.toLocaleString() + '）' : '') +
        ' ÷ 生成用时 ' + (span / 1000).toFixed(2) + ' 秒\n' +
        (thinkTok > 0 ? '有思考：从思考开始算（' + (thinkMs > 0 ? '思考 ' + (thinkMs / 1000).toFixed(1) + ' 秒' : '没有思考时长，从发出请求算') + '）'
          : '没有思考：从首字出现算起')));
    }
    out.push(seg('tokens', 'swap_vert', [
      '输入 ' + fmtK(mu.inputTokens),
      '输出 ' + fmtK(mu.outputTokens),
      Number(mu.thinkingOutputTokens) > 0 ? '思考 ' + fmtK(mu.thinkingOutputTokens) : '',
    ], '最近一次模型调用的 token 数（输出里包含思考）'));
    return out;
  };
  const promptTokens = (mu) => (Number(mu.inputTokens) || 0) + (Number(mu.cacheReadTokens) || 0) + (Number(mu.cacheWriteTokens) || 0);
  // comps：后台压缩过上下文的步骤序号（状态流的 compactionInfo）。有压缩就在上下文这一项后面标“已压缩 N 次”。
  const ctxSeg = (ctx, mu, comps) => {
    const n = Array.isArray(comps) ? comps.length : 0;
    const compPiece = n ? el('span', 'tx comp', '已压缩 ' + n + ' 次') : null;
    const compTip = n ? '\n后台在第 ' + comps.join('、') + ' 步压缩过上下文' : '\n这个对话还没有被压缩过';
    const sent = mu ? promptTokens(mu) : 0;
    const sentTip = sent > 0 ? '\n最近一次调用实际发给模型：' + sent.toLocaleString() + ' token（输入 + 缓存读写）' : '';
    if (ctx && Number(ctx.maxContextTokens) > 0) {
      const used = Number(ctx.estimatedTokensUsed) || 0;
      const max = Number(ctx.maxContextTokens);
      const pct = Math.round((used / max) * 100);
      const detail = '上下文 ' + used.toLocaleString() + ' / ' + max.toLocaleString() + ' token' + sentTip + compTip + '\n' +
        (S.ctxLimit > 0 ? '注入器把 Gemini / Claude 的压缩上限设为 ' + S.ctxLimit.toLocaleString() +
          (S.ctxApplied ? '（最近一次：' + S.ctxApplied.model + '）' : '（这个窗口还没发过消息）') + '\n' : '') +
        (ctx.tokenGroups || []).map((g) => g.name + '：' + Number(g.numTokens).toLocaleString()).join('\n');
      return seg('context', 'data_usage', [pct + '%', fmtK(used) + ' / ' + fmtK(max), compPiece], detail, level(pct, 70, 90, 'context'));
    }
    if (sent > 0) return seg('context', 'data_usage', [fmtK(sent), compPiece], '上下文：最近一次调用发给模型的 token（输入 + 缓存读写）' + compTip);
    return null;
  };
  const cacheSeg = (mu) => {
    if (!mu || !(Number(mu.cacheReadTokens) > 0)) return null;
    const cache = Number(mu.cacheReadTokens), input = Number(mu.inputTokens) || 0;
    const hit = Math.round((cache / (cache + input)) * 100);
    return seg('cache', 'database', ['缓存 ' + fmtK(cache), hit + '% 命中'], '最近一次调用中，从缓存读取的 token 和命中率');
  };
  const runSeg = (text) => {
    const g = el('span', 'seg k-run');
    g.append(el('span', 'pulse'), el('span', 'tx', text || '生成中'));
    return g;
  };

  // ---------- 额度：5 小时 + 每周（仿 agyline：显示已用比例） ----------
  // 按当前模型选分组：Gemini 用 gemini-5h / gemini-weekly，Claude / GPT 用 3p-5h / 3p-weekly。
  // 周额度后面的 ↓12% / ↑5%：已用比例减去这周已经过去的比例（匀速用完的进度），负数说明用得比匀速慢。
  const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_MS = 7 * 86400e3;
  const fmtWhen = (ms) => {
    const d = new Date(ms);
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === new Date().toDateString()) return hm;
    if (ms - Date.now() < WEEK_MS - 86400e3) return WEEKDAY[d.getDay()] + ' ' + hm;
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
  };
  const quotaSegs = (key) => {
    if (!S.quota || !Array.isArray(S.quota.groups)) return [];
    const label = (S.models.get(key) || {}).label || '';
    const fam = !label || /^gemini/i.test(label) ? 'gemini-' : '3p-';
    const list = [];
    for (const g of S.quota.groups) {
      for (const b of g.buckets || []) {
        if (String(b.bucketId || '').startsWith(fam) && !b.disabled && Number(b.remainingFraction) >= 0) list.push({ g, b });
      }
    }
    list.sort((x, y) => (x.b.window === 'weekly') - (y.b.window === 'weekly')); // 5 小时在前
    return list.map(({ g, b }) => {
      const used = Math.max(0, Math.min(1, 1 - Number(b.remainingFraction)));
      const pct = Math.round(used * 100);
      const reset = tms(b.resetTime);
      const weekly = b.window === 'weekly';
      const k = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'quota';
      const pieces = [cells(used, k), pct + '%', reset > 0 ? fmtWhen(reset) : ''];
      let paceText = '';
      if (weekly && reset > 0) {
        const elapsed = 1 - Math.max(0, Math.min(1, (reset - Date.now()) / WEEK_MS));
        const d = Math.round((used - elapsed) * 100);
        if (d !== 0) {
          pieces.push(el('span', 'tx ' + (d < 0 ? 'pace-ok' : 'pace-hi'), (d < 0 ? '↓' : '↑') + Math.abs(d) + '%'));
          paceText = '\n这周已过去 ' + Math.round(elapsed * 100) + '%，用量比匀速' + (d < 0 ? '慢 ' : '快 ') + Math.abs(d) + ' 个百分点';
        }
      }
      const tip = (g.displayName || '') + '：' + (weekly ? '每周' : '5 小时') + '额度已用 ' + pct + '%' +
        (reset > 0 ? '，' + new Date(reset).toLocaleString() + ' 重置' : '') + paceText;
      return seg('quota', weekly ? 'event' : 'schedule', pieces, tip, k);
    });
  };

  const MAX_SUBS = 4;
  // 输入框所在窗格的对话 ID：主窗格的上层元素 conversation-view 带 data-cascade-id；
  // 右侧子代理窗格的输入框上层没有，要在附近找 subagent-tab-conversation。
  // 只认这两种元素：侧栏对话列表项（conversation-row-sidebar）也带 data-cascade-id，不能误取。都找不到返回 null（首页）。
  const PANE_SEL = '[data-testid="conversation-view"][data-cascade-id], [data-testid="subagent-tab-conversation"][data-cascade-id]';
  const paneConvId = (box) => {
    const own = box.closest(PANE_SEL);
    if (own) return own.getAttribute('data-cascade-id');
    let e = box.parentElement;
    for (let i = 0; i < 8 && e; i++, e = e.parentElement) {
      const d = e.querySelector('[data-testid="subagent-tab-conversation"][data-cascade-id]');
      if (d) return d.getAttribute('data-cascade-id');
    }
    return null;
  };
  // 子代理是否在跑：首选后台对话摘要（S.fetchCascades，20 秒内查到的才算数）；
  // 摘要里没有这个子代理时，退回旧办法：它自己的状态流说在跑，或者主代理在跑而且它 45 秒内还有模型调用。
  const CAS_FRESH_MS = 20000;
  const subRunning = (id, root) => {
    const cs = S.casStatus.get(id);
    if (cs && cs.status && !/UNSPECIFIED/.test(cs.status) && Date.now() - cs.at < CAS_FRESH_MS) return ACTIVE.test(cs.status);
    const ag = S.agents.get(id) || {};
    return isRunning(id) || (!!root && isRunning(root) && ag.lastAt > 0 && Date.now() - ag.lastAt < 45000);
  };
  // 主窗格里要不要显示这个子代理的行（2026-11-09 改）：在跑的显示；跑完的再留 DONE_SHOW_MS 显示“完成”，然后收起。
  // 打开页面时就已经跑完的（历史子代理）不显示。之前跑完的子代理会一直占着行，直到换对话。
  const DONE_SHOW_MS = 10000;
  const subVisible = (id, root) => {
    const ph = S.subPhase.get(id);
    if (subRunning(id, root)) {
      if (!ph || !ph.running) S.subPhase.set(id, { running: true, doneAt: 0 });
      return true;
    }
    if (!ph) { S.subPhase.set(id, { running: false, doneAt: 0 }); return false; }
    if (ph.running) {
      ph.running = false;
      ph.doneAt = Date.now();
      setTimeout(() => S.render(), DONE_SHOW_MS + 300); // 到时间重画一次，把这一行收起
    }
    return ph.doneAt > 0 && Date.now() - ph.doneAt < DONE_SHOW_MS;
  };
  // inherit = 子代理沿用主代理的全部工具（不是“接管”对话）
  const agentSeg = (id, info) => seg('agent', 'smart_toy',
    [info.typeName || '子代理', info.role && info.role !== info.typeName ? info.role : '', info.inherit ? '继承' : ''],
    '子代理 ' + id +
    (info.modelTier ? '\n档次：' + info.modelTier.replace(/^MODEL_TIER_/, '') : '') +
    (info.inherit ? '\n继承：沿用主代理的全部工具' : ''));
  const stateSeg = (id, root) => {
    if (subRunning(id, root)) return runSeg('运行中');
    const ag = S.agents.get(id);
    const ph = S.subPhase.get(id);
    const at = ag && ag.lastAt > 0 ? ag.lastAt : (ph && ph.doneAt) || 0;
    if (!(at > 0)) return null;
    const d = new Date(at);
    return seg('muted', 'check', ['完成 ' + pad(d.getHours()) + ':' + pad(d.getMinutes())], '这个子代理最近一次模型调用结束的时间');
  };
  const quotaPieces = (key) => {
    const qs = quotaSegs(key);
    if (qs.length) return qs;
    const q = familyQuota(S.models.get(key)); // 拿不到 5h/每周额度时退回旧的单模型额度
    if (!q || q.remainingFraction === undefined) return [];
    const frac = Math.max(0, Math.min(1, Number(q.remainingFraction)));
    const pct = Math.round(frac * 100);
    const k = pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'quota';
    return [seg('quota', 'timelapse', [cells(frac, k), pct + '%', q.resetTime ? fmtReset(q.resetTime) + ' 重置' : ''],
      '这个模型的剩余额度' + (q.resetTime ? '，' + fmtReset(q.resetTime) + ' 重置' : ''), k)];
  };
  const toLines = (rows, cls) => rows.filter((r) => r.length).map((r) => {
    const l = el('div', 'ln' + (cls ? ' ' + cls : ''));
    l.append(...r);
    return l;
  });

  // paneId：这个输入框所在窗格的对话 ID（见 paneConvId）
  const build = (paneId) => {
    // 子代理窗格：以这个子代理为主，显示它自己的模型、上下文、缓存、首字、速度、token
    if (paneId && S.subInfo.has(paneId)) {
      const info = S.subInfo.get(paneId);
      const root = rootOf(paneId);
      const ag = S.agents.get(paneId) || {};
      const md = ag.last;
      const mu = md && md.modelUsage;
      const sconv = S.convs.get(paneId) || {};
      const line1 = [agentSeg(paneId, info), modelSeg(md, info.model, info.modelTier),
        ctxSeg(sconv.ctx, mu, sconv.compactions), cacheSeg(mu), stateSeg(paneId, root)].filter(Boolean);
      const line2 = [...callSegs(md), ...quotaPieces(modelKey(md) || info.model)];
      return toLines([line1, line2]);
    }

    const root = paneId ? rootOf(paneId) : currentRoot();
    const main = root ? S.agents.get(root) : null;
    const md = main && main.last;
    const mu = md && md.modelUsage;
    const rc = (root && S.convs.get(root)) || null;
    // 还没有模型调用（首页或新对话刚开始）：显示模型按钮当前选中的模型
    const selKey = md ? '' : selectedKey();
    const line1 = [modelSeg(md, selKey), ctxSeg(rc && rc.ctx, mu, rc && rc.compactions), cacheSeg(mu),
      root && isRunning(root) ? runSeg() : null].filter(Boolean);
    const line2 = [...callSegs(md), ...quotaPieces(modelKey(md) || selKey)];
    // 还没有模型调用时只有“模型 + 额度”，合成一行
    if (!md && line2.length) line1.push(...line2.splice(0));

    // 子代理：属于当前根对话、而且在跑（或刚跑完不到 DONE_SHOW_MS）的，运行中的排前面，其余按最近活动时间
    const subs = [];
    if (root) {
      for (const [id, info] of S.subInfo) {
        if (id === root || rootOf(id) !== root || !subVisible(id, root)) continue;
        subs.push({ id, info, ag: S.agents.get(id) || { id }, running: subRunning(id, root) });
      }
    }
    subs.sort((a, b) => (b.running - a.running) || ((b.ag.lastAt || 0) - (a.ag.lastAt || 0)));
    const subRows = subs.slice(0, MAX_SUBS).map(({ id, info, ag }) => {
      const smd = ag.last;
      const smu = smd && smd.modelUsage;
      const sconv = S.convs.get(id) || {};
      return [agentSeg(id, info), modelSeg(smd, info.model, info.modelTier), ctxSeg(sconv.ctx, smu, sconv.compactions),
        cacheSeg(smu), ...callSegs(smd), stateSeg(id, root)].filter(Boolean);
    });
    if (subs.length > MAX_SUBS) subRows.push([seg('muted', '', ['还有 ' + (subs.length - MAX_SUBS) + ' 个子代理'])]);

    const lines = toLines([line1, line2]).concat(toLines(subRows, 'sub'));
    // fetch 包装晚到（注入器在窗口打开很久后才连上，没有自动刷新）：用量（和打开时的 512K）都不生效，提示手动刷新
    if (S.early === false) {
      lines.push(...toLines([[seg('warn', '', ['按 Ctrl+R 刷新一次窗口，用量信息' + (S.ctxLimit > 0 ? '和 ' + Math.round(S.ctxLimit / 1000) + 'K 上下文' : '') + '才会生效'],
        '注入程序是在这个窗口打开之后才启动的，需要刷新一次窗口')]]));
    }
    if (!lines.length) {
      const l = el('div', 'ln');
      l.append(el('span', 'seg k-muted', S.convs.size || S.models.size ? '等待这次对话的数据…' : '等待 Antigravity 的数据…'));
      lines.push(l);
    }
    return lines;
  };

  const BAR_CLASS = 'agy-usage-bar';
  const B = '.' + BAR_CLASS;
  const style = document.createElement('style');
  style.textContent = `
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400..500,0..1,0&icon_names=auto_awesome,check,data_usage,database,event,hourglass_top,schedule,smart_toy,speed,swap_vert,timelapse&display=block");
${B}{
  --k-model:#5c64d6; --k-context:#8839ef; --k-cache:#1b8fbf; --k-timing:#c4566a; --k-tokens:#158a90;
  --k-quota:#e0620d; --k-warn:#c9800f; --k-crit:#d20f39; --k-run:#40a02b; --k-muted:#8c8fa1;
  --k-agent:#df8e1d;
  --sep:#c9c6bc; --cell-off:#e6e2d8;
  display:flex; flex-direction:column; gap:1px; padding:0 .9rem .35rem;
  font-family:"Google Sans Code","Cascadia Mono",Consolas,ui-monospace,"Microsoft YaHei UI",monospace;
  font-size:12px; line-height:1.65; font-weight:500; font-variant-numeric:tabular-nums;
  color:var(--k-muted); user-select:text; cursor:default;
}
body.theme-dark ${B}, :root[style*="color-scheme: dark"] ${B}{
  --k-model:#b4befe; --k-context:#cba6f7; --k-cache:#89dceb; --k-timing:#f2cdcd; --k-tokens:#94e2d5;
  --k-quota:#fab387; --k-warn:#f9e2af; --k-crit:#f38ba8; --k-run:#a6e3a1; --k-muted:#7f849c;
  --k-agent:#f9e2af;
  --sep:#585b70; --cell-off:#45475a;
}
/* 分隔符：每项左边留 1.6em，竖线画在这段空隙里；整行左移 1.6em 并把左边 1.6em 裁掉，
   这样窄窗口换行后，排在行首那一项的竖线正好被裁掉，不会出现“| 缓存 …”这种行首竖线 */
${B} .ln{display:flex; flex-wrap:wrap; align-items:center; row-gap:1px; margin-left:-1.6em; clip-path:inset(-6px -6px -6px 1.6em)}
${B} .seg{display:inline-flex; align-items:center; white-space:nowrap; color:var(--kc); margin-left:1.6em; position:relative}
${B} .seg::before{content:"|"; color:var(--sep); position:absolute; left:-1.05em; top:0; bottom:0; display:flex; align-items:center; font-weight:400}
${B} .ic{font-family:"Material Symbols Rounded"; font-weight:normal; font-style:normal; font-size:15px; line-height:1;
  margin-right:.35em; font-variation-settings:"FILL" 1,"wght" 500,"opsz" 20; -webkit-font-smoothing:antialiased;
  display:inline-block; width:1em; overflow:hidden; letter-spacing:normal; text-transform:none; direction:ltr}
${B} .dot{margin:0 .45em; opacity:.55}
${B} .real{opacity:.72; font-weight:400}
${B} .comp{color:var(--k-warn); font-weight:600}
${B} .pace-ok{color:var(--k-run)}
${B} .pace-hi{color:var(--k-warn)}
${B} .real.odd{opacity:1; font-weight:600; color:var(--k-warn)}
${B} .real.prev{font-style:italic}
${B} .ln.sub{margin-left:-.5em; font-size:11.5px} /* 子代理行比主代理行缩进 1.1em */
${B} .gap{display:inline-block; width:.5em}
${B} .cells{display:inline-flex; gap:2px; margin-right:.1em}
${B} .cells i{display:block; width:5px; height:10px; border-radius:1.5px; background:var(--cell-off)}
${B} .cells i.on{background:var(--kc)}
${B} .pulse{width:7px; height:7px; border-radius:50%; background:var(--kc); margin-right:.45em; animation:agyPulse 1.2s ease-in-out infinite}
@keyframes agyPulse{0%,100%{opacity:1}50%{opacity:.25}}
${B} .k-model{--kc:var(--k-model)} ${B} .k-context{--kc:var(--k-context)} ${B} .k-cache{--kc:var(--k-cache)}
${B} .k-timing{--kc:var(--k-timing)} ${B} .k-tokens{--kc:var(--k-tokens)} ${B} .k-quota{--kc:var(--k-quota)}
${B} .k-agent{--kc:var(--k-agent)} ${B} .k-warn{--kc:var(--k-warn)} ${B} .k-crit{--kc:var(--k-crit)} ${B} .k-run{--kc:var(--k-run)} ${B} .k-muted{--kc:var(--k-muted)}
`;

  // 保证每个输入框上方都有状态栏；force 时重画内容
  const ensure = (force) => {
    if (!document.body) return;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    for (const box of document.querySelectorAll('[data-testid="agent-input-box"]')) {
      let bar = box.previousElementSibling;
      let fresh = false;
      if (!bar || !bar.classList.contains(BAR_CLASS)) {
        bar = document.createElement('div');
        bar.className = BAR_CLASS;
        bar.setAttribute('data-agy-no-i18n', '');
        box.parentElement.insertBefore(bar, box);
        fresh = true;
      }
      if (force || fresh) bar.replaceChildren(...build(paneConvId(box)));
    }
  };
  let scheduled = false;
  const render = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; ensure(true); }, 150);
  };
  S.render = render;

  // 每秒检查一次：输入框被重新创建就补上状态栏，切换了对话就重画；每 30 秒重画一次（额度重置时间会变）；
  // 按需查后台对话摘要（子代理是否还在跑，见 S.fetchCascades）
  const start = () => {
    // 换掉旧版本留下的定时器、样式和状态栏
    if (S.timer) clearInterval(S.timer);
    if (S.styleEl && S.styleEl !== style) S.styleEl.remove();
    S.styleEl = style;
    document.querySelectorAll('.' + BAR_CLASS).forEach((b) => b.remove());
    let path = location.pathname;
    let sel = selectedLabel();
    if (!S.navAt) S.navAt = Date.now();
    let ticks = 0;
    S.timer = setInterval(() => {
      ticks++;
      if (ticks % 30 === 0 && (!S.quota || Date.now() - S.quota.at > 170000)) S.fetchQuota();
      const casEvery = S.casActive || (S.lastConv && isRunning(S.lastConv)) ? 3000 : 15000;
      if (S.lsHeaders && document.visibilityState !== 'hidden' && Date.now() - (S.casAskAt || 0) >= casEvery) S.fetchCascades();
      const nowSel = selectedLabel();
      if (location.pathname !== path) { path = location.pathname; S.navAt = Date.now(); sel = nowSel; ensure(true); }
      else if (nowSel !== sel || ticks % 30 === 0) { sel = nowSel; ensure(true); } // 换了模型也重画
      else ensure(false);
    }, 1000);
    render();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
