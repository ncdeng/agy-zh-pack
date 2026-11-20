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
// 不改应用发出的任何请求。2026-11-09～11-20 曾有一个可选的“解锁 512K 上下文”（给请求补
// checkpointConfig.maxTokenLimit），11-20 删掉了，原因见下面“上下文上限”一节。
//
// 旁听要在应用脚本运行前装好（注入器用 addScriptToEvaluateOnNewDocument 保证），
// 所以第一次装上后要刷新一次窗口（Ctrl+R）或重启 Antigravity 才有数据。
function agyStatusBar(CFG) {
  'use strict';
  // 再次注入时（改了本文件）：数据和旁听保留，只替换显示部分
  const S = window.__agyStats || (window.__agyStats = { convs: new Map(), models: new Map(), render: () => {} });
  const FIRST = !S.tapped;
  S.tapped = true;
  // early：fetch 包装是不是在应用脚本之前装好的（addScriptToEvaluateOnNewDocument 注入时页面还在 loading）。
  // 晚到的包装接不住应用已经建好的连接，用量不生效；注入器看到 early=false 且窗口刚打开，会自动刷新一次。
  if (FIRST) S.early = document.readyState === 'loading';
  const WATCH = /LanguageServerService\/(StreamAgentStateUpdates|GetUserStatus|RetrieveUserQuotaSummary)\b/;

  // ---------- 上下文上限：2026-11-20 删掉 ----------
  // 11-09～11-20 这里可以给 Gemini / Claude 的请求补 cascadeConfig.checkpointConfig.maxTokenLimit = 512000，
  // 把后台默认 256K 的压缩线提高到 512K。11-20 关掉开关实测（Antigravity 2.33.0）：官方默认已经提高，
  // Gemini 4 Neon / Carbon 是 512k，Claude Opus 5.5 是 840k；再补 512000 反而把 Claude 压低，所以整段删掉。
  // 已打开的窗口热更新到这一版后，fetch 包装调的是新的 S.beforeFetch（不再改请求）；这里顺便清掉旧版留下的字段。
  delete S.rewrite;
  delete S.ctxLimit;
  delete S.ctxApplied;
  const enc = new TextEncoder(); // 自己查额度时拼 grpc-web 帧用
  const dec8 = new TextDecoder();

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
  S.casMeta = S.casMeta || new Map();     // cascadeId → { created, modified }：后台对话摘要里的创建 / 最后修改时间（算“今天”用）
  S.subPhase = S.subPhase || new Map();   // 子代理 cascadeId → { running, doneAt }：本页面看到它从运行到结束的时刻（见 subVisible）
  S.execModel = S.execModel || new Map(); // executionId → 后台实际模型名（plannerConfig.modelName）
  S.execAt = S.execAt || new Map();       // executionId → 这次调用开始的时间（费用估算按它选价）
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
      if (md.executionId) S.execAt.set(md.executionId, tms(md.createdAt));
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

  // 2026-11-20：收到的数据块先排队，凑够一整帧才拼一次。原来每来一块就把已收到的全部重新拷贝一遍，
  // 打开长对话时第一帧有好几 MB、分几十块到，拷贝量是平方级的。
  S.tap = (method, stream) => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    const chunks = [];
    let have = 0;
    const take = (n) => { // 从队头取出 n 个字节：在第一块里就直接切，跨块才拷贝
      const c0 = chunks[0];
      if (c0.length >= n) {
        if (c0.length === n) chunks.shift(); else chunks[0] = c0.subarray(n);
        have -= n;
        return c0.subarray(0, n);
      }
      const out = new Uint8Array(n);
      let off = 0;
      while (off < n) {
        const c = chunks[0];
        const k = Math.min(c.length, n - off);
        out.set(c.subarray(0, k), off);
        off += k;
        if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
      }
      have -= n;
      return out;
    };
    const head = () => { // 帧头 5 字节（可能跨块），不取出
      let h = chunks[0];
      if (h.length < 5) {
        h = new Uint8Array(5);
        let off = 0;
        for (const c of chunks) { const k = Math.min(c.length, 5 - off); h.set(c.subarray(0, k), off); off += k; if (off === 5) break; }
      }
      return { flag: h[0], len: new DataView(h.buffer, h.byteOffset + 1, 4).getUint32(0) };
    };
    const pump = () => reader.read().then(({ value, done }) => {
      if (done) return;
      if (value && value.length) { chunks.push(value); have += value.length; }
      while (have >= 5) {
        const { flag, len } = head();
        if (have < 5 + len) break;
        take(5);
        const body = take(len);
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

  // 请求发出前：记下应用访问后台用的地址和请求头（自己查额度时照用）。请求本身原样发出。
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
    return init;
  };

  // 额度（5 小时、每周）：后台接口 RetrieveUserQuotaSummary。应用只在打开“查看用量”时才调，
  // 所以这里每 3 分钟自己查一次（只读，和应用发的请求一样；forceRefresh=false，用后台的缓存）。
  // 走 window.fetch（也就是上面的包装），返回结果由旁听交给 S.onMessage。
  S.fetchQuota = () => {
    if (!S.lsHeaders || !S.lsService || S.quotaPending) return;
    S.quotaPending = true;
    S.quotaAskAt = Date.now();
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
          S.casMeta.set(id, { created: tms(s.createdTime), modified: tms(s.lastModifiedTime) });
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

  // ---------- 费用估算（2026-11-16 加） ----------
  // 状态栏显示花了多少钱。后台状态流里有 cost_summary 字段（按输入/缓存/输出/思考给美元估算），
  // 但只给按量付费的企业版填，额度制账号收不到（11-16 实测 60 条更新都没有）。所以这里自己算：
  // token 数 × Google / Anthropic 公开的 API 标准价。订阅按额度扣，不按这个收钱，只是参考。
  // 单价：美元 / 百万 token。in 输入（不含缓存），cache 缓存读取，cw 缓存写入（只有 Claude 有，按 5 分钟缓存 = 输入价 × 1.25），
  // out 输出（含思考）。出处：Gemini = aistudio.google.com/docs/pricing 标准档（2026-11-16 读；Neon 2026-11-19 读）；
  // Claude = Anthropic 官方价（2026-11-03）。和 agyline 0.3.1 内置的价格对过：Argon 2 / 0.1 / 10、3.8 Flash 0.75 / 0.075 / 3.75，一致。
  // 换价时间按美国太平洋时间零点（UTC 08:00），按每次调用开始的时间选价（不知道时间就按现在）。
  const PT0 = (d) => Date.parse(d + 'T08:00:00Z');
  const P_CA = [[PT0('2026-12-01'), { in: 2, cache: 0.1, out: 10 }], [Infinity, { in: 4, cache: 0.2, out: 20 }]];
  // Gemini 4 Neon（agy 2.33.0 起有，modelId gemini-4-neon-low/medium/high/xhigh）：3 / 0.15 / 15，价格页没写以后调价。
  const P_NE = [[Infinity, { in: 3, cache: 0.15, out: 15 }]];
  const P_H = [[Infinity, { in: 1.5, cache: 0.075, out: 7.5 }]];
  const P_F38 = [[PT0('2027-01-01'), { in: 0.75, cache: 0.075, out: 3.75 }], [Infinity, { in: 1.5, cache: 0.15, out: 7.5 }]];
  // 按顺序匹配，先中先用。Orchestrator 的两个内部模型没有公开价：规划按 Carbon（Argon 版按 Argon，Neon 版按 Neon），
  // 执行模型 gemini-flash-worker-agy 按 Hydrogen：后台给它的显示名是 “Gemini 4 Hydrogen (Orchestrator)”（modelDisplayName，11-16 查），
  // 模型菜单的官方说明也写 Carbon “may offload routine steps to Hydrogen”。
  const PRICES = [
    { re: /orchestrator-neon/i, name: 'Neon', note: 'Orchestrator (Neon) 的规划调用，按 Gemini 4 Neon 价', t: P_NE },
    { re: /orchestrator-argon/i, name: 'Argon', note: 'Orchestrator (Argon) 的规划调用，按 Gemini 4 Argon 价', t: P_CA },
    { re: /orchestrator/i, name: 'Carbon', note: 'Orchestrator 的规划调用，按 Gemini 4 Carbon 价', t: P_CA },
    { re: /flash-worker/i, name: 'Hydrogen', note: '执行模型 gemini-flash-worker-agy（后台显示名 Gemini 4 Hydrogen (Orchestrator)），按 Gemini 4 Hydrogen 价', t: P_H },
    { re: /gemini-4-neon/i, name: 'Neon', t: P_NE },
    { re: /gemini-4-carbon/i, name: 'Carbon', t: P_CA },
    { re: /gemini-4-argon/i, name: 'Argon', t: P_CA },
    { re: /gemini-4-hydrogen/i, name: 'Hydrogen', t: P_H },
    { re: /gemini-3[.-]8-flash/i, name: '3.8 Flash', t: P_F38 },
    { re: /claude-opus-5[.-]5/i, name: 'Opus 5.5', t: [[Infinity, { in: 4, cache: 0.2, cw: 5, out: 20 }]] },
    { re: /claude-sonnet-5[.-]5/i, name: 'Sonnet 5.5', t: [[Infinity, { in: 2, cache: 0.1, cw: 2.5, out: 10 }]] },
  ];
  const priceFor = (names, at) => {
    const when = at > 0 ? at : Date.now();
    for (const r of PRICES) {
      if (!r.re.test(names)) continue;
      const tier = r.t.find((x) => when < x[0]) || r.t[r.t.length - 1];
      return { name: r.name, note: r.note || '', p: tier[1] };
    }
    return null;
  };
  // 一次调用用来匹配单价的名字：接口返回的模型名 + 配置名 + modelId（任一能匹配上就行）
  const callNames = (resp, key, exec) => [
    resp || '', (exec && S.execModel.get(exec)) || '', (key && S.enumModel.get(key)) || '', (key && (S.models.get(key) || {}).modelId) || '',
  ].join(' ');
  // u：状态流的 modelUsage 或 GetCascadeTrajectoryGeneratorMetadata 的 chatModel.usage（字段一样）。
  // outputTokens 已经包含思考（例：输出 214 = 思考 181 + 回复 33）；保险起见不少于“思考 + 回复”。
  const callCost = (u, names, at) => {
    if (!u) return null;
    const inp = +u.inputTokens || 0, cr = +u.cacheReadTokens || 0, cw = +u.cacheWriteTokens || 0;
    const out = Math.max(+u.outputTokens || 0, (+u.thinkingOutputTokens || 0) + (+u.responseOutputTokens || 0));
    const pr = priceFor(names, at);
    if (!pr) return { usd: null, inp, cr, cw, out };
    const p = pr.p;
    const parts = { in: inp * p.in / 1e6, cache: cr * p.cache / 1e6, cw: cw * (p.cw != null ? p.cw : p.in) / 1e6, out: out * p.out / 1e6 };
    return { usd: parts.in + parts.cache + parts.cw + parts.out, parts, pr, inp, cr, cw, out };
  };
  // 对话累计：向本机后台查 GetCascadeTrajectoryGeneratorMetadata（只读，不经过 Google，不耗额度）。
  // generatorMetadataOffset = 从第几次调用开始返回到最后；第一次从 0 取全部（63 次调用约 300 KB、10 毫秒），
  // 以后从最后一条开始补（最后一条可能是取的时候还没结束的调用，重取一次覆盖）。只留算钱要用的字段。
  S.costs = S.costs || new Map(); // cascadeId → { list: [{ exec, resp, key, usage }], busy, at, more }
  const USAGE_KEYS = ['inputTokens', 'outputTokens', 'thinkingOutputTokens', 'responseOutputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
  const slimGen = (m) => {
    const cm = (m && m.chatModel) || {};
    const u = cm.usage || {};
    const usage = {};
    for (const k of USAGE_KEYS) if (u[k] !== undefined) usage[k] = u[k];
    const st = m && Array.isArray(m.stepIndices) ? m.stepIndices[0] : undefined;
    return { exec: m && m.executionId, resp: cm.responseModel || '', key: u.model || cm.model || '', usage, step: st };
  };
  S.fetchCost = (id) => {
    const c = S.costs.get(id) || { list: [], busy: false, at: 0, more: false };
    S.costs.set(id, c);
    if (c.busy) return;
    c.busy = true;
    c.askAt = Date.now();
    const off = Math.max(0, c.list.length - 1);
    lsCall('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: id, generatorMetadataOffset: off })
      .then((j) => {
        const g = j && Array.isArray(j.generatorMetadata) ? j.generatorMetadata : null;
        if (!g) return;
        g.forEach((m, i) => { c.list[off + i] = slimGen(m); });
        c.at = Date.now();
        c.more = g.length > 1; // 一次补上了好几条：再查一次，确认已经到最后
        S.render();
      })
      .then(() => { c.busy = false; }, () => { c.busy = false; });
  };
  // 根对话 + 它下面所有子代理（含子代理的子代理）
  const treeIds = (root) => {
    const ids = new Set([root]);
    for (const id of S.subInfo.keys()) if (rootOf(id) === root) ids.add(id);
    for (const [id, r] of S.rootOf) if (r === root) ids.add(id);
    return [...ids];
  };
  // ---------- 今天花费（2026-11-16 加，仿 ccline 的 “$xx today”：今天所有对话的每次调用按单价加起来） ----------
  // 哪些对话今天动过：后台对话摘要的最后修改时间 ≥ 本地 0 点。今天创建的对话，所有调用都算今天。
  // 跨过 0 点的对话要知道每次调用的时间：调用元数据里没有，步骤里有（metadata.createdAt + executionId）。
  // GetCascadeTrajectorySteps 只能“从第 N 步取到最后”（整段可能十几 MB），所以按时间比例估一个起点往后取；
  // 取到的最早那次调用还在 0 点后，就再往前对半取。调用时间是递增的：某次调用在 0 点前，它前面的都在 0 点前。
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  S.timeBusy = S.timeBusy || new Set();
  S.timeTried = S.timeTried || new Map(); // cascadeId → 已经取过的起点（同一个起点不重复取，防止死循环）
  const timeFetchFrom = (id) => {
    const c = S.costs.get(id);
    const meta = S.casMeta.get(id);
    const d0 = dayStart();
    if (!c || !c.list.length || !meta || !(meta.created < d0) || !(meta.modified >= d0)) return null;
    const list = c.list;
    let u = list.length; // 从 u 往后的调用都知道时间
    while (u > 0 && list[u - 1] && S.execAt.has(list[u - 1].exec)) u--;
    if (u === 0) return null;
    if (u < list.length && S.execAt.get(list[u].exec) < d0) return null; // 已知最早的那次已经在 0 点前
    const frac = Math.max(0, Math.min(1, (d0 - meta.created) / Math.max(1, meta.modified - meta.created)));
    const est = Math.floor(frac * list.length - list.length * 0.1); // 估计 0 点在第几次调用，再往前留 10%
    const k = est < u - 1 ? Math.max(0, est) : Math.floor((u - 1) / 2);
    const from = list[k] && list[k].step >= 0 ? list[k].step : 0;
    const tried = S.timeTried.get(id) || new Set();
    if (tried.has(from)) return null;
    return from;
  };
  S.fetchTimes = (id, from) => {
    if (S.timeBusy.has(id)) return;
    S.timeBusy.add(id);
    const tried = S.timeTried.get(id) || new Set();
    tried.add(from);
    S.timeTried.set(id, tried);
    lsCall('GetCascadeTrajectorySteps', { cascadeId: id, stepOffset: from })
      .then((j) => {
        for (const st of (j && j.steps) || []) {
          const md = st && st.metadata;
          if (md && md.executionId && md.createdAt) S.execAt.set(md.executionId, tms(md.createdAt));
        }
        S.render();
      })
      .then(() => { S.timeBusy.delete(id); }, () => { S.timeBusy.delete(id); });
  };

  // 定时器每秒调一次：正在显示的对话树 + 今天动过的对话里，有调用在我们上次查之后结束、对话又被改过、
  // 或者还在跑（隔 5 秒）的，就补查一次调用元数据；跨 0 点的对话再补查调用时间
  S.refreshCosts = () => {
    const now = Date.now();
    const d0 = dayStart();
    const ids = new Set();
    for (const box of document.querySelectorAll('[data-testid="agent-input-box"]')) {
      const pid = paneConvId(box);
      if (pid && S.subInfo.has(pid)) { ids.add(pid); continue; }
      const r = pid ? rootOf(pid) : currentRoot();
      if (r) treeIds(r).forEach((x) => ids.add(x));
    }
    for (const [id, m] of S.casMeta) if (m.modified >= d0) ids.add(id);
    for (const id of S.todayIds || []) ids.add(id); // 注入程序从磁盘找到的今天动过的对话（见 inject.mjs 的 todayConversations）
    for (const id of ids) {
      const c = S.costs.get(id);
      if (c && (c.busy || now - (c.askAt || 0) < 1500)) continue;
      const last = (S.agents.get(id) || {}).lastAt || 0;
      const meta = S.casMeta.get(id);
      const running = isRunning(id) || ACTIVE.test((S.casStatus.get(id) || {}).status || '');
      if (!c || c.more || last > c.at || (meta && meta.modified > c.at) || (running && now - c.at > 5000)) { S.fetchCost(id); continue; }
      const from = timeFetchFrom(id);
      if (from != null) S.fetchTimes(id, from);
    }
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
    if (icon) s.append(typeof icon === 'string' ? el('span', 'ic', icon) : icon); // 也可以直接传图标元素（如费用的内联 SVG）
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
    if (!pieces.length && tier) pieces.push(tier.replace(/^MODEL_TIER_/, '').toLowerCase().replace(/^./, (c) => c.toUpperCase()) + ' tier');
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
    // 11-16 起不再单独显示“in · out · think”这一项（用处不大还占位置）；最近一次调用的 token 数在费用项的悬停说明里
    return out;
  };
  const promptTokens = (mu) => (Number(mu.inputTokens) || 0) + (Number(mu.cacheReadTokens) || 0) + (Number(mu.cacheWriteTokens) || 0);
  // comps：后台压缩过上下文的步骤序号（状态流的 compactionInfo）。有压缩就在上下文这一项后面标“已压缩 N 次”。
  const ctxSeg = (ctx, mu, comps) => {
    const n = Array.isArray(comps) ? comps.length : 0;
    const compPiece = n ? el('span', 'tx comp', 'compacted ' + n + '×') : null;
    const compTip = n ? '\n后台在第 ' + comps.join('、') + ' 步压缩过上下文' : '\n这个对话还没有被压缩过';
    const sent = mu ? promptTokens(mu) : 0;
    const sentTip = sent > 0 ? '\n最近一次调用实际发给模型：' + sent.toLocaleString() + ' token（输入 + 缓存读写）' : '';
    if (ctx && Number(ctx.maxContextTokens) > 0) {
      const used = Number(ctx.estimatedTokensUsed) || 0;
      const max = Number(ctx.maxContextTokens);
      const pct = Math.round((used / max) * 100);
      const detail = '上下文 ' + used.toLocaleString() + ' / ' + max.toLocaleString() + ' token' + sentTip + compTip + '\n' +
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
    return seg('cache', 'database', [fmtK(cache), hit + '% hit'], '最近一次调用中，从缓存读取的 token 和命中率');
  };
  const runSeg = (text) => {
    const g = el('span', 'seg k-run');
    g.append(el('span', 'pulse'), el('span', 'tx', text || 'running'));
    return g;
  };

  // ---------- 额度：5 小时 + 每周（仿 agyline：显示已用比例） ----------
  // 按当前模型选分组：Gemini 用 gemini-5h / gemini-weekly，Claude / GPT 用 3p-5h / 3p-weekly。
  // 周额度后面的 ↓12% / ↑5%：已用比例减去这周已经过去的比例（匀速用完的进度），负数说明用得比匀速慢。
  const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // 照 ccline 用英文三字母（11-16 之前是“周六”）
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
    // 2026-11-16：原来只看界面名，Orchestrator (Carbon/Argon) 被当成 Claude/GPT 组；改成先看 modelId（gemini-pro-orchestrator）
    const m = S.models.get(key) || {};
    const label = m.label || '';
    const fam = !label || /^gemini/i.test(m.modelId || '') || /^gemini/i.test(label) ? 'gemini-' : '3p-';
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

  // ---------- 费用：最近一次调用 + 这个对话累计（单价和算法见上面“费用估算”） ----------
  const fmtUsd = (v) => '$' + (v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v < 100 ? v.toFixed(2) : v.toFixed(0));
  const tokUsd = (n, price, usd) => n.toLocaleString() + ' × $' + price + '/M = ' + fmtUsd(usd);
  const treeCost = (ids) => {
    const t = { usd: 0, calls: 0, unpriced: 0, by: new Map(), cascades: 0 };
    for (const id of ids) {
      const c = S.costs.get(id);
      if (!c || !c.list.length) continue;
      t.cascades++;
      for (const g of c.list) {
        if (!g) continue;
        t.calls++;
        const cc = callCost(g.usage, callNames(g.resp, g.key, g.exec), S.execAt.get(g.exec));
        if (!cc || cc.usd == null) { t.unpriced++; continue; }
        t.usd += cc.usd;
        const b = t.by.get(cc.pr.name) || { usd: 0, n: 0 };
        b.usd += cc.usd;
        b.n++;
        t.by.set(cc.pr.name, b);
      }
    }
    return t;
  };
  // 今天花费：后台摘要里今天动过的对话，按调用时间挑出 0 点以后的调用。
  // 本地记账（localStorage）：每个对话今天的金额存下来，后台重启后摘要里没有了的对话照样算进今天；过了 0 点自动清零。
  // 页面的本地存储按端口分开，Antigravity 每次启动都换端口，所以账本同时放在 S.costBook 里，
  // 注入程序每 30 秒读走存进 cost-day.json，下次注入时通过 CFG.costDay 交回来。几份合并时同一个对话取较大的数。
  // 2026-11-20 起账本还按模型记明细（每日用量面板用）：det = { 对话 ID: { 价目名: [美元, 调用数, 输入, 缓存读, 缓存写, 输出] } }，
  // 没有单价的调用记在 'Other' 下（只记 token，不算钱）。同一个对话取调用数较多的那份。
  const DAY_KEY = 'agy.statusbar.costDay';
  const dayName = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const detCalls = (d) => { let n = 0; if (d && typeof d === 'object') for (const k in d) n += +(d[k] && d[k][1]) || 0; return n; };
  const mergeBook = (into, b) => {
    if (!b || b.day !== into.day || !b.by || typeof b.by !== 'object') return;
    if (!into.det || typeof into.det !== 'object') into.det = {};
    for (const [id, v] of Object.entries(b.by)) {
      const n = Number(v);
      if (n >= 0 && !(into.by[id] >= n)) into.by[id] = n;
    }
    if (b.det && typeof b.det === 'object') {
      for (const [id, d] of Object.entries(b.det)) {
        if (d && typeof d === 'object' && (!into.det[id] || detCalls(d) >= detCalls(into.det[id]))) into.det[id] = d;
      }
    }
  };
  const loadBook = () => {
    const day = dayName();
    if (!S.costBook || S.costBook.day !== day) {
      const book = { day, by: {}, det: {} };
      try { mergeBook(book, JSON.parse(localStorage.getItem(DAY_KEY) || 'null')); } catch (e) {}
      S.costBook = book;
    }
    mergeBook(S.costBook, CFG && CFG.costDay);
    return S.costBook;
  };
  const todayCost = () => {
    const d0 = dayStart();
    const by = {};
    const detBy = {};
    let calls = 0, undated = 0, loading = 0;
    // 今天动过的对话 = 后台摘要里最后修改时间在 0 点以后的 + 注入程序从磁盘找到的（后台还没加载、摘要里暂时没有的）
    const dayIds = new Set(S.todayIds || []);
    for (const [id, meta] of S.casMeta) if (meta.modified >= d0) dayIds.add(id);
    for (const id of dayIds) {
      const meta = S.casMeta.get(id);
      if (!meta) { loading++; continue; } // 刚让后台加载，等下一次摘要（几秒内）
      if (!(meta.modified >= d0)) continue;
      const c = S.costs.get(id);
      if (!c || !c.list.length) { loading++; continue; }
      let usd = 0;
      const det = {};
      for (const g of c.list) {
        if (!g) continue;
        let at = S.execAt.get(g.exec);
        if (at == null && meta.created >= d0) at = meta.created; // 今天创建的对话：调用都在今天
        if (at == null) { undated++; continue; }
        if (at < d0) continue;
        const cc = callCost(g.usage, callNames(g.resp, g.key, g.exec), at);
        if (!cc) continue;
        const r = det[cc.pr ? cc.pr.name : 'Other'] || (det[cc.pr ? cc.pr.name : 'Other'] = [0, 0, 0, 0, 0, 0]);
        r[1]++; r[2] += cc.inp; r[3] += cc.cr; r[4] += cc.cw; r[5] += cc.out;
        if (cc.usd == null) continue;
        r[0] += cc.usd;
        usd += cc.usd;
        calls++;
      }
      for (const r of Object.values(det)) r[0] = Math.round(r[0] * 1e6) / 1e6;
      by[id] = Math.round(usd * 1e6) / 1e6;
      detBy[id] = det;
    }
    const book = loadBook();
    const before = JSON.stringify([book.by, book.det]);
    mergeBook(book, { day: book.day, by, det: detBy });
    const after = JSON.stringify([book.by, book.det]);
    if (after !== before) { try { localStorage.setItem(DAY_KEY, JSON.stringify(book)); } catch (e) {} }
    const vals = Object.values(book.by);
    return { usd: vals.reduce((a, b) => a + b, 0), convs: vals.filter((v) => v > 0).length, calls, undated, loading };
  };
  // 今天花费要把今天所有对话的调用都算一遍，生成回复时状态栏一秒重画好几次，2 秒内的重画共用一次结果
  let dayCache = null;
  const todayCostCached = () => {
    const now = Date.now();
    const day = dayName();
    if (!dayCache || now - dayCache.at >= 2000 || dayCache.day !== day) dayCache = { at: now, day, v: todayCost() };
    return dayCache.v;
  };
  // md：最近一次调用的元数据（状态流）；ids：算累计的对话（根对话 + 子代理，或子代理窗格里只算它自己）
  const costSeg = (md, ids) => {
    const mu = md && md.modelUsage;
    const resp = md && md.executionId && S.respModel.get(md.executionId);
    const last = mu ? callCost(mu, callNames(resp ? resp.name : '', modelKey(md), md.executionId), tms(md.createdAt)) : null;
    const tot = ids && ids.length ? treeCost(ids) : null;
    // 照哈雷 ccline 的写法（11-16 起状态栏上的字用英文，图标也照 ccline）：
    //   [气泡$] $13.67  |  [日历] $13.70 today
    // 第一项是这个对话累计（没有就显示最近一次调用），第二项是今天花费；明细放在各自的悬停说明里。只占两项，状态栏仍是两行。
    const shown = tot && tot.calls ? tot.usd : last && last.usd != null ? last.usd : null;
    const day = todayCostCached();
    const out = [];
    let tip = shown == null ? '' : (tot && tot.calls ? '这个对话累计 ' : '最近一次调用 ') + fmtUsd(shown) + '（按 API 标准价）';
    if (last && last.usd != null) {
      const p = last.pr.p;
      tip += '\n\n最近一次调用 ' + fmtUsd(last.usd) + '（按 ' + last.pr.name + ' 价）' +
        '\n  输入 ' + tokUsd(last.inp, p.in, last.parts.in) +
        (last.cr ? '\n  缓存读取 ' + tokUsd(last.cr, p.cache, last.parts.cache) : '') +
        (last.cw ? '\n  缓存写入 ' + tokUsd(last.cw, p.cw != null ? p.cw : p.in, last.parts.cw) : '') +
        '\n  输出（含思考）' + tokUsd(last.out, p.out, last.parts.out);
    } else if (last) tip += '\n\n最近一次调用的模型没有单价，没有算钱';
    if (tot && tot.calls) {
      tip += '\n\n这个对话' + (tot.cascades > 1 ? '（含 ' + (tot.cascades - 1) + ' 个子代理）' : '') + '：' + fmtUsd(tot.usd) +
        '，共 ' + tot.calls + ' 次调用' +
        [...tot.by].sort((a, b) => b[1].usd - a[1].usd).map(([n, b]) => '\n  ' + n + '：' + fmtUsd(b.usd) + '（' + b.n + ' 次）').join('') +
        (tot.unpriced ? '\n  另有 ' + tot.unpriced + ' 次调用没有单价，没有算进去' : '');
    }
    if (shown != null) out.push(seg('cost', costIcon(), [fmtUsd(shown)], tip));
    // 今天没花钱、但有历史记录时也显示（$0 today），好点开看前几天
    if (day.usd > 0 || hasHistory()) {
      const dtip = '今天累计 ' + fmtUsd(day.usd) + '（按 API 标准价，本地 0 点起，' + day.convs + ' 个对话，含子代理）' +
        (day.undated ? '\n  还有 ' + day.undated + ' 次调用正在查时间，暂时没算进今天' : '') +
        (day.loading ? '\n  还有 ' + day.loading + ' 个对话正在读取' : '') +
        '\n\n点击查看每天的用量和额度';
      const ts = seg('cost', 'calendar_month', [fmtUsd(day.usd) + ' today'], dtip);
      ts.classList.add('p-open');
      ts.addEventListener('click', () => togglePanel(ts));
      out.push(ts);
    }
    return out;
  };
  // 对话花费的图标：对话气泡里镂空一个 $（仿 ccline 的 comment-dollar）。Material Symbols 没有这个图形，用内联 SVG 画。
  // $ 用遮罩挖空，透出底色，浅色 / 深色主题都不用另配颜色；遮罩 id 每个图标各用一个，避免重复。
  let costIconN = 0;
  const costIcon = () => {
    const id = 'agyCostMask' + (++costIconN);
    const span = el('span', 'ic svg');
    span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><mask id="' + id + '">' +
      '<rect width="24" height="24" fill="#fff"/>' +
      '<text x="12" y="15.4" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11.5" font-weight="700" fill="#000">$</text>' +
      '</mask></defs><path mask="url(#' + id + ')" fill="currentColor" ' +
      'd="M12 2.5C6.2 2.5 1.5 6.4 1.5 11.2c0 2.6 1.4 4.9 3.6 6.5l-.9 3.8 4.6-2.1c1 .3 2.1.4 3.2.4 5.8 0 10.5-3.9 10.5-8.7S17.8 2.5 12 2.5z"/></svg>';
    return span;
  };
  const safeCost = (md, ids) => { try { return costSeg(md, ids); } catch (e) { return []; } }; // 出错只少这一项，不影响整条状态栏

  // ---------- 每日用量面板（2026-11-20 加）：点状态栏上的 “$x today” 打开 ----------
  // 过去的天数来自注入程序的 usage-history.json：它每 30 秒把最近 31 天推到 S.history，注入时也经 CFG.history 带过来。
  // 一天的记录：{ usd, convs, models: { 价目名: [美元, 调用数, 输入, 缓存读, 缓存写, 输出] }, quota: { 桶 ID: 额度记录 } }。
  // 额度记录 { n 组名, w 窗口, f 当天起点, l 最近一次, a 当天重置前已累计, m 当天最高 }（都是已用比例 0～1），
  // 当天用掉的每周额度 = a + l − f（注入程序按观察到的变化累计，见 inject.mjs 的 noteQuota）。今天这一行的钱和 token 用页面里实时的账本。
  if (CFG && CFG.history && CFG.history.days && (!S.history || (+CFG.history.at || 0) > (+S.history.at || 0))) S.history = CFG.history;
  const PANEL_CLASS = 'agy-usage-panel';
  const P = '.' + PANEL_CLASS;
  if (!S.panelDays) S.panelDays = 7;
  // 每个价目名一种颜色（白底上不用黄色和浅灰）
  const MODEL_COLOR = { Neon: 'model', Carbon: 'context', Argon: 'argon', Hydrogen: 'tokens', '3.8 Flash': 'cache', 'Opus 5.5': 'quota', 'Sonnet 5.5': 'run' };
  const GROUPS = [['gemini', 'Gemini'], ['3p', 'Claude']]; // 额度分组：桶 ID 的前缀（gemini-… / 3p-…）
  const modelGroup = (name) => (name === 'Other' ? '' : /Opus|Sonnet/.test(name) ? '3p' : 'gemini');
  const hasHistory = () => !!(S.history && S.history.days && Object.keys(S.history.days).length);
  const sumDet = (det) => {
    const models = {};
    for (const d of Object.values(det || {})) {
      if (!d || typeof d !== 'object') continue;
      for (const [name, r] of Object.entries(d)) {
        if (!Array.isArray(r)) continue;
        const m = models[name] || (models[name] = [0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 6; i++) m[i] += +r[i] || 0;
      }
    }
    return models;
  };
  const dayRecord = (name) => {
    const h = (S.history && S.history.days && S.history.days[name]) || null;
    if (name !== dayName()) return h;
    const book = loadBook();
    const vals = Object.values(book.by || {}).map(Number).filter((v) => v >= 0);
    const live = { usd: vals.reduce((a, b) => a + b, 0), convs: vals.filter((v) => v > 0).length, models: sumDet(book.det) };
    return Object.assign({}, h || {}, h && h.usd > live.usd ? {} : live);
  };
  const lastDays = (n) => { // 今天在前
    const out = [];
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    for (let i = 0; i < n; i++) { out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); d.setDate(d.getDate() - 1); }
    return out;
  };
  const qUsed = (q) => Math.max(0, (+q.a || 0) + (+q.l || 0) - (+q.f || 0));
  // 一组额度在某一天：wk = 当天用掉的每周额度（0～1，没有记录是 null），peak = 当天 5 小时额度的最高值
  const groupQuota = (rec, grp) => {
    let wk = null, peak = null, name = '';
    for (const [id, q] of Object.entries((rec && rec.quota) || {})) {
      if (!q || !String(id).startsWith(grp + '-')) continue;
      if (q.w === 'weekly') { wk = Math.max(wk || 0, qUsed(q)); name = q.n || name; } else peak = Math.max(peak || 0, +q.m || 0);
    }
    return { wk, peak, name };
  };
  const liveWeekly = (grp) => { // 现在这一组的每周额度已用比例（状态栏查到的）
    let v = null;
    for (const g of (S.quota && S.quota.groups) || []) {
      for (const b of g.buckets || []) {
        if (String(b.bucketId || '').startsWith(grp + '-') && b.window === 'weekly' && !b.disabled && Number(b.remainingFraction) >= 0) {
          v = Math.max(v || 0, 1 - Number(b.remainingFraction));
        }
      }
    }
    return v;
  };
  const recTokens = (r) => {
    const t = [0, 0, 0, 0, 0]; // 调用数、输入、缓存读、缓存写、输出
    for (const m of Object.values((r && r.models) || {})) for (let i = 0; i < 5; i++) t[i] += +m[i + 1] || 0;
    return t;
  };
  const pctTx = (f) => (f * 100 < 10 ? (f * 100).toFixed(1) : String(Math.round(f * 100))) + '%';
  const dayLabel = (name) => { const d = new Date(name + 'T12:00:00'); return { wd: WEEKDAY[d.getDay()], md: (d.getMonth() + 1) + '-' + d.getDate(), d: String(d.getDate()) }; };
  const dayTip = (name, r) => {
    const lb = dayLabel(name);
    if (!r) return lb.md + ' ' + lb.wd + '：没有记录';
    const models = Object.entries(r.models || {}).sort((a, b) => b[1][0] - a[1][0]);
    let shown = 0;
    let s = lb.md + ' ' + lb.wd + '：' + fmtUsd(r.usd || 0) + '（按 API 标准价折算），' + (r.convs || 0) + ' 个对话';
    for (const [n, m] of models) { shown += m[0]; s += '\n  ' + n + '：' + fmtUsd(m[0]) + '（' + m[1] + ' 次调用）'; }
    if ((r.usd || 0) - shown > 0.0005) s += '\n  没有按模型拆开的部分：' + fmtUsd(r.usd - shown);
    for (const [grp, label] of GROUPS) {
      const q = groupQuota(r, grp);
      if (q.wk != null) s += '\n' + (q.name || label) + '：当天用掉每周额度 ' + pctTx(q.wk) + (q.peak != null ? '，5 小时额度最高到 ' + pctTx(q.peak) : '');
    }
    return s;
  };

  // 柱子里一段（一个模型在一天里）的悬停说明
  const partTip = (nm, name, m, dayUsd) => {
    const lb = dayLabel(nm);
    let s = lb.md + ' ' + lb.wd + ' · ' + name + '\n' + fmtUsd(m[0]) + (dayUsd > 0 ? '（占当天 ' + Math.round(m[0] / dayUsd * 100) + '%）' : '');
    if (m[1]) s += '，' + m[1] + ' 次调用';
    if (m[2] || m[3] || m[5]) s += '\n输入 ' + fmtK(m[2]) + ' · 缓存读取 ' + fmtK(m[3]) + (m[4] ? ' · 缓存写入 ' + fmtK(m[4]) : '') + ' · 输出 ' + fmtK(m[5]);
    if (m[2] + m[3] > 0) s += '\n缓存命中 ' + Math.round(m[3] / (m[2] + m[3]) * 100) + '%';
    return s;
  };
  const renderPanel = (panel) => {
    const n = S.panelDays;
    const recs = lastDays(n).map((nm) => ({ nm, r: dayRecord(nm) }));
    panel.replaceChildren();
    const head = el('div', 'p-head');
    const title = el('span', 'p-title', 'Daily usage');
    title.title = '每天的用量：钱按 API 标准价折算（不是实际扣费），额度是当天用掉的每周额度';
    head.append(title);
    for (const k of [7, 30]) {
      const b = el('button', 'p-btn' + (k === n ? ' on' : ''), k + 'd');
      b.title = '最近 ' + k + ' 天';
      b.addEventListener('click', () => { S.panelDays = k; renderPanel(panel); });
      head.append(b);
    }
    const x = el('button', 'p-btn p-x', '×');
    x.title = '关闭（Esc）';
    x.addEventListener('click', closePanel);
    head.append(el('span', 'p-fill'), x);
    panel.append(head);

    // 柱状图：左旧右新，按模型分颜色叠起来
    const max = Math.max(1e-6, ...recs.map(({ r }) => (r && r.usd) || 0));
    const chart = el('div', 'p-chart');
    const labels = el('div', 'p-labels');
    const seen = new Set();
    for (const { nm, r } of recs.slice().reverse()) {
      const col = el('div', 'p-col');
      col.title = dayTip(nm, r);
      const stack = el('div', 'p-stack');
      let shown = 0;
      for (const [name, m] of Object.entries((r && r.models) || {}).filter(([, m]) => m[0] > 0).sort((a, b) => b[1][0] - a[1][0])) {
        const part = el('div', 'p-part k-' + (MODEL_COLOR[name] || 'muted'));
        part.style.height = (m[0] / max * 100) + '%';
        part.dataset.m = name;
        part.title = partTip(nm, name, m, r.usd);
        stack.append(part);
        shown += m[0];
        seen.add(name);
      }
      const rest = ((r && r.usd) || 0) - shown;
      if (rest > 0.0005) {
        const part = el('div', 'p-part k-muted');
        part.style.height = (rest / max * 100) + '%';
        part.dataset.m = 'Other';
        part.title = dayLabel(nm).md + ' ' + dayLabel(nm).wd + ' · 没有按模型拆开的部分\n' + fmtUsd(rest);
        stack.append(part);
        seen.add('Other');
      }
      col.append(stack);
      chart.append(col);
      const lb = dayLabel(nm);
      labels.append(el('span', nm === dayName() ? 'today' : '', n <= 7 ? lb.wd : lb.d));
    }
    panel.append(chart, labels);
    if (seen.size) {
      const legend = el('div', 'p-legend');
      // 鼠标停在图例上：每一天里这个模型的那一段都高亮，其他段变淡
      for (const name of [...Object.keys(MODEL_COLOR), 'Other'].filter((x) => seen.has(x))) {
        const it = el('span', 'k-' + (MODEL_COLOR[name] || 'muted'));
        it.append(el('i'), el('span', '', name));
        it.title = '这段时间里 ' + name + ' 的花费在柱子里高亮';
        it.addEventListener('mouseenter', () => {
          chart.classList.add('focus');
          for (const p of chart.querySelectorAll('.p-part')) p.classList.toggle('hl', p.dataset.m === name);
        });
        it.addEventListener('mouseleave', () => chart.classList.remove('focus'));
        legend.append(it);
      }
      panel.append(legend);
    }

    // 表格：有记录的天，今天在最上面
    const rows = recs.filter(({ r }) => r && ((r.usd || 0) > 0 || recTokens(r)[0] > 0 || GROUPS.some(([g]) => groupQuota(r, g).wk != null)));
    if (!rows.length) {
      const empty = el('div', 'p-empty', 'no usage recorded yet');
      empty.title = '从装上这一版起开始记录，以前的天数没有数据';
      panel.append(empty);
    } else {
      const table = el('table');
      const hr = el('tr');
      const heads = [['Date', ''], ['Cost', '按 API 标准价折算的花费（不是实际扣费）'], ['Convs', '当天动过的对话数（含子代理）'], ['Calls', '模型调用次数'],
        ['In', '输入 token（不含缓存）'], ['Cache', '缓存读取 token'], ['Out', '输出 token（含思考）'], ['Hit', '缓存命中率 = 缓存读取 ÷（缓存读取 + 输入）'],
        ...GROUPS.map(([, label]) => [label + ' wk', '当天用掉了多少个百分点的' + label + '每周额度'])];
      for (const [h, tip] of heads) { const th = el('th', '', h); if (tip) th.title = tip; hr.append(th); }
      table.append(hr);
      for (const { nm, r } of rows) {
        const t = recTokens(r);
        const tr = el('tr', nm === dayName() ? 'today' : '');
        const lb = dayLabel(nm);
        const td0 = el('td', '', lb.md + ' ' + lb.wd);
        td0.title = dayTip(nm, r);
        const hit = t[1] + t[2] > 0 ? Math.round(t[2] / (t[1] + t[2]) * 100) + '%' : '—';
        tr.append(td0, el('td', 'c', fmtUsd(r.usd || 0)), el('td', '', String(r.convs || 0)), el('td', '', String(t[0])),
          el('td', '', fmtK(t[1])), el('td', '', fmtK(t[2])), el('td', '', fmtK(t[4])), el('td', 'h', hit));
        for (const [grp] of GROUPS) {
          const q = groupQuota(r, grp);
          const td = el('td', 'q', q.wk == null ? '—' : '+' + pctTx(q.wk));
          if (q.peak != null) td.title = '5 小时额度当天最高 ' + pctTx(q.peak);
          tr.append(td);
        }
        table.append(tr);
      }
      const wrap = el('div', 'p-table');
      wrap.append(table);
      panel.append(wrap);
    }

    // 底部：这段时间的合计；每组额度：现在用了多少、这段时间用掉多少、折算下来 1% 每周额度大约值多少钱
    const foot = el('div', 'p-foot');
    const usedDays = recs.filter(({ r }) => r && r.usd > 0);
    const total = usedDays.reduce((a, { r }) => a + r.usd, 0);
    const l1 = el('div', 'k-cost', 'last ' + n + 'd ' + fmtUsd(total) + (usedDays.length ? ' · avg ' + fmtUsd(total / usedDays.length) + '/day · ' + usedDays.length + ' days' : ''));
    l1.title = '最近 ' + n + ' 天合计（按 API 标准价折算）；平均值只算有用量的天';
    foot.append(l1);
    for (const [grp, label] of GROUPS) {
      let wk = 0, wkDays = 0, usd = 0;
      for (const { r } of recs) {
        const q = groupQuota(r, grp);
        if (q.wk == null) continue;
        wk += q.wk;
        wkDays++;
        for (const [name, m] of Object.entries((r && r.models) || {})) if (modelGroup(name) === grp) usd += m[0];
      }
      const now = liveWeekly(grp);
      if (now == null && !wkDays) continue;
      const parts = [label + ' weekly'];
      if (now != null) parts.push('now ' + Math.round(now * 100) + '%');
      if (wkDays) parts.push('+' + pctTx(wk) + ' in ' + n + 'd');
      if (wk >= 0.02 && usd > 0) parts.push('≈ ' + fmtUsd(usd / (wk * 100)) + ' per 1%');
      const line = el('div', 'k-quota', parts.join(' · '));
      line.title = label + ' 组每周额度：现在已用 ' + (now != null ? Math.round(now * 100) + '%' : '（还没查到）') +
        (wkDays ? '；最近 ' + n + ' 天里有记录的 ' + wkDays + ' 天共用掉 ' + pctTx(wk) : '') +
        (wk >= 0.02 && usd > 0 ? '\n这几天' + label + '模型折算 ' + fmtUsd(usd) + '，平均每 1% 每周额度约 ' + fmtUsd(usd / (wk * 100)) +
          '\n只是估算：钱按 API 标准价折算；额度按注入程序观察到的变化累计，Antigravity 没开着时用掉的额度会算到下次观察到的那一天' : '');
      foot.append(line);
    }
    panel.append(foot);
  };
  // 背景色取输入框一带不透明的颜色，和当前主题一致；取不到用 CSS 里的默认色
  const solidBg = (start) => {
    for (let e = start; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
    }
    return '';
  };
  const placePanel = (panel) => {
    const bar = S.panelBar && S.panelBar.isConnected ? S.panelBar : document.querySelector(B);
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const w = Math.min(760, Math.max(r.width, 520), window.innerWidth - 24);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    panel.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
    panel.style.maxHeight = Math.max(180, r.top - 24) + 'px';
    const bg = solidBg(bar.nextElementSibling) || solidBg(bar);
    if (bg) panel.style.background = bg;
  };
  const closePanel = () => {
    document.querySelectorAll(P).forEach((p) => p.remove());
    if (S.panelOutside) document.removeEventListener('mousedown', S.panelOutside, true);
    if (S.panelKey) document.removeEventListener('keydown', S.panelKey, true);
    S.panelOutside = S.panelKey = null;
  };
  const togglePanel = (anchor) => {
    if (document.querySelector(P)) { closePanel(); return; }
    const p = el('div', PANEL_CLASS);
    p.setAttribute('data-agy-no-i18n', '');
    document.body.append(p);
    S.panelBar = anchor.closest(B);
    placePanel(p);
    try { renderPanel(p); } catch (e) { p.textContent = 'usage panel error: ' + e.message; }
    S.panelOutside = (ev) => { if (!p.contains(ev.target) && !(ev.target.closest && ev.target.closest('.p-open'))) closePanel(); };
    S.panelKey = (ev) => { if (ev.key === 'Escape') closePanel(); };
    document.addEventListener('mousedown', S.panelOutside, true);
    document.addEventListener('keydown', S.panelKey, true);
  };
  const refreshPanel = () => {
    const p = document.querySelector(P);
    if (!p) return;
    placePanel(p);
    try { renderPanel(p); } catch (e) { p.textContent = 'usage panel error: ' + e.message; }
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
    [info.typeName || 'subagent', info.role && info.role !== info.typeName ? info.role : '', info.inherit ? 'inherit' : ''],
    '子代理 ' + id +
    (info.modelTier ? '\n档次：' + info.modelTier.replace(/^MODEL_TIER_/, '') : '') +
    (info.inherit ? '\n继承：沿用主代理的全部工具' : ''));
  const stateSeg = (id, root) => {
    if (subRunning(id, root)) return runSeg('running');
    const ag = S.agents.get(id);
    const ph = S.subPhase.get(id);
    const at = ag && ag.lastAt > 0 ? ag.lastAt : (ph && ph.doneAt) || 0;
    if (!(at > 0)) return null;
    const d = new Date(at);
    return seg('muted', 'check', ['done ' + pad(d.getHours()) + ':' + pad(d.getMinutes())], '这个子代理最近一次模型调用结束的时间');
  };
  const quotaPieces = (key) => {
    const qs = quotaSegs(key);
    if (qs.length) return qs;
    const q = familyQuota(S.models.get(key)); // 拿不到 5h/每周额度时退回旧的单模型额度
    if (!q || q.remainingFraction === undefined) return [];
    const frac = Math.max(0, Math.min(1, Number(q.remainingFraction)));
    const pct = Math.round(frac * 100);
    const k = pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'quota';
    return [seg('quota', 'timelapse', [cells(frac, k), pct + '%', q.resetTime ? fmtReset(q.resetTime) : ''],
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
        ctxSeg(sconv.ctx, mu, sconv.compactions), cacheSeg(mu), ...safeCost(md, [paneId]), stateSeg(paneId, root)].filter(Boolean);
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
      ...safeCost(md, root ? treeIds(root) : []), root && isRunning(root) ? runSeg() : null].filter(Boolean);
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
    if (subs.length > MAX_SUBS) subRows.push([seg('muted', '', ['+' + (subs.length - MAX_SUBS) + ' more subagents'])]);

    const lines = toLines([line1, line2]).concat(toLines(subRows, 'sub'));
    // fetch 包装晚到（注入器在窗口打开很久后才连上，没有自动刷新）：用量不生效，提示手动刷新
    if (S.early === false) {
      lines.push(...toLines([[seg('warn', '', ['Press Ctrl+R to reload this window and enable usage stats'],
        '注入程序是在这个窗口打开之后才启动的，需要刷新一次窗口')]]));
    }
    if (!lines.length) {
      const l = el('div', 'ln');
      l.append(el('span', 'seg k-muted', S.convs.size || S.models.size ? 'waiting for conversation data…' : 'waiting for Antigravity data…'));
      lines.push(l);
    }
    return lines;
  };

  const BAR_CLASS = 'agy-usage-bar';
  const B = '.' + BAR_CLASS;
  const style = document.createElement('style');
  style.textContent = `
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400..500,0..1,0&icon_names=auto_awesome,calendar_month,check,data_usage,database,event,hourglass_top,schedule,smart_toy,speed,timelapse&display=block");
${B}, ${P}{
  --k-model:#5c64d6; --k-context:#8839ef; --k-cache:#1b8fbf; --k-timing:#c4566a; --k-tokens:#158a90;
  --k-quota:#e0620d; --k-warn:#c9800f; --k-crit:#d20f39; --k-run:#40a02b; --k-muted:#8c8fa1;
  --k-agent:#df8e1d; --k-cost:#c03d8e; --k-argon:#1e66f5;
  --sep:#c9c6bc; --cell-off:#e6e2d8; --p-bg:#fffefb;
}
${B}{
  display:flex; flex-direction:column; gap:1px; padding:0 .9rem .35rem;
  font-family:"Google Sans Code","Cascadia Mono",Consolas,ui-monospace,"Microsoft YaHei UI",monospace;
  font-size:12px; line-height:1.65; font-weight:500; font-variant-numeric:tabular-nums;
  color:var(--k-muted); user-select:text; cursor:default;
}
body.theme-dark ${B}, :root[style*="color-scheme: dark"] ${B}, body.theme-dark ${P}, :root[style*="color-scheme: dark"] ${P}{
  --k-model:#b4befe; --k-context:#cba6f7; --k-cache:#89dceb; --k-timing:#f2cdcd; --k-tokens:#94e2d5;
  --k-quota:#fab387; --k-warn:#f9e2af; --k-crit:#f38ba8; --k-run:#a6e3a1; --k-muted:#7f849c;
  --k-agent:#f9e2af; --k-cost:#f5c2e7; --k-argon:#89b4fa; --p-bg:#1e1e2e;
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
${B} .ic.svg{display:inline-flex; align-items:center; overflow:visible}
${B} .ic.svg svg{width:1em; height:1em; display:block}
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
${B} .k-agent{--kc:var(--k-agent)} ${B} .k-cost{--kc:var(--k-cost)} ${B} .k-warn{--kc:var(--k-warn)} ${B} .k-crit{--kc:var(--k-crit)} ${B} .k-run{--kc:var(--k-run)} ${B} .k-muted{--kc:var(--k-muted)}
${B} .seg.p-open{cursor:pointer}
${B} .seg.p-open:hover .tx{text-decoration:underline dotted; text-underline-offset:3px}
/* 每日用量面板（点 “$x today” 打开），浮在状态栏上方；背景色由脚本取输入框一带的颜色 */
${P}{position:fixed; z-index:2147483000; box-sizing:border-box; overflow:auto; padding:.55rem .85rem .7rem;
  border:1px solid var(--sep); border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,.18); background:var(--p-bg);
  font-family:"Google Sans Code","Cascadia Mono",Consolas,ui-monospace,"Microsoft YaHei UI",monospace;
  font-size:12px; line-height:1.55; font-weight:500; font-variant-numeric:tabular-nums; color:var(--k-muted); cursor:default}
${P} .p-head{display:flex; align-items:center; gap:.4rem; margin-bottom:.35rem}
${P} .p-title{color:var(--k-cost); font-weight:600; margin-right:.3rem}
${P} .p-fill{flex:1}
${P} .p-btn{font:inherit; color:var(--k-muted); background:transparent; border:1px solid var(--sep); border-radius:6px; padding:0 .45em; cursor:pointer; line-height:1.5}
${P} .p-btn.on{color:var(--k-cost); border-color:var(--k-cost)}
${P} .p-x{border:none; font-size:16px; padding:0 .25em}
${P} .p-chart{display:flex; align-items:stretch; gap:3px; height:92px; border-bottom:1px solid var(--sep)}
${P} .p-col{flex:1; min-width:0; display:flex}
${P} .p-col:hover{background:color-mix(in srgb, var(--sep) 25%, transparent)}
${P} .p-stack{flex:1; display:flex; flex-direction:column-reverse}
${P} .p-part{background:var(--kc); flex:none; transition:opacity .12s, filter .12s}
/* 悬停：停在哪一段就高亮哪一段，同一天的其他段变淡；停在图例上，每一天里这个模型的那一段高亮 */
${P} .p-stack:has(.p-part:hover) .p-part:not(:hover){opacity:.35}
${P} .p-part:hover{filter:brightness(1.12) saturate(1.15); box-shadow:inset 0 0 0 1.5px color-mix(in srgb, #fff 60%, transparent)}
${P} .p-chart.focus .p-part{opacity:.2}
${P} .p-chart.focus .p-part.hl{opacity:1; filter:brightness(1.08)}
${P} .p-labels{display:flex; gap:3px; margin:.15rem 0 .4rem}
${P} .p-labels span{flex:1; min-width:0; overflow:hidden; text-align:center; font-size:10.5px}
${P} .p-labels span.today{color:var(--k-cost); font-weight:600}
${P} .p-legend{display:flex; flex-wrap:wrap; gap:.15rem .9rem; margin-bottom:.45rem}
${P} .p-legend span{color:var(--kc); display:inline-flex; align-items:center}
${P} .p-legend i{display:inline-block; width:8px; height:8px; border-radius:2px; background:var(--kc); margin-right:.35em}
${P} .p-table{overflow-x:auto}
${P} table{width:100%; border-collapse:collapse}
${P} th{font-weight:500; text-align:right; padding:.05rem .5rem; border-bottom:1px solid var(--sep); white-space:nowrap}
${P} td{text-align:right; padding:.05rem .5rem; white-space:nowrap}
${P} th:first-child, ${P} td:first-child{text-align:left; padding-left:0}
${P} td.c{color:var(--k-cost)} ${P} td.h{color:var(--k-cache)} ${P} td.q{color:var(--k-quota)}
${P} tr.today td{font-weight:600}
${P} .p-empty{padding:.4rem 0}
${P} .p-foot{margin-top:.5rem; display:flex; flex-direction:column; gap:.05rem}
${P} .p-foot div{color:var(--kc)}
${P} .k-model{--kc:var(--k-model)} ${P} .k-context{--kc:var(--k-context)} ${P} .k-cache{--kc:var(--k-cache)} ${P} .k-tokens{--kc:var(--k-tokens)}
${P} .k-quota{--kc:var(--k-quota)} ${P} .k-cost{--kc:var(--k-cost)} ${P} .k-run{--kc:var(--k-run)} ${P} .k-argon{--kc:var(--k-argon)} ${P} .k-muted{--kc:var(--k-muted)}
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
  // 2026-11-20：窗口在后台（最小化或被别的窗口挡住）时不重画，记一笔，回到前台再画一次；
  // 生成回复时数据来得很密，最短 300 毫秒画一次（原来 150 毫秒）。数据照常接收，只是不画。
  let scheduled = false;
  let dirty = false;
  const hidden = () => document.visibilityState === 'hidden';
  const render = () => {
    if (hidden()) { dirty = true; return; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; ensure(true); }, 300);
  };
  S.render = render;
  const onVisible = () => { if (!hidden() && dirty) { dirty = false; render(); refreshPanel(); } };

  // 每秒检查一次：输入框被重新创建就补上状态栏，切换了对话就重画；每 30 秒重画一次（额度重置时间会变）；
  // 按需查后台对话摘要（子代理是否还在跑，见 S.fetchCascades）
  const start = () => {
    // 换掉旧版本留下的定时器、样式和状态栏
    if (S.timer) clearInterval(S.timer);
    if (S.styleEl && S.styleEl !== style) S.styleEl.remove();
    S.styleEl = style;
    document.querySelectorAll('.' + BAR_CLASS).forEach((b) => b.remove());
    closePanel(); // 旧版本开着的面板和它的监听也一起去掉
    if (S.visHandler) document.removeEventListener('visibilitychange', S.visHandler);
    S.visHandler = onVisible;
    document.addEventListener('visibilitychange', onVisible);
    let path = location.pathname;
    let sel = selectedLabel();
    if (!S.navAt) S.navAt = Date.now();
    let ticks = 0;
    S.timer = setInterval(() => {
      ticks++;
      // 按时间判断（不按 ticks）：窗口在后台时 Chromium 把定时器压到约每分钟一次，按 ticks 算会变成半小时才查一次
      if (Date.now() - (S.quotaAskAt || 0) >= 170000 && (!S.quota || Date.now() - S.quota.at > 170000)) S.fetchQuota();
      const casEvery = S.casActive || (S.lastConv && isRunning(S.lastConv)) ? 3000 : 15000;
      if (S.lsHeaders && document.visibilityState !== 'hidden' && Date.now() - (S.casAskAt || 0) >= casEvery) S.fetchCascades();
      if (S.lsHeaders && document.visibilityState !== 'hidden') { try { S.refreshCosts(); } catch (e) { /* 费用估算出错不影响其他显示 */ } }
      const nowSel = selectedLabel();
      if (location.pathname !== path) { path = location.pathname; S.navAt = Date.now(); sel = nowSel; ensure(true); }
      else if (hidden()) { if (ticks % 30 === 0) dirty = true; ensure(false); } // 后台：只保证状态栏还在，回到前台再重画
      else if (nowSel !== sel || ticks % 30 === 0) { sel = nowSel; ensure(true); } // 换了模型也重画
      else ensure(false);
      if (ticks % 30 === 0 && !hidden()) refreshPanel(); // 面板开着时每 30 秒刷新一次（注入程序也是每 30 秒推一次历史）
    }, 1000);
    render();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
