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
  S.execAt = S.execAt || new Map();       // executionId → 这一轮里最近见到的一次调用的时间（executionId 是一轮共用的；费用估算按它选价）
  S.stepAt = S.stepAt || new Map();       // 对话 ID → Map(步骤序号 → 这一步开始的毫秒)：给每次调用定日子和选价（11-25 加，见 callTimes）
  const stepMap = (id) => { let m = S.stepAt.get(id); if (!m) { m = new Map(); S.stepAt.set(id, m); } return m; };
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
  // ---------- 活动（2026-11-22 加，v1.6）：每个对话（含子代理）最近的步骤，给活动行和子代理行用 ----------
  // 状态流的 stepsUpdate 里，steps[i] 是第 indices[i] 步，totalLength 是这条轨迹一共多少步。
  // 只记类型、状态、工具名、一句说明（最多 80 字）和时间，每个对话只留最近 ACT_KEEP 步；
  // 思考只留最近一段的小标题（或开头一句）和末尾约 400 字，给活动行和悬停说明用。都只在页面内存里，不存盘、不外传。
  // 步骤状态（11-22 实测）：模型回复输出中是 GENERATING，工具调用 PENDING → RUNNING → DONE，出错是 ERROR。
  if (!S.act) S.act = new Map();
  const ACT_KEEP = 40;
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const fileBase = (p) => {
    let s = String(p || '').replace(/^file:\/+/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* 不是合法的 URI 编码就原样用 */ }
    return s.split(/[\\/]/).filter(Boolean).pop() || '';
  };
  // 一步做了什么：run_command 用模型自己写的 toolSummary；其他工具按参数拼一句。
  // 参数在哪（11-22 采集）：状态流里是 GENERIC 步骤，进行中参数在 generic.args（对象），完成后具体内容在
  // generic.result.payload（runCommand / viewFile / codeAction …）；GetCascadeTrajectorySteps 取到的是具体类型，
  // 参数在 metadata.toolCall.argumentsJson（字符串）。
  const stepLabel = (st0, md, type) => {
    const tc = md.toolCall || {};
    const g = st0.generic || {};
    const st = (g.result && g.result.payload) || st0;
    let a = g.args && typeof g.args === 'object' ? g.args : {};
    if (!Object.keys(a).length) { try { a = JSON.parse(tc.argumentsJson || '{}') || {}; } catch (e) { a = {}; } }
    const name = tc.name || '';
    if (a.toolSummary) return { tool: name || 'tool', text: clip(a.toolSummary, 80) };
    if (type === 'RUN_COMMAND') return { tool: 'run_command', text: clip((st.runCommand && st.runCommand.commandLine) || a.CommandLine, 70) };
    if (type === 'VIEW_FILE') return { tool: name || 'read_file', text: fileBase((st.viewFile && st.viewFile.absolutePathUri) || a.Path) };
    if (type === 'CODE_ACTION') return { tool: name || 'edit_file', text: fileBase(a.Path || a.TargetFile || a.path) };
    if (type === 'SEARCH_WEB') return { tool: 'search_web', text: clip((st.searchWeb && st.searchWeb.query) || a.query, 60) };
    if (type === 'INVOKE_SUBAGENT') return { tool: 'invoke_subagent', text: clip(a.Role || a.TypeName || '', 50) };
    if (type === 'PLANNER_RESPONSE' || type === 'USER_INPUT') return { tool: '', text: '' };
    return { tool: name || type.toLowerCase(), text: clip(a.toolSummary || a.Task || a.task || '', 60) };
  };
  // 状态流里的工具步骤类型都是 GENERIC（11-22 采集），工具名在 metadata.toolCall.name，参数不在流里；
  // 用 GetCascadeTrajectorySteps 取到的是具体类型（RUN_COMMAND 等）和完整参数。这里把工具名换回具体类型，计数时两边一致。
  const TOOL_TYPE = { run_command: 'RUN_COMMAND', read_file: 'VIEW_FILE', view_file: 'VIEW_FILE', edit_file: 'CODE_ACTION', write_file: 'CODE_ACTION',
    search_web: 'SEARCH_WEB', invoke_subagent: 'INVOKE_SUBAGENT' };
  // 流里的工具步骤没有参数，活动行只能写工具名：第一次见到时向本机后台补取这一步的参数（只取一次，只读，不经过 Google）。
  // 补回来的只填说明文字，不改状态（补取的结果可能比流里的旧）。
  S.argAsked = S.argAsked || new Set();
  const askArgs = (id, idx) => {
    const k = id + '#' + idx;
    if (S.argAsked.has(k) || !S.lsHeaders || idx < 0) return;
    S.argAsked.add(k);
    if (S.argAsked.size > 600) S.argAsked = new Set([...S.argAsked].slice(-300));
    setTimeout(() => {
      lsCall('GetCascadeTrajectorySteps', { cascadeId: id, stepOffset: idx }).then((j) => {
        const steps = (j && j.steps) || [];
        steps.slice(0, 6).forEach((st, i) => { try { noteAct(st, (st && st.metadata) || {}, id, idx + i, 0, true); } catch (e) { /* 跳过 */ } });
        S.render();
      }).catch(() => {});
    }, 400);
  };
  const noteAct = (st, md, convId, idx, total, textOnly) => {
    const src = md.sourceTrajectoryStepInfo;
    const id = (src && src.cascadeId) || convId;
    const a = S.act.get(id) || { steps: new Map(), total: 0, turnAt: 0 };
    let type = String(st.type || '').replace('CORTEX_STEP_TYPE_', '');
    if (type === 'SYSTEM_MESSAGE') return;
    const toolName = (md.toolCall && md.toolCall.name) || '';
    if (type === 'GENERIC' && TOOL_TYPE[toolName]) type = TOOL_TYPE[toolName];
    const status = String(st.status || '').replace('CORTEX_STEP_STATUS_', '');
    const key = idx >= 0 ? idx : a.steps.size ? Math.max(...a.steps.keys()) + 1 : 0;
    const lab = stepLabel(st, md, type);
    const prev = a.steps.get(key);
    if (textOnly) { // 补取参数：只把说明文字填进已有的记录
      if (prev && !prev.text && lab.text) { prev.text = lab.text; if (lab.tool) prev.tool = lab.tool; }
      return;
    }
    const rec = { type, status, tool: lab.tool, text: lab.text, t0: tms(md.startedAt || md.createdAt), t1: tms(md.completedAt) || 0, err: !!st.error || status === 'ERROR' };
    if (prev) { // 同一步多次更新：保留补取到的说明文字和最早的开始时间
      if (!rec.text && prev.text) rec.text = prev.text;
      if (prev.t0 && (!rec.t0 || prev.t0 < rec.t0)) rec.t0 = prev.t0;
    }
    if (!rec.text && toolName && type !== 'PLANNER_RESPONSE' && /PENDING|RUNNING|WAIT/.test(status)) askArgs(id, key);
    // 一轮 = 从用户发消息起；新的一轮把计数清零。计数按步骤序号去重（同一步会多次更新）
    if (type === 'USER_INPUT') {
      const at = tms(md.createdAt) || 0;
      if (at > (a.turnAt || 0)) { a.turnAt = at; a.turnFrom = key; a.counts = {}; a.counted = new Set(); a.errored = new Set(); }
    }
    if (!a.counts) { a.counts = {}; a.counted = new Set(); a.errored = new Set(); }
    if (!a.counted.has(key) && type !== 'USER_INPUT' && (a.turnFrom === undefined || key > a.turnFrom)) {
      a.counted.add(key);
      a.counts[type] = (a.counts[type] || 0) + 1;
    }
    if (rec.err && !a.errored.has(key)) { a.errored.add(key); a.counts.ERRORS = (a.counts.ERRORS || 0) + 1; }
    if (type === 'PLANNER_RESPONSE') {
      // 思考原文生成时不在流里（11-22 采集：生成中长度一直是 0），所以活动行只写“thinking”和用时，不写思考内容
      const pr = st.plannerResponse || {};
      rec.writing = !!(pr.response && String(pr.response).length);
      if (pr.thinkingDuration) rec.think = parseFloat(pr.thinkingDuration) || 0;
    }
    a.steps.set(key, rec);
    if (total > a.total) a.total = total;
    if (a.steps.size > ACT_KEEP) for (const k of [...a.steps.keys()].sort((x, y) => x - y).slice(0, a.steps.size - ACT_KEEP)) a.steps.delete(k);
    a.updated = Date.now();
    S.act.set(id, a);
  };
  const takeSteps = (tu, convId) => {
    const su = tu.stepsUpdate;
    const steps = su && su.steps;
    if (!Array.isArray(steps)) return;
    const indices = Array.isArray(su.indices) ? su.indices : [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (!st || typeof st !== 'object') continue;
      const md = st.metadata || {};
      const src = md.sourceTrajectoryStepInfo;
      try { noteAct(st, md, convId, Number.isInteger(indices[i]) ? indices[i] : -1, Number(su.totalLength) || 0); } catch (e) { /* 活动记录出错不影响其他 */ }
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
      if (Number.isInteger(indices[i]) && indices[i] >= 0 && (!src || !src.cascadeId || src.cascadeId === convId)) stepMap(convId).set(indices[i], tms(md.createdAt));
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
  // ---------- 账号（2026-11-22 加，v1.6） ----------
  // GetUserStatus 里有 email 和 userTier.name（例如 Google AI Ultra）。页面里只留打码后的邮箱和邮箱的哈希：
  // 哈希当账号键（注入程序按它把额度历史分开记），邮箱原文不往外传、不写文件。
  // 打码：@ 前面留头两个字和最后两个字（太短就只留第一个字），域名照写，例如 ab***12@gmail.com。
  const maskEmail = (e) => {
    const m = /^([^@]+)@(.+)$/.exec(String(e || '').trim());
    if (!m) return '';
    const u = m[1];
    return (u.length >= 6 ? u.slice(0, 2) + '***' + u.slice(-2) : u.slice(0, 1) + '***') + '@' + m[2];
  };
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const acctOf = (u) => {
    if (!u || !u.email) return null;
    const tier = u.userTier || {};
    return { key: fnv(String(u.email).trim().toLowerCase()), m: maskEmail(u.email), t: String(tier.name || '').slice(0, 60), tid: String(tier.id || '').slice(0, 40) };
  };
  S.onMessage = (method, j) => {
    if (method === 'RetrieveUserQuotaSummary') {
      const r = (j && j.response) || j || {};
      if (Array.isArray(r.groups)) { S.quota = { at: Date.now(), groups: r.groups, description: r.description }; S.render(); }
      S.quotaRaw = compact(j, 0);
      return;
    }
    if (method === 'GetUserStatus') {
      const a = acctOf(j && j.userStatus);
      if (a && (!S.account || S.account.key !== a.key || S.account.t !== a.t)) { S.account = a; S.render(); }
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
    if (u.status) {
      // 活动行用：记下这一轮开始跑和跑完的时间
      const was = /RUNNING/.test(c.status || ''), now = /RUNNING/.test(u.status);
      if (now && !was) { c.runSince = Date.now(); c.doneAt = 0; }
      if (!now && was) c.doneAt = Date.now();
      c.status = u.status;
    }
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
    const askAt = S.quotaAskAt;
    window.fetch(S.lsService + '/RetrieveUserQuotaSummary', { method: 'POST', headers: S.lsHeaders, body: f })
      .then((r) => r.arrayBuffer())
      .catch(() => {})
      .then(() => {
        S.quotaPending = false;
        // 2026-11-22：刚启动时页面可能还停在引导页，第一次查不到额度，每周额度要等 3 分钟后的下一轮才出来。
        // 查完 1.5 秒还没拿到这次的结果，就改成 20 秒后再查（连续最多 3 次，之后回到每 3 分钟一次）。
        setTimeout(() => {
          if (S.quota && S.quota.at >= askAt) { S.quotaQuick = 0; return; }
          if ((S.quotaQuick || 0) >= 3) return;
          S.quotaQuick = (S.quotaQuick || 0) + 1;
          S.quotaAskAt = Date.now() - 150000; // 定时器在离上次查询 170 秒时再查，也就是约 20 秒后
        }, 1500);
      });
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
          S.casMeta.set(id, { created: tms(s.createdTime), modified: tms(s.lastModifiedTime), title: String(s.summary || '').slice(0, 120) });
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
  // k = 在线价格表（仓库的 data/prices.json，见 setPrices）里对应的模型 ID；在线表里有这个模型就用在线的价，t 是内置的价（取不到在线表时用）。
  const PRICES = [
    { re: /orchestrator-neon/i, name: 'Neon', note: 'Orchestrator (Neon) 的规划调用，按 Gemini 4 Neon 价', k: 'gemini-4-neon', t: P_NE },
    { re: /orchestrator-argon/i, name: 'Argon', note: 'Orchestrator (Argon) 的规划调用，按 Gemini 4 Argon 价', k: 'gemini-4-argon', t: P_CA },
    { re: /orchestrator/i, name: 'Carbon', note: 'Orchestrator 的规划调用，按 Gemini 4 Carbon 价', k: 'gemini-4-carbon', t: P_CA },
    { re: /flash-worker/i, name: 'Hydrogen', note: '执行模型 gemini-flash-worker-agy（后台显示名 Gemini 4 Hydrogen (Orchestrator)），按 Gemini 4 Hydrogen 价', k: 'gemini-4-hydrogen', t: P_H },
    { re: /gemini-4-neon/i, name: 'Neon', k: 'gemini-4-neon', t: P_NE },
    { re: /gemini-4-carbon/i, name: 'Carbon', k: 'gemini-4-carbon', t: P_CA },
    { re: /gemini-4-argon/i, name: 'Argon', k: 'gemini-4-argon', t: P_CA },
    // gemini-4-hydrogen-tiered-high：浏览器子代理用的（11-22 见到，模型编号 PLACEHOLDER_M530）。官方价格页没有这个名字，
    // 只有 gemini-4-hydrogen（Standard 1.5 / 0.075 / 7.5，另有 Batch、Flex 半价和 Priority 1.8 倍）；按 Standard 算，是估计。
    { re: /gemini-4-hydrogen-tiered/i, name: 'Hydrogen', note: 'gemini-4-hydrogen-tiered-high（浏览器子代理用的）官方价格页没有，按 Gemini 4 Hydrogen 标准价估', k: 'gemini-4-hydrogen', t: P_H },
    { re: /gemini-4-hydrogen/i, name: 'Hydrogen', k: 'gemini-4-hydrogen', t: P_H },
    { re: /gemini-3[.-]8-flash/i, name: '3.8 Flash', k: 'gemini-3.8-flash', t: P_F38 },
    { re: /claude-opus-5[.-]5/i, name: 'Opus 5.5', k: 'claude-opus-5-5', t: [[Infinity, { in: 4, cache: 0.2, cw: 5, out: 20 }]] },
    { re: /claude-sonnet-5[.-]5/i, name: 'Sonnet 5.5', k: 'claude-sonnet-5-5', t: [[Infinity, { in: 2, cache: 0.1, cw: 2.5, out: 10 }]] },
  ];
  // 在线价格表（v1.7）：注入程序从仓库取来、校验过的 data/prices.json（CFG.remote.prices，之后 S.setRemote 推送）。
  // { updated, models: { 模型 ID: { title, t: [[到哪天为止（不含，太平洋时间零点）或 null, 单价], …] } } }。
  // 内置规则按 k 换成在线的价；在线表里有、内置规则没有的模型（比如新出的模型），按模型 ID 生成一条规则排在后面
  // （ID 里数字之间的 . 和 - 都认，后面不能紧跟别的版本号：claude-opus-5 不会匹配 claude-opus-5-5）。
  let priceRules = PRICES;
  let priceSrc = { online: false, updated: '' };
  const setPrices = (pr) => {
    priceRules = PRICES;
    priceSrc = { online: false, updated: '' };
    if (!pr || !pr.models) return;
    const conv = (t) => t.map(([u, p]) => [u ? PT0(u) : Infinity, p]);
    const known = new Set(PRICES.map((r) => r.k));
    const extra = [];
    for (const [id, e] of Object.entries(pr.models)) {
      if (known.has(id) || !Array.isArray(e.t)) continue;
      const pat = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(\d)\\?[.-](?=\d)/g, '$1[.-]');
      try {
        extra.push({ re: new RegExp(pat + '(?![.-]?\\d)', 'i'), name: String(e.title || id).replace(/^Gemini (4 )?/, '').replace(/^Claude /, ''), k: id, note: '在线价格表里的 ' + (e.title || id), t: conv(e.t) });
      } catch {}
    }
    priceRules = [...PRICES.map((r) => (pr.models[r.k] && Array.isArray(pr.models[r.k].t) ? { ...r, t: conv(pr.models[r.k].t) } : r)), ...extra];
    priceSrc = { online: true, updated: String(pr.updated || '') };
  };
  // 在线数据（v1.7）：{ version 装着的版本, on 在线更新开着, prices, meta { latest, date }, st 检查情况 }，见 inject.mjs 的 remoteForPage。
  // 注入时经 CFG.remote 带来；注入程序每次检查完调 S.setRemote 推送（定义在 S.setLook 旁边）。
  if (CFG && CFG.remote) S.remote = CFG.remote;
  setPrices(S.remote && S.remote.on !== false ? S.remote.prices : null);
  const verGt = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  const priceSrcText = () => priceSrc.online ? '单价来自在线价格表（' + priceSrc.updated + ' 更新，按官方价格页每天自动核对）' : '单价来自内置价格表（安装包自带）';
  const priceFor = (names, at) => {
    const when = at > 0 ? at : Date.now();
    for (const r of priceRules) {
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
  // 调价时间点：这次调用匹配到的那条价目里，某一档的截止时间落在 (lo, hi] 里就返回它，没有返回 0
  const priceCut = (names, lo, hi) => {
    for (const r of priceRules) {
      if (!r.re.test(names)) continue;
      for (const x of r.t) if (Number.isFinite(x[0]) && x[0] > lo && x[0] <= hi) return x[0];
      return 0;
    }
    return 0;
  };
  // 一个对话里每次调用的时间（2026-11-25 代码审查后改，代替 v2.0.10 的 callAt）。c.list 按调用顺序排，时间递增。
  //   exact：这次调用自己那一步的开始时间（状态流、补取的步骤、调用明细取过的步骤里有）。
  //   没有 exact 时用前后已知的时间夹一个范围：lo = 前面最近一次已知的时间（没有就是对话创建时间），hi = 后面最近一次已知的时间（没有就是现在）。
  //   day：整个范围在 0 点前是 'before'，在 0 点以后是 'today'，跨 0 点是 null（还不知道，要补取）。
  //   priceAt：选价用的时间。范围里没有调价时间点就用 lo（整个范围同一档价）；有就是 null（要补取，先按 lo 算）。
  // v2.0.10 的 callAt 在今天建的对话没有每步时间时按创建时间选价，对话累计按这一轮最新一步的时间选价，跨调价时间点会算错
  // （审查 A2，例如 12-01 08:00 UTC Carbon / Argon 涨价）；0 点前、又不知道时间的旧调用一直算“正在查时间”（审查 A8）。
  // 再早（v2.0.9 以前）直接用 S.execAt（一轮共用、存最新一步的时间），跨 0 点的一轮整轮算进今天。
  const callTimes = (id, list, meta, d0) => {
    const n = list.length;
    const sm = S.stepAt.get(id), dc = S.detCache && S.detCache.get(id);
    const exact = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const g = list[i];
      if (g && g.step >= 0) exact[i] = (sm && sm.get(g.step)) || (dc && dc.times && dc.times.get(g.step)) || 0;
    }
    const his = new Array(n);
    let next = Date.now();
    for (let i = n - 1; i >= 0; i--) { if (exact[i]) next = exact[i]; his[i] = exact[i] || next; }
    const out = new Array(n);
    let prev = (meta && meta.created) || 0;
    for (let i = 0; i < n; i++) {
      const g = list[i];
      if (exact[i]) prev = exact[i];
      const lo = exact[i] || prev, hi = his[i];
      const day = hi < d0 ? 'before' : lo >= d0 ? 'today' : null;
      const priceAt = exact[i] || (g && !priceCut(callNames(g.resp, g.key, g.exec), lo, hi) ? lo : null);
      out[i] = { at: lo, hi, day, priceAt };
    }
    return out;
  };
  // 补取过的起点：对话 → Map(起点步骤 → { ok, at })。取到了（要的那一步有了时间）就不再从这里取，防止死循环；
  // 没取到（请求失败、后台忙）60 秒后可以再试。原来发请求之前就记成“取过”，失败一次这个起点就再也不取（审查 A3）。
  S.timeFetched = S.timeFetched || new Map();
  const canFetch = (id, from) => { const e = (S.timeFetched.get(id) || new Map()).get(from); return !e || (!e.ok && Date.now() - e.at > 60000); };
  // 今天动过的对话里还有调用不知道是不是今天的、或者今天的调用跨了调价时间点：返回从第几步开始取（null = 不用取）
  const timeFetchFrom = (id) => {
    const c = S.costs.get(id);
    const meta = convMeta(id);
    const d0 = dayStart();
    if (!c || !c.list.length || !meta || !(meta.modified >= d0)) return null;
    const list = c.list;
    const ts = callTimes(id, list, meta, d0);
    const need = (i) => !!list[i] && (ts[i].day == null || (ts[i].day === 'today' && ts[i].priceAt == null));
    let b = list.length - 1;
    while (b >= 0 && !need(b)) b--;
    if (b < 0) return null; // 都知道了
    let a = 0;
    while (!need(a)) a++;
    const ok = (k) => (list[k] && list[k].step >= 0 && canFetch(id, list[k].step) ? list[k].step : null);
    // 末尾一段（取过以后新来的调用）：从这一段第一次调用的那一步取到最后
    if (b === list.length - 1 && a > 0) { let s = b; while (s > a && need(s - 1)) s--; if (s > 0 && !need(s - 1)) { const f = ok(s); if (f != null) return f; } }
    // 要找的时间点（0 点，或调价时间点）在 [a, b] 这段的时间范围里大概在第几次调用：按比例估，再往前留 10%
    const cutAt = ts.slice(a, b + 1).some((x) => x.day == null) ? d0
      : priceCut(callNames(list[a].resp, list[a].key, list[a].exec), ts[a].at, ts[a].hi) || d0; // 这时 [a, b] 里要补的都是跨调价时间点的今天的调用
    const lo = ts[a].at, hi = ts[b].hi, len = b - a + 1;
    const frac = Math.max(0, Math.min(1, (cutAt - lo) / Math.max(1, hi - lo)));
    const k = Math.min(b, Math.max(a, a + Math.floor(frac * len - len * 0.1)));
    // 这个起点取过了：往前对半找，最后从这段的开头取
    for (const x of [k, a + Math.floor((k - a) / 2), a]) { const f = ok(x); if (f != null) return f; }
    return null;
  };
  S.fetchTimes = (id, from) => {
    if (S.timeBusy.has(id)) return;
    S.timeBusy.add(id);
    const note = (ok) => {
      const m = S.timeFetched.get(id) || new Map();
      m.set(from, { ok, at: Date.now() });
      S.timeFetched.set(id, m);
    };
    lsCall('GetCascadeTrajectorySteps', { cascadeId: id, stepOffset: from })
      .then((j) => {
        const sm = stepMap(id);
        ((j && j.steps) || []).forEach((st, i) => {
          const md = st && st.metadata;
          if (!md || !md.createdAt) return;
          sm.set(from + i, tms(md.createdAt));
          if (md.executionId) S.execAt.set(md.executionId, tms(md.createdAt));
        });
        note(sm.has(from)); // 要的那一步有了时间才算取到（请求失败时 j 是 null）
        S.render();
      })
      .then(() => { S.timeBusy.delete(id); }, () => { note(false); S.timeBusy.delete(id); });
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
    for (const f of S.convFiles || []) if (f[2] >= d0) ids.add(f[0]); // 本机对话库文件今天改过的（后台摘要里不一定有）
    for (const id of ids) {
      const c = S.costs.get(id);
      if (c && (c.busy || now - (c.askAt || 0) < 1500)) continue;
      const last = (S.agents.get(id) || {}).lastAt || 0;
      const meta = convMeta(id);
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
  // 按钮上的名字和模型列表里的名字写法不完全一样（2026-11-22 发现）：
  //   普通模型：按钮 “Gemini 4 Neon Extra High”，列表 “Gemini 4 Neon (XHigh)”——推理强度要换成同一种写法再比；
  //   Orchestrator：按钮 “Orchestrator Gemini 4 Neon Extra High”，列表 “Orchestrator (Neon)”——按 Orchestrator + 括号里的家族名找。
  // 以前对不上就返回空，新对话第一次调用结束前，状态栏上没有模型这一项。
  const normLabel = (s) => String(s).toLowerCase().replace(/extra\s*high/g, 'xhigh').replace(/[()\s]/g, '');
  const selectedKey = () => {
    const raw = selectedLabel();
    const want = normLabel(raw);
    if (!want) return '';
    for (const [k, v] of S.models) if (normLabel(v.label) === want) return k;
    if (/^orchestrator\b/i.test(raw)) {
      for (const [k, v] of S.models) {
        const m = /^orchestrator\s*\(([^)]+)\)/i.exec(String(v.label));
        if (m && new RegExp('\\b' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(raw)) return k;
      }
    }
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
    if (title) s.setAttribute('data-agy-tip', title); // 悬停提示（自己画的，见 setTip 一节；不用系统 title）
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

  // ---------- 外观（2026-11-22 加）：配色、外形、进度条、信息密度、图标 ----------
  // 参考 CCometixLine v2（哈雷）的分层：配色（palette）× 外形（skin：plain / pill / powerline）× 进度条字形 × 文字模板的详略，
  // 以及“仪表代替图标”（上下文的图标画成随用量变满的圆环）。本项目没有用它的代码（它的仓库没有许可证）；
  // 各配色取自配色方案自己公开的色值（都是 MIT 许可），每套都有浅色、深色两版，跟着 Antigravity 的明暗切换。
  // 默认是本项目自己的 cometix（下面 CSS 里的基础色）。选择存在注入程序目录的 look.json，所有窗口共用（见 inject.mjs 的 readLook）。
  // 图标（2026-11-22 加，v1.6）：参考 ccline v2 的 glyphs（整套换：nerd / unicode / ascii）和每项的 icon 覆盖。
  //   整套（look.icons）：material 实心（默认）/ outline 线条（同一套字体，FILL 0）/ unicode 普通字符（不用联网加载字体）/ off 不显示。
  //   单项（look.iconMap）：每一项只有两个：默认 + 一个备选（material / outline 时生效；unicode 用最后那个固定字符）。
  //   11-22 用户嫌候选太多、有几个难看（脑子、机器人、芯片、刷新箭头、三个点），按 ccline 的做法收成每项一个默认图标，只留一个备选。
  //   默认图标保持本项目原来那一套（用户要求别改），只有子代理的默认从机器人换成树形分支（用户嫌机器人难看）。
  //   备选里模型的彗星取自 ccline 的模型图标；缓存、花费、首字、速度原来就和 ccline 一样。
  //   候选图标都要写进 CSS 里字体请求的 icon_names（按字母排序），否则显示成英文名。'$' 开头的是内联 SVG：
  //   '$coin' 对话花费（见 costIcon），'$comet' 彗星（见 cometIcon，Font Awesome Free 的 meteor，CC BY 4.0），
  //   '$speedo' 速度的三段仪表盘（见 speedIcon，指针按 慢 / 中 / 快 三档指向）。
  //   11-22 用户定：默认一律用原来那套，新画的（彗星、三段仪表盘）只放进备选。
  const ICON_ITEMS = {
    model: ['model', '模型', ['auto_awesome', '$comet'], '✦'],
    cache: ['cache', '缓存', ['database', 'offline_bolt'], '≋'],
    cost: ['cost', '这个对话的花费', ['$coin', 'paid'], '$'],
    today: ['today', '今天的花费', ['calendar_month', 'today'], '▦'],
    ttft: ['ttft', '首字时间', ['hourglass_top', 'timer'], '⧗'],
    speed: ['speed', '生成速度', ['speed', '$speedo'], '»'],
    h5: ['5h', '5 小时额度', ['schedule', 'history'], '◷'],
    weekly: ['weekly', '每周额度', ['event', 'date_range'], '▤'],
    agent: ['agent', '子代理', ['account_tree', 'person'], '◆'],
  };
  const ICON_NAME_ZH = { $comet: '彗星', $coin: '对话气泡里的 $', auto_awesome: '星光', database: '数据库', offline_bolt: '闪电', paid: '硬币',
    calendar_month: '月历', today: '日历', hourglass_top: '沙漏', timer: '秒表', speed: '仪表盘', $speedo: '三段仪表盘（指针跟着速度档位走）', schedule: '时钟', history: '倒转的时钟',
    event: '日历', date_range: '日期范围', account_tree: '树形分支', person: '人像' };
  // 不能单独换的几个：[Material 名, unicode 字符]
  const ICON_FIXED = { check: ['check', '✓'], ctx: ['data_usage', '◔'], quota1: ['timelapse', '◔'] };
  const LOOK_DEFAULT = { pal: 'cometix', skin: 'plain', bar: 'thin', dense: 'compact', icons: 'material', iconMap: {}, online: 'auto' };
  const LOOK_CHOICES = {
    pal: ['cometix', 'catppuccin', 'tokyo-night', 'rose-pine', 'gruvbox', 'nord', 'dracula', 'mono'],
    skin: ['plain', 'pill', 'powerline'],
    bar: ['thin', 'cells', 'ring', 'none'],
    dense: ['compact', 'full'],
    icons: ['material', 'outline', 'unicode', 'off'],
    online: ['auto', 'off'], // v1.7：在线更新词典和价格（不是外观，但跟外观一起存、一起同步到各窗口）
  };
  const cleanLook = (o) => {
    const l = { ...LOOK_DEFAULT, iconMap: {} };
    if (o && typeof o === 'object') {
      for (const k of Object.keys(LOOK_CHOICES)) if (LOOK_CHOICES[k].includes(o[k])) l[k] = o[k];
      if (typeof o.icons === 'boolean') l.icons = o.icons ? 'material' : 'off'; // v1.5 存的是 true / false
      if (o.iconMap && typeof o.iconMap === 'object') {
        for (const [k, v] of Object.entries(o.iconMap)) if (ICON_ITEMS[k] && ICON_ITEMS[k][2].includes(v) && v !== ICON_ITEMS[k][2][0]) l.iconMap[k] = v;
      }
      if (+o.at > 0) l.at = +o.at;
    }
    return l;
  };
  { // 注入时带来的 look.json 比页面里记着的新，就用它（再次注入时页面里的选择保留）
    const fromFile = cleanLook(CFG && CFG.look);
    if (!S.look || (fromFile.at || 0) > (S.look.at || 0)) S.look = fromFile;
    else S.look = cleanLook(S.look); // 旧版本留下的对象：补上新加的字段
  }
  // 把外观写到元素的 data-* 上（CSS 按这些属性选配色和外形）；没变就不写，免得触发别人的 MutationObserver
  const lookAttrs = (e, over) => {
    if (!e) return e;
    const l = { ...S.look, ...over };
    const want = { pal: l.pal, skin: l.skin, bar: l.bar, icons: l.icons };
    for (const [k, v] of Object.entries(want)) if (e.dataset[k] !== v) e.dataset[k] = v;
    return e;
  };
  // 小圆环（SVG）：额度进度条的 ring 样式和上下文的仪表图标共用。从 12 点钟方向顺时针画
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ringEl = (frac, cls) => {
    const f = Math.max(0, Math.min(1, frac));
    const s = el('span', cls);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    const C = 2 * Math.PI * 7;
    const circle = (c, len) => {
      const e = document.createElementNS(SVGNS, 'circle');
      e.setAttribute('cx', '10'); e.setAttribute('cy', '10'); e.setAttribute('r', '7'); e.setAttribute('class', c);
      if (len != null) e.setAttribute('stroke-dasharray', len.toFixed(2) + ' 99');
      return e;
    };
    svg.append(circle('trk'));
    if (f > 0) svg.append(circle('arc', Math.max(1.5, f * C)));
    s.append(svg);
    return s;
  };
  // 按外观取图标：返回 Material 图标名（seg 会建成字体图标）、内联 SVG 元素，或 unicode 字符元素。
  // key 是 ICON_ITEMS 或 ICON_FIXED 里的名字；图标关掉时也照常返回，由 CSS（data-icons="off"）藏起来。
  const ICON = (key, over) => {
    const l = { ...S.look, ...over };
    const item = ICON_ITEMS[key], fixed = ICON_FIXED[key];
    if (l.icons === 'unicode') return el('span', 'ic uni', item ? item[3] : fixed[1]);
    const name = item ? (l.iconMap && l.iconMap[key]) || item[2][0] : fixed[0];
    if (name === '$speedo') return speedIcon(l.tps);
    return name === '$coin' ? costIcon() : name === '$comet' ? cometIcon() : name;
  };
  // 额度进度条：thin 细条（默认，约是 10 格的一半宽）/ cells 10 格 / ring 小圆环 / none 不画（只留百分比）
  const meter = (frac, colorKind) => {
    const f = Math.max(0, Math.min(1, frac));
    const kind = S.look.bar;
    if (kind === 'none') return null;
    if (kind === 'cells') return cells(f, colorKind);
    if (kind === 'ring') return ringEl(f, 'meter ring k-' + colorKind);
    const b = el('span', 'meter thin k-' + colorKind);
    const i = el('i');
    i.style.width = (f * 100).toFixed(1) + '%';
    b.append(i);
    return b;
  };

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
    return pieces.length ? seg('model', ICON('model'), pieces, tip) : null;
  };

  // ---------- 一次模型调用：首字、速度、token ----------
  const callSegs = (md) => {
    const mu = md && md.modelUsage;
    if (!mu) return [];
    const out = [];
    const t0 = tms(md.createdAt), t1 = tms(md.viewableAt), t2 = tms(md.finishedGeneratingAt || md.completedAt);
    if (t1 > t0) out.push(seg('timing', ICON('ttft'), [((t1 - t0) / 1000).toFixed(1) + 's'], '首字时间：从发出请求到第一个字出现（含思考）'));
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
      const tps = outTok / (span / 1000);
      out.push(seg('timing', ICON('speed', { tps }), [Math.round(tps) + ' tok/s'],
        '生成速度：' + SPEED_TIERS[speedTier(tps)][2] + '\n输出 ' + outTok.toLocaleString() + ' token' + (thinkTok > 0 ? '（含思考 ' + thinkTok.toLocaleString() + '）' : '') +
        ' ÷ 生成用时 ' + (span / 1000).toFixed(2) + ' 秒\n' +
        (thinkTok > 0 ? '有思考：从思考开始算（' + (thinkMs > 0 ? '思考 ' + (thinkMs / 1000).toFixed(1) + ' 秒' : '没有思考时长，从发出请求算') + '）'
          : '没有思考：从首字出现算起')));
    }
    // 11-16 起不再单独显示“in · out · think”这一项（用处不大还占位置）；最近一次调用的 token 数在费用项的悬停说明里
    return out;
  };
  const promptTokens = (mu) => (Number(mu.inputTokens) || 0) + (Number(mu.cacheReadTokens) || 0) + (Number(mu.cacheWriteTokens) || 0);
  // comps：后台压缩过上下文的步骤序号（状态流的 compactionInfo）。有压缩就在上下文这一项后面放一个小徽章（图标 + 次数）。
  // 2026-11-22 以前是文字 “compacted N×”，太宽，会把行末的 running 挤到下一行（issue #2）。
  // 11-22 改成 issue #2 作者截图里的样子：浅黄小圆角块，循环箭头 ↻ + 次数（原来的压缩图标看着像 ÷）。用普通字符，不靠图标字体。
  // id：对话 ID。给了就能点，打开压缩查看器（2026-11-24 加，见下面“压缩查看器”）
  const compBadge = (n, id) => {
    const b = el('span', 'comp');
    if (S.look.icons !== 'off') b.append(el('span', 'cyc', '↻'));
    b.append(n + '×');
    if (id) {
      b.classList.add('clk', 'p-open'); // p-open：点它不算点到面板外面（不会先关掉面板）
      b.addEventListener('click', (ev) => { ev.stopPropagation(); openCheckpoint(id, b); });
    }
    return b;
  };
  const ctxSeg = (ctx, mu, comps, id) => {
    const n = Array.isArray(comps) ? comps.length : 0;
    const compPiece = n ? compBadge(n, id) : null;
    const compTip = n ? '\n已压缩 ' + n + ' 次：后台在第 ' + comps.join('、') + ' 步压缩过上下文' + (id ? '\n点 ↻ 看压缩后智能体手里还剩什么' : '') : '\n这个对话还没有被压缩过';
    const sent = mu ? promptTokens(mu) : 0;
    const sentTip = sent > 0 ? '\n最近一次调用实际发给模型：' + sent.toLocaleString() + ' token（输入 + 缓存读写）' : '';
    if (ctx && Number(ctx.maxContextTokens) > 0) {
      const used = Number(ctx.estimatedTokensUsed) || 0;
      const max = Number(ctx.maxContextTokens);
      const pct = Math.round((used / max) * 100);
      // 11-22：每一类后面加占整个上下文窗口的百分比（仿 Claude Code 的 Context 面板），名字、数量、百分比对齐成三列；最后是剩余
      const groups = (ctx.tokenGroups || []).map((g) => [String(g.name || '?'), Number(g.numTokens) || 0]).sort((a, b) => b[1] - a[1]);
      const pctOf = (n) => { const p = n / max * 100; return (p > 0 && p < 0.1 ? '<0.1' : p.toFixed(1)) + '%'; };
      const w0 = Math.max(10, ...groups.map((g) => g[0].length), 4);
      const w1 = Math.max(...groups.map((g) => g[1].toLocaleString().length), (max - used).toLocaleString().length);
      const row = (name, n) => name.padEnd(w0) + '  ' + n.toLocaleString().padStart(w1) + '  ' + pctOf(n).padStart(6);
      const bar = (() => { const k = Math.round(used / max * 30); return '█'.repeat(Math.min(30, k)) + '░'.repeat(Math.max(0, 30 - k)); })();
      const detail = '上下文 ' + used.toLocaleString() + ' / ' + max.toLocaleString() + ' token（' + pct + '%）\n' + bar + sentTip + compTip +
        (groups.length ? '\n\n' + groups.map((g) => row(g[0], g[1])).join('\n') + '\n' + row('Free space', Math.max(0, max - used)) : '');
      // 2026-11-22：图标换成随用量变满的圆环（仿 ccline 的 gauge）；紧凑模式（默认）不写上限，上限在悬停说明里
      const usedText = S.look.dense === 'full' ? fmtK(used) + ' / ' + fmtK(max) : fmtK(used);
      return seg('context', ringEl(used / max, 'ic svg gauge'), [pct + '%', usedText, compPiece], detail, level(pct, 70, 90, 'context'));
    }
    if (sent > 0) return seg('context', ICON('ctx'), [fmtK(sent), compPiece], '上下文：最近一次调用发给模型的 token（输入 + 缓存读写）' + compTip);
    return null;
  };
  const cacheSeg = (mu) => {
    if (!mu || !(Number(mu.cacheReadTokens) > 0)) return null;
    const cache = Number(mu.cacheReadTokens), input = Number(mu.inputTokens) || 0;
    const hit = Math.round((cache / (cache + input)) * 100);
    // 紧凑模式（默认）只写命中率：读到的 token 数和上下文用量差不多，重复了，放进悬停说明
    const pieces = S.look.dense === 'full' ? [fmtK(cache), hit + '% hit'] : [hit + '% hit'];
    return seg('cache', ICON('cache'), pieces, '最近一次调用：从缓存读取 ' + cache.toLocaleString() + ' token，另有 ' + input.toLocaleString() +
      ' token 没命中缓存，命中率 ' + hit + '%');
  };
  // idle：不在生成，只占位置不显示（见 CSS 的 .seg.k-run.idle）
  const runSeg = (text, idle) => {
    const g = el('span', 'seg k-run' + (idle ? ' idle' : ''));
    if (idle) g.setAttribute('aria-hidden', 'true');
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
      const pieces = [meter(used, k), pct + '%', reset > 0 ? fmtWhen(reset) : ''];
      let paceText = '';
      if (weekly && reset > 0) {
        const elapsed = 1 - Math.max(0, Math.min(1, (reset - Date.now()) / WEEK_MS));
        const d = Math.round((used - elapsed) * 100);
        if (d !== 0) {
          pieces.push(el('span', 'tx ' + (d < 0 ? 'pace-ok' : 'pace-hi'), (d < 0 ? '↓' : '↑') + Math.abs(d) + '%'));
          paceText = '\n这周已过去 ' + Math.round(elapsed * 100) + '%，用量比匀速' + (d < 0 ? '慢 ' : '快 ') + Math.abs(d) + ' 个百分点';
        }
      }
      const est = weekly ? weekEst(b.bucketId) : null;
      const who = S.account ? '\n账号 ' + S.account.m + (S.account.t ? '（' + S.account.t + '）' : '') : '';
      const tip = (g.displayName || '') + '：' + (weekly ? '每周' : '5 小时') + '额度已用 ' + pct + '%' +
        (reset > 0 ? '，' + new Date(reset).toLocaleString() + ' 重置' : '') + paceText +
        (est ? '\n\n预估：' + est.long + '\n' + SHARE_NOTE : '') + who;
      return seg('quota', ICON(weekly ? 'weekly' : 'h5'), pieces, tip, k);
    });
  };

  // ---------- 费用：最近一次调用 + 这个对话累计（单价和算法见上面“费用估算”） ----------
  // 金额（2026-11-22 改）：状态栏、面板、表格统一写法——0 是 $0.00，不到 1 分是 <$0.01，不到 $100 两位小数，
  // 满 $100 写整数（加千分位）。以前不到 $0.01 写 4 位、不到 $1 写 3 位，0 元会显示成 “$0.0000 today”。
  const fmtUsd = (v) => {
    const x = Number(v) || 0;
    if (x < 0.00005) return '$0.00';
    if (x < 0.01) return '<$0.01';
    if (x < 99.995) return '$' + x.toFixed(2);
    return '$' + Math.round(x).toLocaleString('en-US');
  };
  // 悬停说明里的算式和单次调用用精确值（一次调用常常只有零点几分钱）
  const fmtUsdFine = (v) => {
    const x = Number(v) || 0;
    if (x < 0.00005) return '$0';
    return '$' + (x < 0.01 ? x.toFixed(4) : x < 1 ? x.toFixed(3) : x.toFixed(2));
  };
  const tokUsd = (n, price, usd) => n.toLocaleString() + ' × $' + price + '/M = ' + fmtUsdFine(usd);
  // ---------- 单次调用很贵（2026-11-24 加） ----------
  // 一次调用 ≥ COSTLY_USD 美元算“很贵”：状态栏上这个对话的花费后面放一个红色小徽章（刚出现时闪几下），调用明细里这一行的花费标红。
  // 门槛按作者电脑 11-22～24 的 3019 次调用定：≥ $0.50 的占 3.3%，其中 93% 缓存命中低于 50%；≥ $1 的 47 次全部是缓存没命中
  // （最贵的都是 Carbon，上下文 43 万～51 万 token、命中 0%）。所以说明里同时算“要是走缓存能省多少”。
  // 缓存过期的说法来自 11-22 的实测（Gemini 3～15 分钟约一半命中、15 分钟以后基本不命中；同一轮里的没命中是压缩造成的）。
  const COSTLY_USD = 0.5;
  // cc：callCost 的结果。不贵（或没有单价）返回 null，贵就返回说明文字
  const costlyNote = (cc, miss) => {
    if (!cc || cc.usd == null || cc.usd < COSTLY_USD) return null;
    const p = cc.pr.p;
    const hit = cc.cr + cc.inp > 0 ? cc.cr / (cc.cr + cc.inp) : 0;
    const save = cc.inp * Math.max(0, p.in - p.cache) / 1e6; // 这些全价输入要是都走缓存，能省多少
    let s = '这次调用花了 ' + fmtUsdFine(cc.usd) + '（单次 ≥ $' + COSTLY_USD.toFixed(2) + ' 算很贵）' +
      '\n缓存命中 ' + Math.round(hit * 100) + '%：' + cc.inp.toLocaleString() + ' token 按全价输入' +
      (save >= 0.05 ? '，要是都走缓存能省约 ' + fmtUsd(save) : '');
    s += miss ? '\n\n' + missNote(miss)
      : hit < 0.5
        ? '\n\n缓存没命中的常见原因：隔了 1 分钟以上才发下一次请求（实测 Gemini 隔 2～5 分钟就常常不命中，Claude 约 5 分钟后失效）、上下文刚被压缩、换了模型。间隔很短也可能没命中（服务端的缓存没接上）。'
        : '\n\n缓存是命中的，贵在上下文很长或者输出很多。';
    return s;
  };
  // ---------- 缓存没命中多花的钱（2026-11-24 加） ----------
  // 同一个对话里，一次调用和这个模型上一次的大调用（输入 ≥ 2 万 token）比：前面那段上下文本来可以走缓存，这次却按全价算了，
  // 就算没命中。漏掉的 token = min(上一次的输入, 这次的输入) − 这次的缓存读，不到 2 万不算（输入 = 新增输入 + 缓存读 + 缓存写）。
  // 多花的钱 = 漏掉的 token ×（这次全价输入的平均单价 − 缓存读单价）；Claude 没命中时内容写进缓存，按缓存写的单价算。
  // 原因按顺序判断：
  //   model   这个模型在对话里第一次出现，上一次大调用是别的模型（新模型的缓存是空的）
  //   compact 中间有压缩那一步，或者输入比上一次少了 40% 以上（上下文被压缩或截短，前缀变了）
  //   user    上一次调用结束后隔了 1 分钟以上，中间有你发的消息
  //   turn    隔了 1 分钟以上，中间没有你的消息（长命令、等你批准、等子代理）
  //   wait    隔了 1 分钟以上，不知道中间有没有你的消息（agy CLI 的调用没有步骤信息）
  //   other   离上一次调用结束不到 1 分钟也没命中。缓存读是 0 的（连系统提示词都没命中）多半是服务端的缓存没接上；
  //           读到一小部分（例如只有系统提示词那 1.8 万）的，可能是前面的内容变了
  // 门槛按作者电脑 11-17～11-24 的 4143 次调用定：同一对话两次调用隔 < 30 秒时 Gemini 命中 90%～95%，隔 1～2 分钟开始掉，
  // 隔 2～5 分钟 Hydrogen 有 59%、Carbon 有 41% 的调用完全没命中；Claude 约 5 分钟后失效。这 7 天没命中多花约 $161（占 39%），
  // 其中隔了 1 分钟以上的约 $91，不到 1 分钟的约 $61，压缩和换模型合计不到 $9。
  // list：一个对话按时间排好的调用 [{ at 开始毫秒, ttft 秒, stream 秒, step 步骤序号, cc（callCost 的结果）}]；
  // steps：{ user, ckpt }（你发消息、压缩那一步的步骤序号，Set 或数组），没有步骤信息传 null。
  // 返回和 list 一一对应的数组：没命中的是 { tok 漏掉的 token, usd 多花的钱, cause 原因, idle 隔了多少毫秒, from 上一次的价目名 }，其余是 null。
  const MISS_MIN_TOK = 20000;
  const MISS_IDLE_MS = 60000;
  const missScan = (list, steps) => {
    const out = list.map(() => null);
    const has = (s, a, b) => { if (s) for (const k of s) if (k > a && k <= b) return true; return false; };
    const last = new Map(); // 价目名 → 这个模型上一次大调用的下标
    let big = -1; // 上一次大调用（任何模型）的下标
    list.forEach((c, i) => {
      const cc = c.cc;
      if (!cc || !cc.pr) return;
      const name = cc.pr.name;
      const P = cc.inp + cc.cr + cc.cw;
      let bi = last.has(name) ? last.get(name) : -1;
      let cause = '';
      if (bi < 0 && big >= 0) { bi = big; cause = 'model'; }
      if (bi >= 0) {
        const b = list[bi], bc = b.cc;
        const PB = bc.inp + bc.cr + bc.cw;
        const tok = Math.max(0, Math.min(PB, P) - cc.cr);
        if (tok >= MISS_MIN_TOK) {
          const idle = Math.max(0, c.at - b.at - ((+b.ttft || 0) + (+b.stream || 0)) * 1000);
          if (!cause) {
            if ((steps && has(steps.ckpt, b.step, c.step)) || P < 0.6 * PB) cause = 'compact';
            else if (idle >= MISS_IDLE_MS) cause = !steps ? 'wait' : has(steps.user, b.step, c.step) ? 'user' : 'turn';
            else cause = 'other';
          }
          const p = cc.pr.p;
          const full = cc.inp + cc.cw > 0 ? (cc.inp * p.in + cc.cw * (p.cw != null ? p.cw : p.in)) / (cc.inp + cc.cw) : p.in;
          out[i] = { tok, usd: tok * Math.max(0, full - p.cache) / 1e6, cause, idle, from: bc.pr.name };
        }
      }
      if (P >= MISS_MIN_TOK) { last.set(name, i); big = i; }
    });
    return out;
  };
  // 原因：面板上的短名（英文，和状态栏一致）+ 悬停说明里的中文
  const MISS_CAUSE = {
    user: ['your pause', '你隔了 1 分钟以上才发下一条消息'],
    turn: ['agent pause', '一轮中间停了 1 分钟以上（长命令、等你批准、等子代理）'],
    wait: ['pause', '隔了 1 分钟以上才发下一次请求（agy CLI）'],
    compact: ['compaction', '上下文刚被压缩或截短'],
    model: ['model switch', '换了模型（新模型的缓存是空的）'],
    other: ['other', '间隔不到 1 分钟也没命中（服务端的缓存没接上，或者前面的内容变了；你控制不了）'],
  };
  const MISS_ORDER = ['user', 'turn', 'wait', 'compact', 'model', 'other'];
  const MISS_FACT = '实测（作者电脑 7 天）：同一对话两次调用隔不到 30 秒时，Gemini 的缓存命中 90%～95%；隔 2～5 分钟，Hydrogen 有 59%、Carbon 有 41% 的调用完全没命中；' +
    'Claude 约 5 分钟后失效。上下文越长，没命中越贵：40 多万 token 的 Carbon 对话没命中一次多花约 $1.6。';
  const fmtIdle = (ms) => (ms < 60e3 ? Math.round(ms / 1000) + ' 秒' : ms < 3600e3 ? Math.round(ms / 60e3) + ' 分钟' : (ms / 3600e3).toFixed(1) + ' 小时');
  // 一次调用没命中的说明（明细里花费、命中率两格的悬停）
  const missNote = (m) => {
    if (!m) return '';
    const why = m.cause === 'user' ? '你隔了 ' + fmtIdle(m.idle) + '才发下一条消息'
      : m.cause === 'turn' ? '一轮中间停了 ' + fmtIdle(m.idle) + '（长命令、等你批准、等子代理）'
        : m.cause === 'wait' ? '隔了 ' + fmtIdle(m.idle) + '才发下一次请求'
          : m.cause === 'model' ? '换了模型：上一次大调用是 ' + m.from + '，新模型的缓存是空的'
            : m.cause === 'other' ? '离上一次调用结束只隔了 ' + fmtIdle(m.idle) + '也没命中（服务端的缓存没接上，或者前面的内容变了；你控制不了）'
              : MISS_CAUSE[m.cause] ? MISS_CAUSE[m.cause][1] : m.cause;
    return '缓存没命中：约 ' + m.tok.toLocaleString() + ' token 本来可以走缓存，多花约 ' + fmtUsdFine(m.usd) + '\n原因：' + why;
  };
  // 一组调用的没命中合计：{ usd, n, by: { 原因: [次数, 美元] } }
  const missSum = (rows) => {
    const s = { usd: 0, n: 0, by: {} };
    for (const r of rows) {
      const m = r.miss;
      if (!m) continue;
      s.usd += m.usd;
      s.n++;
      const b = s.by[m.cause] || (s.by[m.cause] = [0, 0]);
      b[0]++;
      b[1] += m.usd;
    }
    return s;
  };
  const missTip = (s) => MISS_ORDER.filter((k) => s.by[k]).map((k) => '\n  ' + MISS_CAUSE[k][1] + '：' + s.by[k][0] + ' 次，' + fmtUsd(s.by[k][1])).join('');
  // agy CLI 的调用：按对话分组、按时间排好再找（只有当天的调用，也没有步骤信息）。给每行加上 miss，返回原数组
  const cliMiss = (rows) => {
    const by = new Map();
    for (const r of rows) { if (!by.has(r.conv)) by.set(r.conv, []); by.get(r.conv).push(r); }
    for (const list of by.values()) {
      list.sort((a, b) => a.at - b.at);
      const ms = missScan(list.map((r) => ({ at: r.at, ttft: r.ttft, stream: r.stream, step: -1, cc: callCost(r.usage, r.resp, r.at) })), null);
      list.forEach((r, i) => { r.miss = ms[i]; });
    }
    return rows;
  };
  S.costlySeen = S.costlySeen || new Map(); // 贵的调用 → 第一次显示的时间（刚出现的 6 秒内徽章闪烁）
  const costlyBadge = (cc, key) => {
    const b = el('span', 'costly');
    if (S.look.icons !== 'off') b.append(el('span', 'ex', '!'));
    b.append(fmtUsd(cc.usd));
    if (!S.costlySeen.has(key)) {
      S.costlySeen.set(key, Date.now());
      if (S.costlySeen.size > 200) S.costlySeen.delete(S.costlySeen.keys().next().value);
    }
    if (Date.now() - S.costlySeen.get(key) < 6000) b.classList.add('flash');
    return b;
  };
  const treeCost = (ids) => {
    const t = { usd: 0, calls: 0, unpriced: 0, by: new Map(), cascades: 0 };
    for (const id of ids) {
      const c = S.costs.get(id);
      if (!c || !c.list.length) continue;
      t.cascades++;
      const ts = callTimes(id, c.list, convMeta(id), dayStart()); // 选价按每次调用自己的时间（见 callTimes，审查 A2）
      for (let i = 0; i < c.list.length; i++) {
        const g = c.list[i];
        if (!g) continue;
        t.calls++;
        const x = ts[i];
        const cc = callCost(g.usage, callNames(g.resp, g.key, g.exec), x.priceAt != null ? x.priceAt : (S.execAt.get(g.exec) || x.at));
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
  // 账本版本：v2（2026-11-25）起每次调用按自己的时间定日子。v1 的账本里跨 0 点的一轮整轮算进了今天，而且合并时取较大的数，
  // 改正以后也盖不掉，所以 v1 的账本不再合并（今天的数从头重算一次；注入程序那边同样丢掉 v1 的 cost-day.json）
  const BOOK_V = 2;
  const mergeBook = (into, b) => {
    if (!b || b.day !== into.day || (b.v || 1) !== into.v || !b.by || typeof b.by !== 'object') return;
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
    if (!S.costBook || S.costBook.day !== day || S.costBook.v !== BOOK_V) {
      const book = { day, v: BOOK_V, by: {}, det: {} };
      try { mergeBook(book, JSON.parse(localStorage.getItem(DAY_KEY) || 'null')); } catch (e) {}
      S.costBook = book;
    }
    mergeBook(S.costBook, CFG && CFG.costDay);
    return S.costBook;
  };
  // 对话的创建 / 最后修改时间：后台摘要（S.casMeta）里有就用它，没有就用注入程序给的本机对话文件清单（S.convFiles）。
  // 11-22：后台摘要只列一部分对话（实测 21 个，本机有 79 个），原来摘要里没有的对话被当成“还没加载”，一直不算钱。
  const fileMeta = (id) => { const f = (S.convFiles || []).find((x) => x[0] === id); return f ? { created: f[1], modified: f[2] } : null; };
  const convMeta = (id) => S.casMeta.get(id) || fileMeta(id);
  const todayCost = () => {
    const d0 = dayStart();
    const by = {};
    const detBy = {};
    let calls = 0, undated = 0, loading = 0;
    // 今天动过的对话 = 后台摘要里最后修改时间在 0 点以后的 + 注入程序从磁盘找到的（对话日志和对话库文件，摘要里不一定有）
    const dayIds = new Set(S.todayIds || []);
    for (const [id, meta] of S.casMeta) if (meta.modified >= d0) dayIds.add(id);
    for (const f of S.convFiles || []) if (f[2] >= d0) dayIds.add(f[0]);
    for (const id of dayIds) {
      const meta = convMeta(id);
      if (!meta) { loading++; continue; } // 摘要和文件清单里都还没有（刚建的对话），等下一次
      if (!(meta.modified >= d0)) continue;
      const c = S.costs.get(id);
      if (!c || !c.list.length) { loading++; continue; }
      let usd = 0;
      const det = {};
      const ts = callTimes(id, c.list, meta, d0); // 每次调用的时间（见 callTimes）
      for (let i = 0; i < c.list.length; i++) {
        const g = c.list[i];
        if (!g) continue;
        const x = ts[i];
        if (x.day == null) { undated++; continue; } // 还不知道是不是今天的（跨 0 点、在补取时间）
        if (x.day === 'before') continue;
        const cc = callCost(g.usage, callNames(g.resp, g.key, g.exec), x.priceAt != null ? x.priceAt : x.at);
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
    mergeBook(book, { day: book.day, v: BOOK_V, by, det: detBy });
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
      tip += '\n\n最近一次调用 ' + fmtUsdFine(last.usd) + '（按 ' + last.pr.name + ' 价）' +
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
    const costly = costlyNote(last);
    if (costly) tip += '\n\n⚠ 最近一次调用很贵\n' + costly;
    if (shown != null) out.push(seg('cost', ICON('cost'), [fmtUsd(shown), costly ? costlyBadge(last, (md.executionId || '') + ':' + (md.createdAt || '')) : null], tip));
    // 今天没花钱、但有历史记录时也显示（$0 today），好点开看前几天
    // 2026-11-24 起今天花费含 agy CLI 的（注入程序按 CLI 对话库汇总，见 cliDay），悬停说明里分开写
    const cli = cliDay(dayName());
    const dayAll = day.usd + (cli ? cli.usd : 0);
    if (dayAll > 0 || hasHistory()) {
      const dtip = '今天累计 ' + fmtUsd(dayAll) + '（按 API 标准价，本地 0 点起）' +
        (cli ? '\n  桌面版 ' + fmtUsd(day.usd) + ' · ' + day.convs + ' 个对话（含子代理）\n  ' + cliNote(cli) : '\n  ' + day.convs + ' 个对话（含子代理）') +
        (day.undated ? '\n  还有 ' + day.undated + ' 次调用正在查时间，暂时没算进今天' : '') +
        (day.loading ? '\n  还有 ' + day.loading + ' 个对话正在读取' : '') +
        '\n' + priceSrcText() + '\n\n点击查看每天的用量和额度';
      const ts = seg('cost', ICON('today'), [fmtUsd(dayAll) + ' today'], dtip);
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
  // 生成速度的档位：低于 30 tok/s 慢，30～60 中，高于 60 快（11-22 用户定的）
  const SPEED_TIERS = [[30, 'slow', '慢（低于 30 tok/s）'], [60, 'medium', '中（30～60 tok/s）'], [Infinity, 'fast', '快（高于 60 tok/s）']];
  const speedTier = (tps) => { const x = Number(tps); return x > 0 ? SPEED_TIERS.findIndex((t) => (t[0] === 30 ? x < 30 : x <= t[0])) : 1; };
  // 速度图标：上半圆分成三段（慢 / 中 / 快），指针指向当前档位那一段，这一段实色、另外两段淡色。
  // 圆心 (12,16.5)、半径 8.6、线宽 4（15px 下和旁边的实心图标一样重）；三段之间留 12° 的缝；指针角度：慢 150°、中 90°（朝上）、快 30°。不知道速度时指中间。
  const speedIcon = (tps) => {
    const k = speedTier(tps);
    const cx = 12, cy = 16.5, r = 8.6;
    const pt = (deg, rr) => [(cx + rr * Math.cos(deg * Math.PI / 180)).toFixed(2), (cy - rr * Math.sin(deg * Math.PI / 180)).toFixed(2)];
    const arc = (a1, a2) => { const p1 = pt(a1, r), p2 = pt(a2, r); return 'M' + p1[0] + ' ' + p1[1] + 'A' + r + ' ' + r + ' 0 0 1 ' + p2[0] + ' ' + p2[1]; };
    const segs = [[180, 126], [114, 66], [54, 0]].map(([a1, a2], i) =>
      '<path d="' + arc(a1, a2) + '" fill="none" stroke="currentColor" stroke-width="4" opacity="' + (i === k ? 1 : 0.3) + '"/>').join('');
    const tip = pt([150, 90, 30][k], 7.2);
    const span = el('span', 'ic svg speedo t-' + SPEED_TIERS[k][1]);
    span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + segs +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + tip[0] + '" y2="' + tip[1] + '" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="2.5" fill="currentColor"/></svg>';
    return span;
  };
  // 模型的图标：彗星（ccline 的模型图标也是它）。图形是 Font Awesome Free 6.7.2 的 meteor（solid），
  // 许可 CC BY 4.0（https://fontawesome.com/license/free），版权 Fonticons, Inc.；README 的致谢里也写了。
  const cometIcon = () => {
    const span = el('span', 'ic svg comet');
    span.innerHTML = '<svg viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M493.7 .9L299.4 75.6l2.3-29.3c1-12.8-12.8-21.5-24-15.1L101.3 133.4C38.6 169.7 0 236.6 0 309C0 421.1 90.9 512 203 512c72.4 0 139.4-38.6 175.7-101.3L480.8 234.3c6.5-11.1-2.2-25-15.1-24l-29.3 2.3L511.1 18.3c.6-1.5 .9-3.2 .9-4.8C512 6 506 0 498.5 0c-1.7 0-3.3 .3-4.8 .9zM192 192a128 128 0 1 1 0 256 128 128 0 1 1 0-256zm0 96a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm16 96a16 16 0 1 0 0-32 16 16 0 1 0 0 32z"/></svg>';
    return span;
  };
  const safeCost = (md, ids) => { try { return costSeg(md, ids); } catch (e) { return []; } }; // 出错只少这一项，不影响整条状态栏

  // ---------- 每日用量面板（2026-11-20 加）：点状态栏上的 “$x today” 打开 ----------
  // 过去的天数来自注入程序的 usage-history.json：它每 30 秒把最近 31 天推到 S.history，注入时也经 CFG.history 带过来。
  // 一天的记录：{ usd, convs, models: { 价目名: [美元, 调用数, 输入, 缓存读, 缓存写, 输出] }, quota: { 桶 ID: 额度记录 } }。
  // 额度记录 { n 组名, w 窗口, l 最近一次, u 当天用掉的（按周期分段算净变化）, m 当天最高 }（都是已用比例 0～1），
  // 注入程序按观察到的变化算，见 lib/quota.mjs 的 noteQuota。今天这一行的钱和 token 用页面里实时的账本。
  // S.history.resets（2026-11-24 加）：当前账号每周额度被谷歌提前重置的记录，见下面 resetsOn。
  if (CFG && CFG.history && CFG.history.days && (!S.history || (+CFG.history.at || 0) > (+S.history.at || 0))) S.history = CFG.history;
  const PANEL_CLASS = 'agy-usage-panel';
  const P = '.' + PANEL_CLASS;
  if (!S.panelDays) S.panelDays = 7;
  // 每个价目名一种颜色（白底上不用黄色和浅灰）
  const MODEL_COLOR = { Neon: 'model', Carbon: 'context', Argon: 'argon', Hydrogen: 'tokens', '3.8 Flash': 'cache', 'Opus 5.5': 'quota', 'Sonnet 5.5': 'run' };
  const GROUPS = [['gemini', 'Gemini'], ['3p', 'Claude']]; // 额度分组：桶 ID 的前缀（gemini-… / 3p-…）
  const modelGroup = (name) => (name === 'Other' ? '' : /Opus|Sonnet/.test(name) ? '3p' : 'gemini');
  const hasHistory = () => !!(S.history && S.history.days && Object.keys(S.history.days).length);
  // 全部历史（2026-11-24 加，面板的 all）：注入程序平时每 30 秒推最近 31 天（S.history）；选 all 时经 __agyZhAsk 要一次全部
  // （S.historyAll，最多 400 天），1 分钟内不重复要。某一天先看 S.history（最新），没有再看 S.historyAll。
  const histDay = (name) => (S.history && S.history.days && S.history.days[name]) || (S.historyAll && S.historyAll.days && S.historyAll.days[name]) || null;
  S.setHistoryAll = (h) => {
    if (!h || !h.days || typeof h.days !== 'object') return;
    S.historyAll = h;
    if (document.querySelector(P)) refreshPanel();
  };
  S.askHistoryAll = () => {
    if (S.historyAllAsk && Date.now() - S.historyAllAsk < 60000) return;
    S.historyAllAsk = Date.now();
    try { if (typeof window.__agyZhAsk === 'function') window.__agyZhAsk(JSON.stringify({ t: 'history-all' })); } catch (e) {}
  };
  const ALL_MAX_DAYS = 400;
  // all 显示多少天：最早有用量记录（桌面版或 CLI）的那天到今天，至少 7 天、最多 400 天
  const allDays = () => {
    let f = null;
    for (const src of [S.history, S.historyAll]) {
      for (const [k, d] of Object.entries((src && src.days) || {})) if (d && (d.usd > 0 || d.raw || d.cli) && (!f || k < f)) f = k;
    }
    if (!f) return 7;
    const n = Math.round((new Date(dayName() + 'T12:00:00') - new Date(f + 'T12:00:00')) / 86400e3) + 1;
    return Math.max(7, Math.min(ALL_MAX_DAYS, n));
  };
  // 天数多（> 62）时柱状图一根柱子是一周（周一到周日）：把每天的记录按周合起来
  const WEEKLY_OVER = 62;
  const mondayOf = (nm) => { const d = new Date(nm + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const weekBuckets = (recs) => { // recs 今天在前 → 返回的周也是本周在前
    const map = new Map();
    for (const { nm, r } of recs) {
      const k = mondayOf(nm);
      if (!map.has(k)) map.set(k, { nm: k, r: { week: true, days: [], usd: 0, convs: 0, models: {}, cliUsd: 0, cliCalls: 0, used: 0 } });
      const w = map.get(k).r;
      w.days.push(nm);
      if (!r) continue;
      w.usd += +r.usd || 0;
      w.convs += +r.convs || 0;
      if (r.usd > 0) w.used++;
      if (r.cli) { w.cliUsd += r.cli.usd; w.cliCalls += r.cli.calls; }
      for (const [name, m] of Object.entries(r.models || {})) {
        const t = w.models[name] || (w.models[name] = [0, 0, 0, 0, 0, 0]);
        for (let i = 0; i < 6; i++) t[i] += +m[i] || 0;
      }
    }
    return [...map.values()];
  };
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
  // 补算的天（注入程序从 Antigravity 对话库补的，bf = 1）只有 raw = { 模型名: [调用数, 输入, 缓存读, 缓存写, 输出] }，
  // 在这里按价目表算钱（按那天中午的价），算成和实时记录一样的 models / usd
  const priceRawMap = (raw, name) => {
    const at = new Date(name + 'T12:00:00').getTime();
    const models = {};
    let usd = 0;
    for (const [mid, r] of Object.entries(raw || {})) {
      if (!Array.isArray(r)) continue;
      const cc = callCost({ inputTokens: r[1], cacheReadTokens: r[2], cacheWriteTokens: r[3], outputTokens: r[4] }, mid, at);
      const pname = cc && cc.pr ? cc.pr.name : 'Other';
      const m = models[pname] || (models[pname] = [0, 0, 0, 0, 0, 0]);
      if (cc && cc.usd != null) { m[0] += cc.usd; usd += cc.usd; }
      m[1] += +r[0] || 0; m[2] += +r[1] || 0; m[3] += +r[2] || 0; m[4] += +r[3] || 0; m[5] += +r[4] || 0;
    }
    return { models, usd };
  };
  const priceRaw = (rec, name) => (!rec || !rec.raw || rec.models ? rec : Object.assign({}, rec, priceRawMap(rec.raw, name)));
  // agy CLI 的用量（2026-11-24 加）：注入程序从 ~/.gemini/antigravity-cli/conversations/*.db 按天汇总，
  // 放在每天记录的 cli = { raw: { 模型名: [调用数, 输入, 缓存读, 缓存写, 输出] }, convs, calls }（见 inject.mjs 的 scanCli）。
  // 别的工具调 CLI 用的是同一个账号，额度百分比里本来就有；这里把花费、调用次数、token 也算进每天的合计和今天花费。
  // 按那天中午的价折算（和补算的天一样）；注入程序每 30 秒扫一次 CLI 的库，今天有变化就马上推过来、状态栏马上重画，所以 CLI 正在跑时今天花费最多晚约半分钟。
  const cliDay = (name) => {
    const c = (histDay(name) || {}).cli;
    if (!c || !c.raw) return null;
    return Object.assign(priceRawMap(c.raw, name), { calls: +c.calls || 0, convs: +c.convs || 0 });
  };
  // 桌面版的那天记录 + CLI：models 按价目名相加，usd / convs 加上 CLI 的；cli 换成算好钱的 { models, usd, calls, convs }，deskUsd 留桌面版的金额
  const withCli = (rec, name) => {
    const c = cliDay(name);
    if (!rec && !c) return rec;
    const base = Object.assign({}, rec || {});
    delete base.cli;
    if (!c) return base;
    const models = {};
    for (const [k, m] of Object.entries(base.models || {})) models[k] = m.slice();
    for (const [k, m] of Object.entries(c.models)) {
      const t = models[k] || (models[k] = [0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < 6; i++) t[i] += +m[i] || 0;
    }
    return Object.assign(base, { models, usd: (+base.usd || 0) + c.usd, convs: (+base.convs || 0) + c.convs, deskUsd: +base.usd || 0, cli: c });
  };
  const dayRecord = (name) => {
    const h = priceRaw(histDay(name), name);
    if (name !== dayName()) return withCli(h, name);
    const book = loadBook();
    const vals = Object.values(book.by || {}).map(Number).filter((v) => v >= 0);
    const live = { usd: vals.reduce((a, b) => a + b, 0), convs: vals.filter((v) => v > 0).length, models: sumDet(book.det) };
    return withCli(Object.assign({}, h || {}, h && h.usd > live.usd ? {} : live), name);
  };
  const cliNote = (c) => 'agy CLI ' + fmtUsd(c.usd) + ' · ' + c.convs + ' 个对话 · ' + c.calls + ' 次调用';
  const lastDays = (n) => { // 今天在前
    const out = [];
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    for (let i = 0; i < n; i++) { out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); d.setDate(d.getDate() - 1); }
    return out;
  };
  // 当天用掉的：u（2026-11-20 起的格式，只累计上涨）；v1.4.0 的旧格式按注入程序 migrateQuota 同样的规则换算
  const qUsed = (q) => (q.u != null ? Math.max(0, +q.u || 0)
    : +q.f === 0 && +q.a > 0 ? +q.a : Math.max(0, (+q.m || 0) - (+q.f || 0)) + (+q.a || 0));
  // 一组额度在某一天：wk = 当天用掉的每周额度（0～1，没有记录是 null），peak = 当天 5 小时额度的最高值
  const groupQuota = (rec, grp) => {
    let wk = null, peak = null, name = '';
    for (const [id, q] of Object.entries((rec && rec.quota) || {})) {
      if (!q || !String(id).startsWith(grp + '-')) continue;
      if (q.w === 'weekly') { wk = Math.max(wk || 0, qUsed(q)); name = q.n || name; } else peak = Math.max(peak || 0, +q.m || 0);
    }
    return { wk, peak, name };
  };
  // 提前重置（2026-11-24 加）：每周额度在原定重置时间之前就换了周期（例如 11-24 谷歌提前重置 Gemini 每周额度），注入程序记一条。
  // [{ id 桶 ID, n 组名, w, at 看到重置的时间, after 最后一次看到旧周期的时间（0 = 不知道）, from 重置前已用, was 原定重置时间, flips 读数来回跳的次数 }]
  // 面板上用 ↺ 标出来：柱子下的日期、表格的额度格、悬停卡片、底部每周额度那一行（这个周期是提前重置后开始的）。
  const RESET_MARK = '↺';
  const resetList = () => { // 最近 31 天的（S.history）+ 选 all 时要来的更早的（S.historyAll），按 桶 + 时间 去重
    const seen = new Set();
    return [S.history, S.historyAll].flatMap((h) => (h && Array.isArray(h.resets) ? h.resets : []))
      .filter((e) => e && e.at > 0 && e.id && !seen.has(e.id + '|' + e.at) && seen.add(e.id + '|' + e.at)).sort((a, b) => a.at - b.at);
  };
  const dayOfMs = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const resetsOn = (name, grp) => resetList().filter((e) => dayOfMs(e.at) === name && (!grp || String(e.id).startsWith(grp + '-')));
  const grpLabel = (id) => (GROUPS.find(([g]) => String(id).startsWith(g + '-')) || [, ''])[1];
  const hmOf = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const mdhm = (ms) => { const d = new Date(ms); return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hmOf(ms); };
  // 一条重置记录的说明，例如“Gemini 每周额度 04:05～04:08 之间被提前重置：重置前已用 8.5%，原定 11-29 09:41 重置”
  const resetText = (e) => {
    const when = e.after > 0 && dayOfMs(e.after) === dayOfMs(e.at) ? hmOf(e.after) + '～' + hmOf(e.at) + ' 之间' : hmOf(e.at) + ' 以前';
    return grpLabel(e.id) + ' 每周额度 ' + when + '被提前重置：重置前已用 ' + pctTx(+e.from || 0) + '，原定 ' + mdhm(e.was) + ' 重置' +
      (e.flips ? '（重置时读数来回跳了 ' + e.flips + ' 次，已按跳回的那段接着算，不会重复计算）' : '');
  };
  // 这个周期是不是一次提前重置之后开始的：周期开始（重置时间 − 7 天）前 3 天到开始后 1 小时之间有一条这一组的重置记录。
  // 周期从重置后第一次使用时才开始算（没用过的桶重置时间跟着现在走），所以重置记录会比周期开始早一点。
  const resetBefore = (grp, reset) => {
    const start = reset - WEEK_MS;
    return resetList().filter((e) => String(e.id).startsWith(grp + '-') && e.at <= start + 3600e3 && e.at >= start - 3 * 86400e3).pop() || null;
  };
  // 每周额度预估（2026-11-22 加，v1.6）。注入程序按细粒度读数算好两种速度：这周到现在的平均、最近 24 小时（至少隔 6 小时）。
  // 有最近 24 小时的就用它（更接近现在的用法），没有就用这周平均；这周过去不到 1 天时这周平均很不准，标 rough。
  // 只有这个号的额度只被这台电脑用时才准：和家人共享额度、或者别的电脑也在用这个号，别人用掉的也会算进速度。
  const SHARE_NOTE = '只有这个号的额度只被这台电脑用时才准：如果和家人共享额度，或者别的电脑也在用这个号，别人用掉的也会算进速度里，预估会偏高。';
  const weekEst = (bucketId) => {
    const e = S.history && S.history.est && S.history.est[bucketId];
    if (!e || !(e.used > 0)) return null; // 没用过的桶：重置时间跟着现在走，没法估
    const use24 = e.proj24 != null && e.spanH >= 6;
    const proj = use24 ? e.proj24 : e.projWeek;
    const fullAt = use24 ? e.fullAt24 : e.fullAtWeek;
    const rough = !use24 && e.elapsedH < 24;
    const short = (proj > 1 && fullAt ? 'full ' + fmtWhen(fullAt) : Math.round(Math.min(proj, 9.99) * 100) + '% at reset') + (rough ? ' (rough)' : '');
    const basis = use24 ? '按最近 ' + Math.round(e.spanH) + ' 小时的速度' : '按这周到现在（' + (e.elapsedH < 24 ? Math.round(e.elapsedH) + ' 小时' : (e.elapsedH / 24).toFixed(1) + ' 天') + '）的平均速度';
    const long = basis + '，' + (proj > 1 && fullAt ? '会在 ' + new Date(fullAt).toLocaleString() + ' 左右用完' : '到重置时大约用到 ' + Math.round(proj * 100) + '%') +
      (rough ? '（这周才过去不到 1 天，估得很粗）' : '') +
      (use24 && e.projWeek != null ? '\n按这周平均速度算是 ' + Math.round(Math.min(e.projWeek, 9.99) * 100) + '%' : '');
    return { proj, short, long, rough };
  };
  const weeklyBucket = (grp) => { // 这一组的每周额度桶：{ id（例如 gemini-weekly）, used 已用比例, reset 重置时间毫秒 }
    for (const g of (S.quota && S.quota.groups) || []) for (const b of g.buckets || []) {
      if (String(b.bucketId || '').startsWith(grp + '-') && b.window === 'weekly' && !b.disabled && Number(b.remainingFraction) >= 0) {
        return { id: b.bucketId, used: Math.max(0, Math.min(1, 1 - Number(b.remainingFraction))), reset: tms(b.resetTime) };
      }
    }
    return null;
  };
  // 按每次调用的时间算一段时间里某一组模型的花费（2026-11-24 加）。用在 cap：当前周期开始那天只算周期开始以后的，
  // 以前的周期两头那两天只算周期里的（原来按整天算，例如 11-24 09:31 才开始的 Gemini 周期，把 00:00～04:05 旧周期的花费也算了进去）。
  // 每次调用的时间来自调用明细同一套数据：桌面版用 S.loadCalls（向本机后台取，按对话缓存，只补取改过的对话），
  // CLI 用 S.cliCalls（注入程序给，见 S.cliAsk）。桌面版的结果按“组|日子|起|止”缓存：日子是今天时 2 分钟内不重取，
  // 以前的天 1 小时内不重取；CLI 的部分每次现算（明细可能比桌面版的晚到）。还没取到时返回 null，调用方先按整天算。
  // 今天缓存没命中的合计（每日面板底部一行）：和调用明细、cap 同一套数据（S.loadCalls，按对话缓存，只补取改过的对话），
  // 2 分钟内不重取；agy CLI 的部分每次现算。还没取到时返回 null（先不显示这一行）。total = 今天每次调用的合计（算比例用）
  S.missDay = S.missDay || { day: '', at: 0, busy: false, rows: null };
  const missToday = () => {
    const c = S.missDay, nm = dayName();
    if (c.day !== nm) { c.day = nm; c.at = 0; c.rows = null; }
    if (!c.busy && Date.now() - c.at >= 120000 && S.lsHeaders && S.loadCalls) {
      c.busy = true;
      S.cliAsk(nm);
      S.loadCalls(nm).then((res) => { if (c.day === nm) c.rows = res.rows; }).catch(() => {}).then(() => {
        c.at = Date.now();
        c.busy = false;
        if (S.panelView === 'usage' && document.querySelector(P)) refreshPanel();
      });
    }
    if (!c.rows) return null;
    const rows = c.rows.concat(cliMiss(cliRows(nm)));
    const s = missSum(rows);
    s.total = 0;
    for (const r of rows) { const cc = callCost(r.usage, r.cli ? r.resp : callNames(r.resp, r.key, r.exec), r.at); s.total += (cc && cc.usd) || 0; }
    return s;
  };
  S.capPart = S.capPart || {};
  const inRange = (at, from, to) => at >= from && at < to;
  const callsPart = (grp, nm, from, to) => {
    const k = grp + '|' + nm + '|' + from + '|' + to;
    const c = S.capPart[k] || (S.capPart[k] = { at: 0, busy: false, desk: null });
    if (!c.busy && Date.now() - c.at >= (nm === dayName() ? 120000 : 3600e3) && S.lsHeaders && S.loadCalls) {
      c.busy = true;
      S.cliAsk(nm);
      S.loadCalls(nm).then((res) => {
        let usd = 0, tok = 0;
        for (const r of res.rows) {
          if (!inRange(r.at, from, to)) continue;
          const cc = callCost(r.usage, callNames(r.resp, r.key, r.exec), r.at);
          if (!cc || modelGroup(cc.pr ? cc.pr.name : 'Other') !== grp) continue;
          usd += cc.usd || 0;
          tok += cc.inp + cc.cr + cc.cw + cc.out;
        }
        c.desk = { usd, tok, failed: res.failed || 0 };
      }).catch(() => {}).then(() => {
        c.at = Date.now();
        c.busy = false;
        if (S.panelView === 'usage' && document.querySelector(P)) refreshPanel();
      });
    }
    if (!c.desk) return null;
    let usd = c.desk.usd, tok = c.desk.tok;
    for (const r of cliRows(nm)) {
      if (!inRange(r.at, from, to)) continue;
      const cc = callCost(r.usage, r.resp, r.at);
      if (!cc || modelGroup(cc.pr ? cc.pr.name : 'Other') !== grp) continue;
      usd += cc.usd || 0;
      tok += cc.inp + cc.cr + cc.cw + cc.out;
    }
    return { usd, tok, failed: c.desk.failed };
  };
  // 一段时间（start～end，end 可以是 Infinity = 到现在）里某一组模型的花费和 token：整天都在里面的按那天的合计，
  // 只有一部分在里面的那天按每次调用的时间（callsPart）。exact = false：有的天还没按调用时间算好，暂时按整天算的
  const cycleCost = (grp, start, end) => {
    let usd = 0, tok = 0, exact = true, failed = 0;
    const d = new Date(start);
    d.setHours(12, 0, 0, 0);
    const today = dayName();
    for (let i = 0; i < 12; i++) {
      const nm = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const d0 = new Date(nm + 'T00:00:00').getTime(), d1 = new Date(nm + 'T00:00:00').setDate(new Date(nm + 'T00:00:00').getDate() + 1);
      if (d0 >= end) break;
      const whole = () => {
        for (const [name, m] of Object.entries(((dayRecord(nm) || {}).models) || {})) {
          if (modelGroup(name) === grp) { usd += +m[0] || 0; tok += (+m[2] || 0) + (+m[3] || 0) + (+m[4] || 0) + (+m[5] || 0); }
        }
      };
      if (start <= d0 && end >= d1) whole();
      else {
        const p = callsPart(grp, nm, Math.max(start, d0), end >= d1 ? Infinity : end);
        if (p) { usd += p.usd; tok += p.tok; failed += p.failed; } else { exact = false; whole(); }
      }
      if (nm === today) break;
      d.setDate(d.getDate() + 1);
    }
    return { usd, tok, exact, failed };
  };
  // 以前的周期（注入程序记的 cycles，见 lib/quota.mjs 的 noteCycleEnd）：这个桶的，最近的在前
  const pastCycles = (bucketId) => {
    const seen = new Set();
    return [S.history, S.historyAll].flatMap((h) => (h && Array.isArray(h.cycles) ? h.cycles : []))
      .filter((e) => e && e.id === bucketId && e.end > e.start && !seen.has(e.start) && seen.add(e.start)).sort((a, b) => b.start - a.start);
  };
  const recTokens = (r) => {
    const t = [0, 0, 0, 0, 0]; // 调用数、输入、缓存读、缓存写、输出
    for (const m of Object.values((r && r.models) || {})) for (let i = 0; i < 5; i++) t[i] += +m[i + 1] || 0;
    return t;
  };
  const tokSum = (t) => t[1] + t[2] + t[3] + t[4]; // 输入 + 缓存读 + 缓存写 + 输出
  // 三位有效数字左右：1.35B、30.3M、271M、98.7k
  const fmtTok = (n) => { n = Number(n) || 0; const f = (v, u) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)) + u;
    return n >= 1e9 ? f(n / 1e9, 'B') : n >= 1e6 ? f(n / 1e6, 'M') : n >= 1e3 ? f(n / 1e3, 'k') : String(n); };
  const tokTip = (t) => 'token 合计 ' + tokSum(t).toLocaleString() + ' = 输入 ' + t[1].toLocaleString() + ' + 缓存读 ' + t[2].toLocaleString() +
    (t[3] ? ' + 缓存写 ' + t[3].toLocaleString() : '') + ' + 输出 ' + t[4].toLocaleString() + '（输出含思考）';
  const pctTx = (f) => (f * 100 < 10 ? (f * 100).toFixed(1) : String(Math.round(f * 100))) + '%';
  const dayLabel = (name) => { const d = new Date(name + 'T12:00:00'); return { wd: WEEKDAY[d.getDay()], md: (d.getMonth() + 1) + '-' + d.getDate(), d: String(d.getDate()) }; };
  // ---------- 面板里的悬停卡片（2026-11-20 改）：代替系统提示框，立即弹出、跟着鼠标、带模型颜色 ----------
  // tips：元素 → 生成卡片内容的函数（返回节点数组）。只用在柱子、图例和表格日期上，其余地方仍用 title。
  const fmtUsdShort = (v) => (v < 0.01 ? '<$0.01' : v < 10 ? '$' + v.toFixed(2) : v < 100 ? '$' + v.toFixed(1) : '$' + Math.round(v));
  const cardRow = (name, value, note) => {
    const row = el('div', 'row k-' + (MODEL_COLOR[name] || 'muted'));
    row.append(el('i'), el('span', 'n', name), el('span', 'v', value));
    if (note) row.append(el('span', 'dim', note));
    return row;
  };
  const dayCard = (name, r) => {
    const lb = dayLabel(name);
    const out = [el('div', 't', lb.wd + ' ' + lb.md + (name === dayName() ? ' · today' : ''))];
    const rs = resetsOn(name).map((e) => el('div', 'q', RESET_MARK + ' ' + resetText(e)));
    if (!r || !(r.usd > 0 || recTokens(r)[0] > 0)) { out.push(el('div', 'dim', '没有用量记录'), ...rs); return out; }
    const t = recTokens(r);
    out.push(el('div', 'sum', fmtUsd(r.usd || 0) + ' · ' + (r.convs || 0) + ' 个对话 · ' + t[0] + ' 次调用'));
    if (r.cli) out.push(el('div', 'dim', '其中 ' + cliNote(r.cli) + '；桌面版 ' + fmtUsd(r.deskUsd || 0)));
    let shown = 0;
    for (const [n, m] of Object.entries(r.models || {}).filter(([, m]) => m[0] > 0 || m[1] > 0).sort((a, b) => b[1][0] - a[1][0])) {
      shown += m[0];
      out.push(cardRow(n, fmtUsd(m[0]), r.usd > 0 ? Math.round(m[0] / r.usd * 100) + '%' : ''));
    }
    if ((r.usd || 0) - shown > 0.0005) out.push(cardRow('Other', fmtUsd(r.usd - shown), '没按模型拆开'));
    if (t[1] + t[2] > 0) out.push(el('div', 'dim', 'token：输入 ' + fmtK(t[1]) + ' · 缓存 ' + fmtK(t[2]) + ' · 输出 ' + fmtK(t[4]) + ' · 命中 ' + Math.round(t[2] / (t[1] + t[2]) * 100) + '%'));
    for (const [grp, label] of GROUPS) {
      const q = groupQuota(r, grp);
      if (q.wk != null) out.push(el('div', 'q', label + ' 每周额度 +' + pctTx(q.wk) + (q.peak != null ? ' · 5 小时最高 ' + pctTx(q.peak) : '')));
    }
    out.push(...rs);
    if (r.bf) out.push(el('div', 'dim', '从 Antigravity 对话库补算，没有额度记录'));
    else if (r.fix) out.push(el('div', 'dim', '实时记录少算了，花费和 token 已按 Antigravity 对话库重算'));
    out.push(el('div', 'dim', '钱按 API 标准价折算，不是实际扣费；' + (priceSrc.online ? '在线价格表 ' + priceSrc.updated : '内置价格表')));
    return out;
  };
  // 一周的卡片（按周显示时，2026-11-24 加）：那周的合计、各模型、其中 agy CLI 多少、有提前重置就写出来
  const weekCard = (name, w) => {
    const days = w.days.slice().sort();
    const a = dayLabel(days[0]), b = dayLabel(days[days.length - 1]);
    const out = [el('div', 't', 'Week ' + a.md + ' – ' + b.md + (days.includes(dayName()) ? ' · this week' : ''))];
    if (!(w.usd > 0)) { out.push(el('div', 'dim', '没有用量记录')); return out; }
    const t = recTokens(w);
    out.push(el('div', 'sum', fmtUsd(w.usd) + ' · ' + w.used + ' 天有用量 · ' + t[0] + ' 次调用'));
    if (w.cliUsd > 0) out.push(el('div', 'dim', '其中 agy CLI ' + fmtUsd(w.cliUsd) + ' · ' + w.cliCalls + ' 次调用'));
    let shown = 0;
    for (const [n, m] of Object.entries(w.models).filter(([, m]) => m[0] > 0).sort((x, y) => y[1][0] - x[1][0])) {
      shown += m[0];
      out.push(cardRow(n, fmtUsd(m[0]), Math.round(m[0] / w.usd * 100) + '%'));
    }
    if (w.usd - shown > 0.0005) out.push(cardRow('Other', fmtUsd(w.usd - shown), '没按模型拆开'));
    for (const d of days) for (const e of resetsOn(d)) out.push(el('div', 'q', RESET_MARK + ' ' + dayLabel(d).md + ' ' + resetText(e)));
    out.push(el('div', 'dim', '点柱子跳到表格里那周最近的一天；钱按 API 标准价折算，不是实际扣费'));
    return out;
  };
  const partCard = (name, model, m, dayUsd, r) => {
    const lb = dayLabel(name);
    const head = el('div', 't row k-' + (MODEL_COLOR[model] || 'muted'));
    head.append(el('i'), el('span', '', model + ' · ' + (r && r.week ? 'week of ' + lb.md : lb.wd + ' ' + lb.md)));
    const out = [head, el('div', 'sum', fmtUsd(m[0]) + (dayUsd > 0 ? '（占当天 ' + Math.round(m[0] / dayUsd * 100) + '%）' : '') + (m[1] ? ' · ' + m[1] + ' 次调用' : ''))];
    const cm = r && r.cli && r.cli.models[model];
    if (cm && (cm[0] > 0 || cm[1] > 0)) out.push(el('div', 'dim', '其中 agy CLI ' + fmtUsd(cm[0]) + ' · ' + cm[1] + ' 次调用'));
    if (m[2] || m[3] || m[5]) out.push(el('div', 'dim', '输入 ' + fmtK(m[2]) + ' · 缓存 ' + fmtK(m[3]) + (m[4] ? ' · 缓存写 ' + fmtK(m[4]) : '') + ' · 输出 ' + fmtK(m[5])));
    if (m[2] + m[3] > 0) out.push(el('div', 'dim', '缓存命中 ' + Math.round(m[3] / (m[2] + m[3]) * 100) + '%'));
    return out;
  };
  const attachCard = (panel, tips) => {
    const card = el('div', 'p-card');
    card.hidden = true;
    panel.append(card);
    let owner = null;
    panel.onmousemove = (ev) => {
      let t = ev.target;
      let f = null;
      while (t && t !== panel) { f = tips.get(t); if (f) break; t = t.parentElement; }
      if (!f) { card.hidden = true; owner = null; return; }
      if (owner !== t) { card.replaceChildren(...f()); owner = t; }
      card.hidden = false;
      const pr = panel.getBoundingClientRect();
      const w = card.offsetWidth, h = card.offsetHeight;
      let x = ev.clientX - pr.left + 14, y = ev.clientY - pr.top + 16;
      if (x + w > panel.clientWidth - 6) x = ev.clientX - pr.left - w - 12;
      if (y + h > panel.clientHeight - 6) y = ev.clientY - pr.top - h - 10;
      card.style.left = Math.max(4, x + panel.scrollLeft) + 'px';
      card.style.top = Math.max(4, y + panel.scrollTop) + 'px';
    };
    panel.onmouseleave = () => { card.hidden = true; owner = null; };
  };

  // refresh：定时刷新（每 30 秒、在线更新推过来时），不是用户点的
  const renderPanel = (panel, refresh) => {
    lookAttrs(panel);
    if (S.panelView === 'look') { renderLook(panel); return; }
    if (S.panelView === 'calls') { renderCalls(panel, refresh); return; }
    if (S.panelView === 'ckpt') { renderCkpt(panel); return; }
    // all（2026-11-24 加）：从最早有记录的那天到今天；全部历史还没要来时先用最近 31 天，要来后自动重画
    const isAll = S.panelDays === 'all';
    if (isAll && (!S.historyAll || Date.now() - (S.historyAllAsk || 0) > 600000)) S.askHistoryAll();
    const n = isAll ? allDays() : S.panelDays;
    const recs = lastDays(n).map((nm) => ({ nm, r: dayRecord(nm) }));
    const weekly = n > WEEKLY_OVER;
    const barRecs = weekly ? weekBuckets(recs) : recs; // 柱状图用的：天数多时一根柱子一周
    const tips = new WeakMap();
    panel.replaceChildren();

    // 标题行：名字、7d / 30d / all、日期范围和合计、关闭
    const usedDays = recs.filter(({ r }) => r && r.usd > 0);
    const total = usedDays.reduce((a, { r }) => a + r.usd, 0);
    const head = el('div', 'p-head');
    const title = el('span', 'p-title', 'Daily usage');
    setTip(title, '每天的用量：钱按 API 标准价折算（不是实际扣费），额度是当天用掉的每周额度\n' +
      '花费、调用和 token 含这台电脑上 agy CLI 的用量（别的工具直接调 CLI 也算在内）\n' + priceSrcText());
    head.append(title);
    for (const k of [7, 30, 'all']) {
      const b = el('button', 'p-btn' + (k === S.panelDays ? ' on' : ''), k === 'all' ? 'all' : k + 'd');
      setTip(b, k === 'all' ? '从最早有记录的那天到今天（最多 ' + ALL_MAX_DAYS + ' 天）；超过 ' + WEEKLY_OVER + ' 天时柱状图一根柱子是一周' : '最近 ' + k + ' 天');
      b.addEventListener('click', () => { S.panelDays = k; renderPanel(panel); });
      head.append(b);
    }
    const first = dayLabel(recs[recs.length - 1].nm), last = dayLabel(recs[0].nm);
    head.append(el('span', 'p-range', first.md + ' – ' + last.md + ' · ' + fmtUsd(total)));
    const x = el('button', 'p-btn p-x', '×');
    setTip(x, '关闭（Esc）');
    x.addEventListener('click', closePanel);
    const th = el('button', 'p-btn');
    th.append(el('span', 'ic', 'palette'), 'theme');
    setTip(th, '状态栏外观：配色、外形、进度条、信息密度');
    th.addEventListener('click', () => { S.panelView = 'look'; renderPanel(panel); });
    // 账号（v1.6）：打码邮箱 + 套餐；额度历史按账号分开记，钱和 token 是这台电脑上所有账号的合计
    const ac = S.account || (S.history && S.history.acct);
    const acEl = ac && ac.m ? el('span', 'p-acct', ac.m + (ac.t ? ' · ' + ac.t.replace(/^Google AI\s+/i, '') : '')) : null;
    if (acEl) setTip(acEl, '当前账号 ' + ac.m + (ac.t ? '（' + ac.t + '）' : '') +
      '\n额度（Gemini wk / Claude wk、底部的每周额度和预估）只算这个账号；花费和 token 是这台电脑上的合计，不分账号。');
    // 新版本（v1.7）：仓库 data/meta.json 的 latest 比装着的新就提示。代码不会自动更新，要自己下载安装包
    const rm = S.remote || {};
    const upEl = rm.meta && rm.version && verGt(rm.meta.latest, rm.version)
      ? setTip(el('span', 'p-new', 'v' + rm.meta.latest + ' available'), '新版本 v' + rm.meta.latest + (rm.meta.date ? '（' + rm.meta.date + ' 发布）' : '') +
        '，你装的是 v' + rm.version + '。\n到 GitHub 上 ncdeng/agy-zh-pack 项目的 Releases 页下载安装包，覆盖安装就行（每日记录和外观都保留）。' +
        '\n词典和价格平时会自动更新，不用为它们升级。')
      : null;
    head.append(el('span', 'p-fill'), ...(upEl ? [upEl] : []), ...(acEl ? [acEl] : []), th, x);
    panel.append(head);

    // 今天的汇总（11-22 加）：花费、调用次数、token 合计、缓存命中率。今天这一行用页面里实时的账本（同表格第一行）
    const tr0 = dayRecord(dayName());
    const t0 = recTokens(tr0);
    const kpi = el('div', 'p-kpi');
    const kcell = (lab, val, tip, kind) => { const c = el('div', 'kc k-' + kind); c.append(el('span', 'kl', lab), el('span', 'kv', val)); setTip(c, tip); return c; };
    kpi.append(
      kcell('today', fmtUsd((tr0 && tr0.usd) || 0), '今天按 API 标准价折算的花费（不是实际扣费）' +
        (tr0 && tr0.cli ? '\n桌面版 ' + fmtUsd(tr0.deskUsd || 0) + ' + ' + cliNote(tr0.cli) : ''), 'cost'),
      kcell('calls', String(t0[0]), '今天的模型调用次数（含子代理' + (tr0 && tr0.cli ? '，其中 agy CLI ' + tr0.cli.calls + ' 次' : '') + '）', 'model'),
      kcell('tokens', fmtTok(tokSum(t0)), '今天的' + tokTip(t0), 'tokens'),
      kcell('cache hit', t0[1] + t0[2] > 0 ? Math.round(t0[2] / (t0[1] + t0[2]) * 100) + '%' : '—', '今天的缓存命中率 = 缓存读 ÷（缓存读 + 输入）', 'cache'));
    panel.append(kpi);

    // 柱状图：左旧右新，按模型分颜色叠起来（金额大的在下面）；柱顶标金额，虚线是有用量的天的日均
    // 按周（weekly）时：每根柱子是一周（nm = 那周的周一，r.days = 那周的日子），悬停看那一周，表格仍是每天一行
    const max = Math.max(1e-6, ...barRecs.map(({ r }) => (r && r.usd) || 0));
    const chart = el('div', 'p-chart');
    const bars = el('div', 'p-bars');
    const labels = el('div', 'p-labels' + (n > 7 ? ' dense' : ''));
    const cols = new Map();
    const totals = new Map(); // 价目名 → [美元, 调用数]
    const maxDay = barRecs.reduce((a, b) => ((b.r && b.r.usd) || 0) > ((a.r && a.r.usd) || 0) ? b : a, barRecs[0]).nm;
    const thisWeek = mondayOf(dayName());
    const labelStep = weekly ? Math.max(1, Math.ceil(barRecs.length / 16)) : 1; // 按周时最多写约 16 个日期
    barRecs.slice().reverse().forEach(({ nm, r }, bi) => {
      const col = el('div', 'p-col');
      col.dataset.day = nm;
      tips.set(col, () => (weekly ? weekCard(nm, r) : dayCard(nm, r)));
      if (weekly) for (const d of r.days) cols.set(d, col); else cols.set(nm, col);
      let shown = 0;
      let top = null;
      for (const [model, m] of Object.entries((r && r.models) || {}).filter(([, m]) => m[0] > 0).sort((a, b) => b[1][0] - a[1][0])) {
        const part = el('div', 'p-part k-' + (MODEL_COLOR[model] || 'muted'));
        part.style.height = (m[0] / max * 100) + '%';
        part.dataset.m = model;
        tips.set(part, () => partCard(nm, model, m, r.usd, r));
        col.append(part);
        top = part;
        shown += m[0];
        const tt = totals.get(model) || [0, 0];
        tt[0] += m[0]; tt[1] += m[1];
        totals.set(model, tt);
      }
      const rest = ((r && r.usd) || 0) - shown;
      if (rest > 0.0005) {
        const part = el('div', 'p-part k-muted');
        part.style.height = (rest / max * 100) + '%';
        part.dataset.m = 'Other';
        tips.set(part, () => [el('div', 't', (weekly ? 'week of ' + dayLabel(nm).md : dayLabel(nm).wd + ' ' + dayLabel(nm).md) + ' · 没按模型拆开的部分'), el('div', 'sum', fmtUsd(rest))]);
        col.append(part);
        top = part;
        const tt = totals.get('Other') || [0, 0];
        tt[0] += rest;
        totals.set('Other', tt);
      }
      if (top) top.classList.add('top');
      const usd = (r && r.usd) || 0;
      const isCur = weekly ? nm === thisWeek : nm === dayName();
      if (usd > 0 && (n <= 7 || nm === maxDay || isCur)) col.append(el('span', 'p-val', fmtUsdShort(usd)));
      // 点柱子：表格里对应的那一行（按周时是那周最近有记录的一天）滚到眼前并闪一下
      col.addEventListener('click', () => {
        const tr = (weekly ? r.days : [nm]).map((d) => panel.querySelector('tr[data-day="' + d + '"]')).find(Boolean);
        if (!tr) return;
        tr.scrollIntoView({ block: 'nearest' });
        tr.classList.remove('flash');
        void tr.offsetWidth;
        tr.classList.add('flash');
      });
      bars.append(col);
      const lb = dayLabel(nm);
      const lab = el('span', isCur ? 'today' : '');
      if (n <= 7) lab.append(el('b', '', lb.wd), el('i', '', lb.md));
      else if (weekly) { if (isCur || (barRecs.length - 1 - bi) % labelStep === 0) lab.append(el('i', '', lb.md)); }
      else if (isCur || new Date(nm + 'T12:00:00').getDay() === 1) lab.append(el('i', '', lb.md));
      // 那天（按周时那一周里）有提前重置：日期后面加 ↺（没写日期的也标），悬停和柱子一样显示那天 / 那周的卡片
      if ((weekly ? r.days : [nm]).some((d) => resetsOn(d).length)) {
        let host = lab.querySelector('i');
        if (!host) { host = el('i'); lab.append(host); }
        host.append(el('em', 'p-rs', RESET_MARK));
        tips.set(lab, () => (weekly ? weekCard(nm, r) : dayCard(nm, r)));
      }
      labels.append(lab);
    });
    // 虚线：有用量的天平均每天（按周时：有用量的周平均每周，和柱子同一个比例）
    const usedBars = weekly ? barRecs.filter(({ r }) => r.usd > 0) : usedDays;
    if (usedBars.length >= 2) {
      const avg = usedBars.reduce((a, { r }) => a + r.usd, 0) / usedBars.length;
      const line = el('div', 'p-avg');
      line.style.bottom = (avg / max * 100) + '%';
      // 11-22：不再在线的右端写 “avg $xx”——会和最右边（今天）柱子顶上的金额叠在一起；日均写在底部小结里
      setTip(line, weekly ? '有用量的 ' + usedBars.length + ' 周平均每周 ' + fmtUsd(avg) : '有用量的 ' + usedBars.length + ' 天平均每天 ' + fmtUsd(avg));
      bars.append(line);
    }
    chart.append(bars);
    panel.append(chart, labels);

    // 图例：每个模型这段时间的合计，按金额从高到低；鼠标停上去，每一天里这个模型的那一段都高亮
    if (totals.size) {
      const legend = el('div', 'p-legend');
      for (const [model, tt] of [...totals].sort((a, b) => b[1][0] - a[1][0])) {
        const it = el('span', 'k-' + (MODEL_COLOR[model] || 'muted'));
        it.append(el('i'), el('span', '', model), el('span', 'v', fmtUsdShort(tt[0])));
        tips.set(it, () => [el('div', 't', model + ' · 最近 ' + n + ' 天'),
          el('div', 'sum', fmtUsd(tt[0]) + (total > 0 ? '（占 ' + Math.round(tt[0] / total * 100) + '%）' : '') + (tt[1] ? ' · ' + tt[1] + ' 次调用' : ''))]);
        it.addEventListener('mouseenter', () => {
          bars.classList.add('focus');
          for (const p of bars.querySelectorAll('.p-part')) p.classList.toggle('hl', p.dataset.m === model);
        });
        it.addEventListener('mouseleave', () => bars.classList.remove('focus'));
        legend.append(it);
      }
      panel.append(legend);
    }

    // 表格：有记录的天，今天在最上面；表头固定，太长就在表格里滚动。鼠标停在某一行，对应的柱子高亮
    const rows = recs.filter(({ r }) => r && ((r.usd || 0) > 0 || recTokens(r)[0] > 0 || GROUPS.some(([g]) => groupQuota(r, g).wk != null)));
    if (!rows.length) {
      const empty = el('div', 'p-empty', 'no usage recorded yet');
      setTip(empty, '这段时间没有用量记录（以前的天数由注入程序从 Antigravity 对话库补算，补算完会自动出现）');
      panel.append(empty);
    } else {
      const table = el('table');
      const thead = el('thead');
      const hr = el('tr');
      const heads = [['Date', ''], ['Cost', '按 API 标准价折算的花费（不是实际扣费）'], ['Convs', '当天动过的对话数（含子代理）'], ['Calls', '模型调用次数'], ['Tokens', 'token 合计 = 输入 + 缓存读 + 缓存写 + 输出'],
        ['In', '输入 token（不含缓存）'], ['Cache', '缓存读取 token'], ['Out', '输出 token（含思考）'], ['Hit', '缓存命中率 = 缓存读取 ÷（缓存读取 + 输入）'],
        ...GROUPS.map(([, label]) => [label + ' wk', '当天用掉了多少个百分点的' + label + '每周额度\n' + RESET_MARK + ' = 那天这组每周额度被提前重置了（还没到原定的重置时间）'])];
      for (const [h, t] of heads) { const th = el('th', '', h); setTip(th, t); hr.append(th); }
      thead.append(hr);
      const tbody = el('tbody');
      for (const { nm, r } of rows) {
        const t = recTokens(r);
        const tr = el('tr', (nm === dayName() ? 'today' : '') + (r.bf ? ' bf' : ''));
        tr.dataset.day = nm;
        const lb = dayLabel(nm);
        const td0 = el('td', '', lb.md + ' ' + lb.wd);
        tips.set(td0, () => dayCard(nm, r));
        const hit = t[1] + t[2] > 0 ? Math.round(t[2] / (t[1] + t[2]) * 100) + '%' : '—';
        const tdTok = el('td', 'tk', fmtK(tokSum(t)));
        setTip(tdTok, tokTip(t));
        const tdCost = el('td', 'c', fmtUsd(r.usd || 0));
        if (r.cli) setTip(tdCost, '桌面版 ' + fmtUsd(r.deskUsd || 0) + ' + ' + cliNote(r.cli));
        tr.append(td0, tdCost, el('td', '', String(r.convs || 0)), el('td', '', String(t[0])), tdTok,
          el('td', '', fmtK(t[1])), el('td', '', fmtK(t[2])), el('td', '', fmtK(t[4])), el('td', 'h', hit));
        for (const [grp] of GROUPS) {
          const q = groupQuota(r, grp);
          const rs = resetsOn(nm, grp);
          const td = el('td', 'q', q.wk == null ? '—' : '+' + pctTx(q.wk));
          if (rs.length) td.append(el('em', 'p-rs', RESET_MARK));
          const tip = [q.peak != null ? '5 小时额度当天最高 ' + pctTx(q.peak) : r.bf ? '补算的天没有额度记录' : '', ...rs.map(resetText)].filter(Boolean);
          if (rs.length && q.wk != null) tip.push('当天用掉的 = 重置前那段的净增加 + 重置后这段的已用');
          if (tip.length) setTip(td, tip.join('\n'));
          tr.append(td);
        }
        const col = cols.get(nm);
        if (col) {
          tr.addEventListener('mouseenter', () => col.classList.add('sel'));
          tr.addEventListener('mouseleave', () => col.classList.remove('sel'));
        }
        tr.classList.add('clk');
        tr.addEventListener('click', () => { S.panelView = 'calls'; S.callsDay = nm; renderPanel(panel); });
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const wrap = el('div', 'p-table');
      wrap.append(table);
      panel.append(wrap);
    }

    // 底部：这段时间的合计；每组额度：现在用了多少、这段时间用掉多少、折算下来 1% 每周额度大约值多少钱
    const foot = el('div', 'p-foot');
    const tN = [0, 0, 0, 0, 0];
    for (const { r } of recs) recTokens(r).forEach((v, i) => { tN[i] += v; });
    const l1 = el('div', 'k-cost', (isAll ? 'all ' + n + 'd ' : 'last ' + n + 'd ') + fmtUsd(total) + (tokSum(tN) ? ' · ' + fmtTok(tokSum(tN)) + ' tokens' : '') +
      (usedDays.length ? ' · avg ' + fmtUsd(total / usedDays.length) + '/day · ' + usedDays.length + ' days' : ''));
    setTip(l1, (isAll ? '从最早有记录的 ' + dayLabel(recs[recs.length - 1].nm).md + ' 起 ' : '最近 ') + n + ' 天合计（按 API 标准价折算）；平均值只算有用量的天' + (tokSum(tN) ? '\n' + tokTip(tN) + '，' + tN[0].toLocaleString() + ' 次调用' : ''));
    foot.append(l1);
    // 今天缓存没命中多花的钱（2026-11-24 加），按原因分开；点一下打开今天的明细、只看没命中的
    const mt = missToday();
    if (mt && mt.n) {
      const parts = ['cache miss today +' + fmtUsd(mt.usd) + (mt.total > 0 ? ' (' + Math.round(mt.usd / mt.total * 100) + '%)' : '')];
      for (const k of MISS_ORDER) if (mt.by[k] && mt.by[k][1] >= 0.05) parts.push(MISS_CAUSE[k][0] + ' ' + fmtUsd(mt.by[k][1])); // 不到 5 美分的原因只写在悬停说明里
      const l2 = el('div', 'k-cost k-miss clk', parts.join(' · ')); // 颜色和上面花费那一行一样
      setTip(l2, '今天缓存没命中 ' + mt.n + ' 次，多花约 ' + fmtUsd(mt.usd) + '（按 API 标准价；今天每次调用的合计是 ' + fmtUsd(mt.total) + '）：' + missTip(mt) +
        '\n\n' + MISS_FACT + '\n\n点一下打开今天的明细，只看没命中的调用。');
      l2.addEventListener('click', () => { S.panelView = 'calls'; S.callsDay = dayName(); S.callsMiss = true; renderPanel(panel); });
      foot.append(l2);
    }
    // 每组每周额度一行（11-22 改：按重置周期算）。周期 = 重置时间往前推 7 天 → 重置时间，例如 11-22 09:41 → 11-29 09:41。
    // 原来写的是“最近 n 个自然日里用掉多少”和按这些天算的“每 1% 折合多少钱”，和额度的周期对不上（用户指出）。
    //   已用：状态栏查到的这个周期的已用比例；没用过的桶（已用 0）重置时间跟着现在走，周期还没开始，只写 0% used。
    //   整周额度大约值多少（cap，11-22 用户要的“预计周限额 800 刀、900M 用量”）：这个周期开始那天起，每天这一组模型的
    //   花费和 token 合计 ÷ 已用比例，推出用满 100% 大约对应多少钱、多少 token。
    //   2026-11-24 起周期开始那天只算周期开始以后的调用（见 cycleCost / callsPart），原来那天整天都算在内。
    //   已用不到 5% 时误差很大，标 rough；额度按模型和 token 种类怎么折算 Google 没公布，这里按花费和 token 同比例推，只是参考。
    for (const [grp, label] of GROUPS) {
      const wb = weeklyBucket(grp);
      if (!wb) continue;
      const parts = [label + ' weekly', Math.round(wb.used * 100) + '% used'];
      let tip = label + ' 组每周额度（周期按重置时间算）：';
      let est = null;
      if (wb.used > 0 && wb.reset > 0) {
        const start = wb.reset - WEEK_MS;
        parts.push('resets ' + fmtWhen(wb.reset));
        est = weekEst(wb.id);
        if (est) parts.push('est ' + est.short);
        // 这个周期开始到现在，这一组模型的花费和 token（输入 + 缓存读 + 缓存写 + 输出）。
        // 开始那天按每次调用的时间只算周期开始以后的（cycleCost / callsPart，后台取好之前先按整天算）；之后的天按整天算
        const cost = cycleCost(grp, start, Infinity);
        const usd = cost.usd, tok = cost.tok;
        const part = cost.exact ? cost : null;
        const capOk = wb.used >= 0.01 && usd > 0;
        const capUsd = capOk ? usd / wb.used : 0, capTok = capOk ? tok / wb.used : 0;
        const capRough = wb.used < 0.05;
        if (capOk) parts.splice(2, 0, 'cap ≈ ' + fmtUsd(capUsd) + ' / ' + fmtTok(capTok) + ' tok' + (capRough ? ' (rough)' : ''));
        const sd = new Date(start), rd = new Date(wb.reset);
        const md = (x) => (x.getMonth() + 1) + '-' + x.getDate() + ' ' + pad(x.getHours()) + ':' + pad(x.getMinutes());
        tip += '\n这个周期 ' + md(sd) + ' 开始，' + md(rd) + ' 重置；现在已用 ' + pctTx(wb.used) + '。' +
          (usd > 0 ? '\n这个周期里' + label + '模型用了 ' + fmtUsd(usd) + '、' + fmtTok(tok) + ' token' +
            (part ? '（从 ' + md(sd) + ' 周期开始起，按每次调用的时间合计' + (part.failed ? '；那天有 ' + part.failed + ' 个对话没取到，可能少算' : '') + '）。'
              : '（从 ' + (sd.getMonth() + 1) + '-' + sd.getDate() + ' 起按天合计，周期开始那天暂时整天都算在内，正在按每次调用的时间重算）。') : '') +
          (capOk ? '\n\n整周额度（cap）：按这个比例，用满 100% 大约相当于 ' + fmtUsd(capUsd) + '、' + fmtTok(capTok) + ' token；' +
            '还剩约 ' + fmtUsd(capUsd - usd) + '、' + fmtTok(Math.max(0, capTok - tok)) + ' token。' +
            (capRough ? '\n现在才用了 ' + pctTx(wb.used) + '，推算误差很大，用得越多越准。' : '') +
            '\n钱按 API 标准价折算，不是实际扣费；Google 没公布额度按模型和 token 种类怎么折算，这里按同比例推，只是参考。' +
            '\n这台电脑上 agy CLI 的花费已经算在里面；和家人共享额度、或者别的电脑也在用这个号时，别人用掉的算进了已用比例、却不在这台电脑的花费里，推出来的总量会偏小。' : '');
      } else tip += '\n已用 0%：这个号这一组还没开始用，周期从第一次用的时候开始算，重置时间跟着现在走。';
      // 这个周期是提前重置之后开始的：行末加 “↺ early reset 11-24”，悬停写明重置前用了多少、原定什么时候重置
      const er = wb.used > 0 && wb.reset > 0 ? resetBefore(grp, wb.reset) : null;
      if (er) {
        parts.push(RESET_MARK + ' early reset ' + (new Date(er.at).getMonth() + 1) + '-' + new Date(er.at).getDate());
        tip += '\n\n' + RESET_MARK + ' 这个周期是在一次提前重置之后开始的。' + resetText(er) + '。';
      }
      if (est) tip += '\n\n预估（est）：' + est.long + '\n' + SHARE_NOTE;
      // 以前的周期（2026-11-24 加）：每个周期这台电脑的花费 ÷ 结束前用掉的比例 = 那个周期的 cap，攒几个周期就能看出额度有没有变。
      // 用掉不到 1% 的周期不推 cap（误差太大）。最近 4 个
      const pcs = wb ? pastCycles(wb.id).slice(0, 4) : [];
      if (pcs.length) {
        const mdhmOf = (ms) => { const x = new Date(ms); return (x.getMonth() + 1) + '-' + x.getDate() + ' ' + pad(x.getHours()) + ':' + pad(x.getMinutes()); };
        tip += '\n\n以前的周期（cap = 这台电脑在那个周期里的花费 ÷ 结束前用掉的比例）：' + pcs.map((e) => {
          const c = cycleCost(grp, e.start, e.end);
          const capTx = e.used >= 0.01 && c.usd > 0 ? ' → cap ≈ ' + fmtUsd(c.usd / e.used) + (e.used < 0.05 ? '（用得少，很粗）' : '') : '';
          return '\n  ' + mdhmOf(e.start) + ' – ' + mdhmOf(e.end) + (e.early ? ' ' + RESET_MARK + ' 提前重置' : '') + '：用了 ' + pctTx(e.used) + '，花了 ' + fmtUsd(c.usd) + capTx +
            (c.exact ? '' : '（两头那两天正在按调用时间算）');
        }).join('') + '\n（从 2026-11-24 起每次换周期都会记一笔；更早的只有提前重置的那几次）';
      }
      if (S.account) tip += '\n\n账号 ' + S.account.m;
      const line = el('div', 'k-quota', parts.join(' · '));
      setTip(line, tip);
      foot.append(line);
    }
    panel.append(foot);
    attachCard(panel, tips);
  };
  // ---------- 调用明细页（2026-11-22 加，v1.6）：点每日用量表格里的某一天打开，仿 CC Switch 的请求日志 ----------
  // 数据全部来自本机后台（只读，不经过 Google，不耗额度）：
  //   哪些对话这一天动过：创建时间 ≤ 这天结束、最后修改 ≥ 这天开始。来源有两个：后台的对话摘要（S.casMeta，有标题），
  //     和注入程序给的本机对话库文件清单（S.convFiles，见 inject.mjs 的 convFiles）——摘要只列一部分对话，没列出的按 ID 照样取得到；
  //   每次调用：GetCascadeTrajectoryGeneratorMetadata 的 token 用量、模型、timeToFirstToken（首字）、streamingDuration（生成用时）；
  //   调用开始的时刻：元数据里没有（几个 ID 都是不带时间的随机 UUID，executionId 是一轮共用的），
  //     要按 stepIndices[0] 去 GetCascadeTrajectorySteps 里找那一步的 createdAt，所以每个对话还要取一次步骤（只留每步的开始时间）。
  // 结果按对话缓存在 S.detCache；对话又被改过（最后修改时间变了）就只补取新增的调用和步骤。
  // 已经删掉的对话没有了，所以以前某天的明细合计可能比当天合计少。
  S.detCache = S.detCache || new Map(); // 对话 ID → { v, modified, gens: [调用], times: Map(步骤序号 → 毫秒), user, ckpt（步骤序号的 Set）, stepNext, p }
  const durS = (d) => parseFloat(d) || 0; // "22.72s" → 22.72
  const slimCall = (m) => {
    const cm = (m && m.chatModel) || {}, u = cm.usage || {};
    const usage = {};
    for (const k of USAGE_KEYS) if (u[k] !== undefined) usage[k] = u[k];
    return { exec: m && m.executionId, step: Array.isArray(m && m.stepIndices) ? m.stepIndices[0] : -1, resp: cm.responseModel || '', key: u.model || cm.model || '',
      disp: String(cm.modelDisplayName || '').slice(0, 60), usage, ttft: durS(cm.timeToFirstToken), stream: durS(cm.streamingDuration),
      retries: Array.isArray(cm.retryInfos) ? cm.retryInfos.length : 0, cid: (cm.customMetadata && cm.customMetadata.cascade_id) || '' };
  };
  // 取（或补取）一个对话的调用和每步开始时间
  // v2（11-24）：多记你发消息（USER_INPUT）、压缩（CHECKPOINT）那一步的步骤序号，缓存没命中的原因要用；旧版本的缓存重取一次
  const loadConv0 = async (id) => {
    const meta = S.casMeta.get(id) || fileMeta(id) || {};
    let c = S.detCache.get(id);
    if (c && c.v !== 2) c = null;
    if (c && c.done && meta.modified > 0 && c.modified === meta.modified) return c; // 不知道最后修改时间的对话每次都补取（只补新增的）
    if (!c) { c = { v: 2, gens: [], times: new Map(), user: new Set(), ckpt: new Set(), stepNext: 0 }; S.detCache.set(id, c); }
    const off = Math.max(0, c.gens.length - 1); // 最后一条可能是当时还没结束的调用，重取覆盖
    const g = await lsCall('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: id, generatorMetadataOffset: off });
    const list = (g && Array.isArray(g.generatorMetadata)) ? g.generatorMetadata : null;
    if (!list) throw Error('no call metadata');
    list.forEach((m, i) => { c.gens[off + i] = slimCall(m); });
    // 步骤：从还没有时间的最早那次调用的步骤开始取到最后（第一次取时一般是整个对话）
    const need = c.gens.filter((x) => x && x.step >= 0 && !c.times.has(x.step)).map((x) => x.step);
    if (need.length) {
      const from = Math.max(0, Math.min(...need, c.stepNext));
      const r = await lsCall('GetCascadeTrajectorySteps', { cascadeId: id, stepOffset: from });
      if (!r || !Array.isArray(r.steps)) throw Error('no trajectory steps'); // 取失败：不记成“取完了”，算进“没取到”，下次再取（审查 A4）
      const st = r.steps;
      st.forEach((x, i) => {
        const md = (x && x.metadata) || {};
        if (md.createdAt) c.times.set(from + i, tms(md.createdAt));
        const ty = String((x && x.type) || '');
        if (ty.endsWith('_USER_INPUT')) c.user.add(from + i);
        else if (ty.endsWith('_CHECKPOINT')) c.ckpt.add(from + i);
      });
      c.stepNext = Math.max(from, from + st.length - 2);
    }
    c.modified = meta.modified;
    c.done = true;
    return c;
  };
  // 同一个对话正在取时（明细、cap、没命中统计可能同时要），等同一次，不重复向后台取（一个大对话的步骤有几十 MB）
  const loadConv = (id) => {
    const c0 = S.detCache.get(id);
    if (c0 && c0.p) return c0.p;
    const p = loadConv0(id); // 同步部分已经把缓存项放进 S.detCache
    const c = S.detCache.get(id);
    if (c) { c.p = p; p.then(() => { c.p = null; }, () => { c.p = null; }); }
    return p;
  };
  // 一天的明细：找对话 → 逐个取（一次一个，不同时压后台），边取边画进度
  const dayBounds = (nm) => { const a = new Date(nm + 'T00:00:00').getTime(); return [a, a + 86400e3]; };
  S.loadCalls = async (nm, onProgress) => {
    const [d0, d1] = dayBounds(nm);
    const ids = [...new Set([...S.casMeta.entries()].filter(([, m]) => m.created < d1 && m.modified >= d0).map(([id]) => id)
      .concat((S.convFiles || []).filter((f) => f[1] < d1 && f[2] >= d0).map((f) => f[0])))];
    const rows = [];
    let done = 0, failed = 0;
    for (const id of ids) {
      try {
        const c = await loadConv(id);
        // 缓存没命中按整个对话找（当天第一次调用要和前一天最后那次比），再挑出这一天的
        const list = [];
        for (const x of c.gens) {
          if (!x) continue;
          const at = c.times.get(x.step) || 0;
          if (at > 0) list.push({ x, at, ttft: x.ttft, stream: x.stream, step: x.step, cc: callCost(x.usage, callNames(x.resp, x.key, x.exec), at) });
        }
        list.sort((a, b) => a.at - b.at || a.step - b.step);
        const miss = missScan(list, { user: c.user, ckpt: c.ckpt });
        list.forEach((e, i) => { if (e.at >= d0 && e.at < d1) rows.push({ ...e.x, at: e.at, conv: id, miss: miss[i] }); });
      } catch (e) { failed++; }
      done++;
      if (onProgress) onProgress(done, ids.length);
    }
    rows.sort((a, b) => b.at - a.at);
    return { rows, convs: ids.length, failed };
  };
  // agy CLI 的调用（2026-11-24 加）：CLI 的对话不在桌面版后台里，取不到；打开某一天的明细时向注入程序要（S.cliAsk），
  // 注入程序读 CLI 对话库后调 S.setCliCalls 交回 { day, rows: [[时间, 对话 ID, 模型名, 输入, 缓存读, 缓存写, 输出, 首字秒, 生成秒, 界面名]], convs: { 对话 ID: 标题 } }。
  S.cliCalls = S.cliCalls || {};
  S.setCliCalls = (o) => {
    if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.day)) || !Array.isArray(o.rows)) return;
    S.cliCalls[o.day] = { rows: o.rows, convs: o.convs && typeof o.convs === 'object' ? o.convs : {} };
    if (S.cliRedraw) S.cliRedraw(o.day);
    if (S.panelView === 'usage' && document.querySelector(P)) refreshPanel(); // 每日用量页的 cap 也用到 CLI 的明细
  };
  S.cliAsk = (day) => {
    S.cliWant = day;
    try { if (typeof window.__agyZhAsk === 'function') window.__agyZhAsk(JSON.stringify({ t: 'cli-calls', day })); } catch (e) {}
  };
  const cliRows = (nm) => {
    const c = S.cliCalls[nm];
    if (!c) return [];
    return c.rows.filter((x) => Array.isArray(x) && x.length >= 9).map((x) => ({
      cli: true, at: +x[0] || 0, conv: String(x[1]), resp: String(x[2] || ''), key: '', exec: '', step: -1, disp: String(x[9] || ''), retries: 0,
      usage: { inputTokens: +x[3] || 0, cacheReadTokens: +x[4] || 0, cacheWriteTokens: +x[5] || 0, outputTokens: +x[6] || 0 }, ttft: +x[7] || 0, stream: +x[8] || 0,
      title: String((c.convs && c.convs[x[1]]) || ''),
    }));
  };
  const convLabel = (id) => {
    const sub = S.subInfo.get(id);
    const title = (S.casMeta.get(id) || {}).title || '';
    if (sub) return '↳ ' + (sub.typeName || 'subagent') + (sub.role ? ' · ' + sub.role : '');
    return title || id.slice(0, 8);
  };
  // 11-22 用户反馈：有对话在跑时，开着明细每 30 秒闪一次——原来每次刷新都清空面板、显示 loading、重新取完再画，
  // 在跑的对话每次都要重取，表格会消失一会儿，滚动位置也回到顶部。现在定时刷新时表格留着，后台重新取，
  // 取完和上次比，有变化才换表格内容；换的时候保持滚动位置（看着的那几行不动，新调用加在上面）。取失败就保留旧的。
  const renderCalls = (panel, refresh) => {
    const nm = S.callsDay || dayName();
    if (refresh && panel.dataset.calls === nm && S.callsReload) { S.callsReload(); return; }
    panel.replaceChildren();
    panel.dataset.calls = nm;
    const lb = dayLabel(nm);
    const head = el('div', 'p-head');
    const back = el('button', 'p-btn', '← usage');
    setTip(back, '回到每日用量');
    back.addEventListener('click', () => { S.panelView = 'usage'; renderPanel(panel); });
    head.append(back, setTip(el('span', 'p-title', 'Calls · ' + lb.wd + ' ' + lb.md), '这一天每次模型调用的明细，最新的在上面'));
    const sum = el('span', 'p-range', '');
    const x = el('button', 'p-btn p-x', '×');
    setTip(x, '关闭（Esc）');
    x.addEventListener('click', closePanel);
    head.append(sum, el('span', 'p-fill'), x);
    panel.append(head);
    // 第二行：视图和筛选（2026-11-24 加）。每次打开某一天都从“明细、全部”开始。
    //   view：calls 每次调用一行；convs 按对话汇总（每个对话一行，按花费从高到低，点一行回到明细并只看这个对话）。
    //   src：all / desk（桌面版）/ cli（agy CLI），那天有 CLI 的调用才显示；mdl：按价目名（Carbon、Neon…），那天有两种以上才显示；
    //   conv：只看某个对话（从按对话汇总里点进来），旁边有 × 取消。
    let view = 'calls', src = 'all', mdl = 'all', conv = null;
    let onlyMiss = !!S.callsMiss; // 从每日面板的 “cache miss today” 一行点进来时只看缓存没命中的调用
    S.callsMiss = false;
    let show = 600; // 明细表画多少行；“再显示”一次加 600
    const tools = el('div', 'p-tools');
    const segOf = (items, cur, onPick) => {
      const g = el('span', 'p-seg');
      for (const [k, t, tip, cls] of items) {
        const b = setTip(el('button', 'p-btn' + (k === cur ? ' on' : '') + (cls ? ' ' + cls : ''), t), tip);
        b.addEventListener('click', () => { if (k !== cur) onPick(k); });
        g.append(b);
      }
      return g;
    };
    const redraw = () => { sig = ''; wrap.scrollTop = 0; if (lastRes) draw(lastRes); };
    panel.append(tools);
    const status = el('div', 'p-empty', 'loading…');
    panel.append(status);
    const wrap = el('div', 'p-table calls');
    panel.append(wrap);
    // 超过 show 行：表格下面一个“再显示 600 条”和一个“全部显示”（原来最多 600 行，多的只算进合计）
    const more = el('div', 'p-more');
    more.hidden = true;
    panel.append(more);
    const note = el('div', 'p-note');
    panel.append(note);
    let sig = '';
    let lastRes = null;
    const labelOf = (r) => (r.cli ? 'CLI · ' + (r.title || r.conv.slice(0, 8)) : convLabel(r.conv));
    const draw = (res) => {
      lastRes = res;
      const all = res.rows.concat(cliMiss(cliRows(nm))).sort((a, b) => b.at - a.at); // 桌面版的 + agy CLI 的，最新的在上面
      const hasCli = all.some((r) => r.cli);
      if (!hasCli) src = 'all';
      // 每次调用的花费和价目名（模型筛选按价目名分：Carbon、Neon、Opus 5.5…，和每日面板的颜色一致）
      const costs = new Map();
      for (const r of all) {
        const cc = callCost(r.usage, r.cli ? r.resp : callNames(r.resp, r.key, r.exec), r.at) || { usd: null };
        costs.set(r, cc);
      }
      const pname = (r) => (costs.get(r).pr ? costs.get(r).pr.name : 'Other');
      const bySrc = src === 'cli' ? all.filter((r) => r.cli) : src === 'desk' ? all.filter((r) => !r.cli) : all;
      const models = new Map(); // 价目名 → [调用数, 美元]
      for (const r of bySrc) { const m = models.get(pname(r)) || [0, 0]; m[0]++; m[1] += costs.get(r).usd || 0; models.set(pname(r), m); }
      if (mdl !== 'all' && !models.has(mdl)) mdl = 'all';
      const byModel = mdl === 'all' ? bySrc : bySrc.filter((r) => pname(r) === mdl);
      if (conv && !byModel.some((r) => r.conv === conv)) conv = null;
      const rows0 = conv ? byModel.filter((r) => r.conv === conv) : byModel;
      const missAll = missSum(rows0);
      if (onlyMiss && !missAll.n) onlyMiss = false;
      const rows = onlyMiss ? rows0.filter((r) => r.miss) : rows0;
      // 指纹：视图、筛选、行数上限、CLI 标题、调用数、每次调用的时间和 token、耗时；没变化就不动表格
      // （CLI 对话的标题可能比调用晚到，标题变了也要重画）
      const cliTitlesSig = JSON.stringify((S.cliCalls[nm] && S.cliCalls[nm].convs) || {});
      const nsig = [view, src, mdl, conv, onlyMiss, show, cliTitlesSig, rows.length, res.failed].join('|') + '|' +
        rows.slice(0, show).map((r) => r.at + ':' + (+r.usage.outputTokens || 0) + ':' + (+r.usage.inputTokens || 0) + ':' + r.stream).join(',');
      if (nsig === sig) return;
      sig = nsig;
      // 第二行的按钮：每次重画时按当前数据重建（模型的种类会变）
      tools.replaceChildren(segOf([['calls', 'calls', '每次调用一行'], ['convs', 'by conversation', '按对话汇总：每个对话一行，按花费从高到低；点一行回到明细，只看这个对话']], view,
        (k) => { view = k; show = 600; redraw(); }));
      if (hasCli) tools.append(segOf([['all', 'all', '桌面版和 agy CLI 的调用'], ['desk', 'desktop', '只看桌面版的调用'], ['cli', 'CLI', '只看 agy CLI 的调用（别的工具直接调 CLI 也在这里）']], src,
        (k) => { src = k; show = 600; redraw(); }));
      if (models.size > 1 || mdl !== 'all') {
        const items = [['all', 'all models', '全部模型']];
        for (const [k, m] of [...models].sort((a, b) => b[1][1] - a[1][1])) items.push([k, k, k + '：' + m[0] + ' 次调用，' + fmtUsd(m[1]), 'k-' + (MODEL_COLOR[k] || 'muted')]);
        tools.append(segOf(items, mdl, (k) => { mdl = k; show = 600; redraw(); }));
      }
      if (missAll.n || onlyMiss) {
        tools.append(segOf([['all', 'all calls', '全部调用'], ['miss', 'cache misses', '只看缓存没命中的调用：' + missAll.n + ' 次，多花约 ' + fmtUsd(missAll.usd), 'k-miss']], onlyMiss ? 'miss' : 'all',
          (k) => { onlyMiss = k === 'miss'; show = 600; redraw(); }));
      }
      if (conv) {
        const r0 = byModel.find((r) => r.conv === conv);
        const chip = setTip(el('button', 'p-btn on p-chip', '× ' + clip(r0 ? labelOf(r0) : conv.slice(0, 8), 32)), '只看这个对话的调用，点一下取消');
        chip.addEventListener('click', () => { conv = null; redraw(); });
        tools.append(chip);
      }
      tools.hidden = !tools.children.length;
      let total = 0, priced = 0;
      for (const r of rows) { const u = costs.get(r).usd; if (u != null) { total += u; priced++; } }
      const filtered = src !== 'all' || mdl !== 'all' || conv || onlyMiss;
      const ms = missSum(rows);
      let total0 = 0; // 比例的分母：没按“只看没命中”筛选时的合计
      for (const r of rows0) total0 += costs.get(r).usd || 0;
      const missLine = ms.n ? '缓存没命中 ' + ms.n + ' 次，多花约 ' + fmtUsd(ms.usd) + (total0 > 0 ? '（占这些调用花费的 ' + Math.round(ms.usd / total0 * 100) + '%）' : '') + '：' + missTip(ms) + '\n\n' + MISS_FACT : '';
      const old = wrap.querySelector('table');
      const keep = old && view === 'calls' && wrap.dataset.view === 'calls' ? { top: wrap.scrollTop, h: wrap.scrollHeight } : null;
      const table = el('table');
      const hr = el('tr');
      const tbody = el('tbody');
      const MAX = show;
      more.replaceChildren();
      more.hidden = true;
      if (view === 'convs') {
        // 按对话汇总：对话、来源、调用数、花费、占比、输入、输出、缓存、命中、时间段、用到的模型
        const agg = new Map();
        for (const r of rows) {
          const a = agg.get(r.conv) || { r0: r, n: 0, usd: 0, miss: 0, nMiss: 0, inp: 0, out: 0, cr: 0, first: r.at, last: r.at, models: new Map() };
          const cc = costs.get(r);
          if (r.miss) { a.miss += r.miss.usd; a.nMiss++; }
          a.n++; a.usd += cc.usd || 0; a.inp += cc.inp || 0; a.out += cc.out || 0; a.cr += cc.cr || 0;
          a.first = Math.min(a.first, r.at); a.last = Math.max(a.last, r.at);
          a.models.set(pname(r), (a.models.get(pname(r)) || 0) + (cc.usd || 0));
          agg.set(r.conv, a);
        }
        const heads = [['Conversation', '对话（↳ 是子代理，CLI · 开头的是 agy CLI 的对话）'], ['Calls', '这一天在这个对话里的调用次数'], ['Cost', '按 API 标准价折算（不是实际扣费）'],
          ['Miss', '缓存没命中多花的钱（算在 Cost 里）'], ['Share', '占这一天（当前筛选下）合计的比例'],
          ['In', '新增输入（不含缓存）'], ['Out', '输出（含思考）'], ['Cache', '缓存读取'], ['Hit', '命中率 = 缓存读 ÷（缓存读 + 输入）'], ['Time', '这一天里第一次和最后一次调用的时间'], ['Models', '用到的模型，按花费从高到低']];
        for (const [h, t] of heads) { const th = el('th', '', h); setTip(th, t); hr.append(th); }
        const hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
        for (const [id, a] of [...agg].sort((p, q) => q[1].usd - p[1].usd)) {
          const tr = el('tr', 'clk');
          const label = labelOf(a.r0);
          const tdConv = el('td', 'cv', clip(label, 48));
          setTip(tdConv, label + '\n' + (a.r0.cli ? 'agy CLI 的对话 ' : '对话 ') + id.slice(0, 8) + '\n点一下看这个对话的每次调用');
          const ms = [...a.models].sort((p, q) => q[1] - p[1]).map(([k]) => k).join(', ');
          const tdMiss = el('td', a.nMiss ? 'h miss' : '', a.nMiss ? fmtUsdFine(a.miss) : '—');
          if (a.nMiss) setTip(tdMiss, '缓存没命中 ' + a.nMiss + ' 次，多花约 ' + fmtUsd(a.miss) + '（点这一行看每次调用，命中率标黄的是没命中的）');
          tr.append(tdConv, el('td', '', String(a.n)), el('td', 'c', fmtUsdFine(a.usd)), tdMiss, el('td', '', total > 0 ? (a.usd / total < 0.005 ? '<1%' : Math.round(a.usd / total * 100) + '%') : '—'),
            el('td', '', fmtK(a.inp)), el('td', '', fmtK(a.out)), el('td', '', fmtK(a.cr)), el('td', 'h', a.cr + a.inp > 0 ? Math.round(a.cr / (a.cr + a.inp) * 100) + '%' : '—'),
            el('td', '', hm(a.first) + (a.last - a.first > 60000 ? '–' + hm(a.last) : '')), el('td', 'md', clip(ms, 28)));
          tr.addEventListener('click', () => { conv = id; view = 'calls'; show = 600; redraw(); });
          tbody.append(tr);
        }
        sum.textContent = agg.size + ' conversations · ' + rows.length + ' calls · ' + fmtUsd(total) + (filtered ? ' (filtered)' : '') + (ms.usd >= 0.01 ? ' · miss +' + fmtUsd(ms.usd) : '');
        setTip(sum, missLine);
      } else {
        const heads = [['Time', '调用开始的时间'], ['Conversation', '哪个对话（↳ 是子代理，CLI · 开头的是 agy CLI 的对话）'], ['Model', '模型（界面名；悬停看接口名和配置名）'], ['Cost', '按 API 标准价折算（不是实际扣费）'],
          ['In', '新增输入（不含缓存）'], ['Out', '输出（含思考）'], ['Cache', '缓存读取'], ['Write', '缓存写入（只有 Claude 有）'], ['Hit', '命中率 = 缓存读 ÷（缓存读 + 输入）'],
          ['tok/s', '生成速度：输出 token（含思考）÷ 总耗时。思考在首字之前就生成了，所以按总耗时算'], ['TTFT', '首字时间（后台记录的 timeToFirstToken）'], ['Total', '首字 + 生成用时']];
        for (const [h, t] of heads) { const th = el('th', '', h); setTip(th, t); hr.append(th); }
        for (const r of rows.slice(0, MAX)) {
          const u = r.usage, inp = +u.inputTokens || 0, cr = +u.cacheReadTokens || 0, cw = +u.cacheWriteTokens || 0;
          const out = Math.max(+u.outputTokens || 0, (+u.thinkingOutputTokens || 0) + (+u.responseOutputTokens || 0));
          const cc = costs.get(r);
          const t = new Date(r.at);
          const tr = el('tr');
          // 老的 CLI 调用记录里没有界面名，只有 gemini-4-argon 这样的原始名：用价目名（Argon）
          const model = r.disp || (r.key && S.enumModel.get(r.key)) || (r.cli && cc.pr ? cc.pr.name : '') || r.resp || r.key.replace(/^MODEL_/, '');
          const label = labelOf(r);
          const tdConv = el('td', 'cv', clip(label, 48)); // 实际宽度由 CSS 限制（放不下出省略号）
          setTip(tdConv, label + '\n' + (r.cli ? 'agy CLI 的对话 ' + r.conv.slice(0, 8) + '（别的工具直接调 CLI 也在这里）' : '对话 ' + r.conv.slice(0, 8) + ' · 第 ' + (r.step + 1) + ' 步'));
          // 表里写短名（去掉 Gemini 4 / Claude 前缀），完整的界面名、接口名、配置名在悬停说明里
          const tdModel = el('td', 'md', clip(model.replace(/^Gemini \d+(\.\d+)?\s+/, '').replace(/^Claude\s+/, ''), 20));
          const price = cc.pr ? '\n单价按 ' + cc.pr.name + (cc.pr.note ? '（' + cc.pr.note + '）' : '') : '\n价格表里没有这个模型，没算钱';
          setTip(tdModel, r.cli ? '界面名：' + (r.disp || '?') + '\n模型：' + (r.resp || '?') + price + '\n（agy CLI 的调用，从 CLI 的对话库读的）'
            : '界面名：' + (r.disp || '?') + '\n接口返回的模型：' + (r.resp || '?') + '\n配置名：' + ((r.key && S.enumModel.get(r.key)) || '?') + '\n编号：' + (r.key || '?') +
            price + (r.retries ? '\n重试过 ' + r.retries + ' 次' : ''));
          const tdCost = el('td', 'c', cc.usd != null ? fmtUsdFine(cc.usd) : '—');
          const costly = costlyNote(cc, r.miss);
          if (costly) { tdCost.classList.add('costly'); setTip(tdCost, costly); } else if (r.miss) setTip(tdCost, missNote(r.miss));
          const hit = cr + inp > 0 ? Math.round(cr / (cr + inp) * 100) + '%' : '—';
          const tdHit = el('td', r.miss ? 'h miss' : 'h', hit); // 缓存没命中的调用：命中率标黄，悬停看原因
          if (r.miss) setTip(tdHit, missNote(r.miss));
          const totalS = r.ttft + r.stream;
          const tps = totalS > 0.05 && out > 0 ? String(Math.round(out / totalS)) : '—'; // 单位 tok/s 写在表头
          tr.append(el('td', '', pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds())), tdConv, tdModel, tdCost,
            el('td', '', inp.toLocaleString()), el('td', '', out.toLocaleString()), el('td', '', fmtK(cr)), el('td', '', cw ? fmtK(cw) : '—'), tdHit,
            el('td', '', tps), el('td', '', r.ttft ? r.ttft.toFixed(1) + 's' : '—'), el('td', '', r.ttft || r.stream ? (r.ttft + r.stream).toFixed(1) + 's' : '—'));
          tbody.append(tr);
        }
        const nCostly = rows.filter((r) => costlyNote(costs.get(r))).length;
        sum.textContent = rows.length + ' calls · ' + fmtUsd(total) + (filtered ? ' (of ' + all.length + ')' : '') +
          (nCostly ? ' · ' + nCostly + ' ≥ $' + COSTLY_USD.toFixed(2) : '') + (ms.usd >= 0.01 ? ' · miss +' + fmtUsd(ms.usd) : '');
        setTip(sum, (nCostly ? nCostly + ' 次调用单次 ≥ $' + COSTLY_USD.toFixed(2) + '（花费标红，悬停看原因）' : '') +
          (missLine ? (nCostly ? '\n\n' : '') + missLine + '\n命中率一格标黄的是没命中的调用，悬停看原因；“cache misses” 只看这些。' : ''));
        more.hidden = rows.length <= MAX;
        if (rows.length > MAX) {
          const left = rows.length - MAX;
          const b1 = el('button', 'p-btn', 'show ' + Math.min(600, left) + ' more');
          b1.addEventListener('click', () => { show += 600; sig = ''; draw(lastRes); });
          more.append(el('span', 'dim', MAX + ' of ' + rows.length + ' shown'), b1);
          if (left > 600) {
            const b2 = el('button', 'p-btn', 'show all');
            b2.addEventListener('click', () => { show = rows.length; sig = ''; draw(lastRes); });
            more.append(b2);
          }
        }
      }
      const thead = el('thead'); thead.append(hr);
      table.append(thead, tbody);
      wrap.replaceChildren(table);
      wrap.dataset.view = view;
      // 往下翻过时保持看着的那几行不动（新调用加在最上面，表格变高多少就往下挪多少）；在顶部就留在顶部看最新的
      if (keep && keep.top > 0) wrap.scrollTop = keep.top + (wrap.scrollHeight - keep.h);
      status.textContent = rows.length ? '' : 'no calls found for this day';
      status.hidden = !!rows.length;
      // 和当天合计比：只在没按模型 / 对话筛选时比；按来源筛选时只和那一部分比（桌面版 / CLI）
      const dr = dayRecord(nm) || {};
      const dayUsd = mdl !== 'all' || conv ? 0 : (src === 'cli' ? (dr.cli ? dr.cli.usd : 0) : src === 'desk' && dr.cli ? dr.deskUsd : dr.usd) || 0;
      note.textContent = (view === 'calls' && rows.length > MAX ? '表格里是最新的 ' + MAX + ' 次，合计按全部 ' + rows.length + ' 次算。' : '') +
        (res.failed ? res.failed + ' 个对话没取到。' : '') +
        (dayUsd > 0 && total < dayUsd * 0.95 ? '明细合计 ' + fmtUsd(total) + '，当天合计 ' + fmtUsd(dayUsd) + '：差的部分可能是已经删掉的对话，或者 Antigravity 关着时补算进当天的用量。' : '') +
        (priced < rows.length ? (rows.length - priced) + ' 次调用的模型不在价格表里，没算钱。' : '');
    };
    const key = nm;
    S.callsKey = key;
    let busy = false;
    // CLI 的调用到了（或更新了）：用上次桌面版的结果重画一次（指纹没变就不动表格）
    S.cliRedraw = (day) => { if (day === nm && lastRes && S.callsKey === key && panel.isConnected && S.panelView === 'calls') draw(lastRes); };
    const load = (first) => {
      S.cliAsk(nm);
      if (busy) return;
      busy = true;
      S.loadCalls(nm, first ? (d, n) => { if (S.callsKey === key && n > 1) status.textContent = 'loading ' + d + '/' + n + ' conversations…'; } : null)
        .then((res) => { if (S.callsKey === key && panel.isConnected && S.panelView === 'calls') draw(res); })
        .catch((e) => { if (first) status.textContent = 'failed: ' + e.message; })
        .then(() => { busy = false; });
    };
    S.callsReload = () => load(false);
    load(true);
  };
  // Theme 页（2026-11-22 加）：上面是配色画廊，每张卡片是当前状态栏的实时副本（套上那套配色和当前外形），点一下就换；
  // 下面是外形、进度条、信息密度、图标。选了马上生效，注入程序 30 秒内存进 look.json 并推给其他窗口。
  const OPT_INFO = {
    skin: ['style', '外形', { plain: '纯文字，竖线分隔（默认）', pill: '每项一个圆角底色块', powerline: '箭头色块，像终端里的 powerline' }],
    bar: ['bars', '额度进度条', { thin: '细条（默认，约是 10 格的一半宽）', cells: '10 格（以前的样子）', ring: '小圆环，最省地方', none: '不画，只留百分比' }],
    dense: ['detail', '信息密度', { compact: '上下文只写比例和用量、缓存只写命中率，其余在悬停说明里（默认）', full: '上下文带上限、缓存带读到的 token 数（以前的样子）' }],
  };
  // Theme 页上在线更新的情况：版本、上次检查、在线词典条数、价格表日期、出的问题
  const updStatus = (r) => {
    const st = (r && r.st) || {};
    const parts = ['agy-zh-pack v' + ((r && r.version) || '?')];
    if (r && r.on === false) return parts[0] + ' · 在线更新已关闭，词典和价格用安装包自带的';
    if (st.okAt) parts.push('上次检查 ' + fmtWhen(st.okAt) + (st.host ? '（' + st.host + '）' : ''));
    else parts.push(st.at ? '还没检查成功过' : '注入程序启动约 1 分钟后第一次检查');
    if (st.dictN) parts.push('在线词典 ' + st.dictN + ' 条、规则 ' + st.rulesN + ' 条');
    parts.push(priceSrc.online ? '价格表 ' + priceSrc.updated : '价格表用内置的');
    if (r && r.meta && r.version && verGt(r.meta.latest, r.version)) parts.push('有新版本 v' + r.meta.latest);
    if (st.err) parts.push('问题：' + st.err);
    return parts.join(' · ');
  };
  const renderLook = (panel) => {
    panel.replaceChildren();
    const head = el('div', 'p-head');
    head.append(setTip(el('span', 'p-title', 'Theme'), '状态栏外观。选好马上生效，保存在注入程序目录的 look.json，所有窗口共用'));
    const back = el('button', 'p-btn', '← usage');
    setTip(back, '回到每日用量');
    back.addEventListener('click', () => { S.panelView = 'usage'; renderPanel(panel); });
    const reset = el('button', 'p-btn', 'reset');
    setTip(reset, '全部恢复默认：Cometix / plain / thin / compact / 实心图标 / 在线更新开');
    reset.addEventListener('click', () => S.setLook({ ...LOOK_DEFAULT }));
    const x = el('button', 'p-btn p-x', '×');
    setTip(x, '关闭（Esc）');
    x.addEventListener('click', closePanel);
    head.append(back, el('span', 'p-fill'), reset, x);
    panel.append(head);

    panel.append(el('div', 'lk-sec', 'Palette'));
    const src = S.panelBar && S.panelBar.isConnected ? S.panelBar : document.querySelector(B);
    const grid = el('div', 'lk-grid');
    for (const pal of LOOK_CHOICES.pal) {
      const on = S.look.pal === pal;
      const card = el('button', 'lk-card' + (on ? ' on' : ''));
      setTip(card, PAL_INFO[pal][1]);
      const name = el('div', 'lk-name');
      name.append(el('span', '', PAL_INFO[pal][0]));
      if (pal === LOOK_DEFAULT.pal) name.append(el('span', 'lk-tag', 'default'));
      if (on) name.append(el('span', 'lk-tag cur', 'in use'));
      const prev = lookAttrs(el('div', BAR_CLASS + ' lk-prev'), { pal });
      if (src && src.children.length) {
        for (const ln of src.children) {
          const c = ln.cloneNode(true);
          c.querySelectorAll('[data-agy-tip]').forEach((e) => e.removeAttribute('data-agy-tip'));
          prev.append(c);
        }
      } else prev.append(el('div', 'lk-empty', 'open a conversation to see a live preview'));
      card.append(name, prev);
      card.addEventListener('click', () => S.setLook({ pal }));
      grid.append(card);
    }
    panel.append(grid);

    const row = (lab, tip, buttons) => {
      const r = el('div', 'lk-row');
      r.append(setTip(el('span', 'lk-lab', lab), tip), ...buttons);
      return r;
    };
    for (const [key, [lab, zh, names]] of Object.entries(OPT_INFO)) {
      panel.append(row(lab, zh, LOOK_CHOICES[key].map((v) => {
        const b = el('button', 'p-btn' + (S.look[key] === v ? ' on' : ''), v);
        setTip(b, names[v]);
        b.addEventListener('click', () => S.setLook({ [key]: v }));
        return b;
      })));
    }
    const ICON_SET_TIP = { material: '实心图标（默认）', outline: '线条图标（同一套字体的空心版）', unicode: '普通字符，不用联网加载图标字体', off: '不显示图标，更窄' };
    panel.append(row('icons', '图标整套', LOOK_CHOICES.icons.map((v) => {
      const b = el('button', 'p-btn' + (S.look.icons === v ? ' on' : ''), v);
      setTip(b, ICON_SET_TIP[v]);
      b.addEventListener('click', () => S.setLook({ icons: v }));
      return b;
    })));
    // 单项图标（11-22 改）：一排 9 个按钮，每个显示这一项现在用的图标，点一下在“默认 / 备选”之间换。
    // 原来是 9 行、每行 4 个候选，用户嫌太多。整套是 unicode 或 off 时单项不生效，这一排变淡。
    const pick = el('div', 'lk-row lk-icons' + (S.look.icons === 'unicode' || S.look.icons === 'off' ? ' dim' : ''));
    pick.append(setTip(el('span', 'lk-lab', 'swap'), '点一个图标，在默认和备选之间换'));
    for (const [key, [lab, zh, names]] of Object.entries(ICON_ITEMS)) {
      const cur = (S.look.iconMap && S.look.iconMap[key]) || names[0];
      const other = names.find((n) => n !== cur) || names[0];
      const b = el('button', 'p-btn lk-ib' + (cur !== names[0] ? ' on' : ''));
      const ic = ICON(key, { icons: 'material', iconMap: { [key]: cur } });
      b.append(typeof ic === 'string' ? el('span', 'ic' + (S.look.icons === 'outline' ? ' ol' : ''), ic) : ic);
      setTip(b, lab + '（' + zh + '）：现在是' + (ICON_NAME_ZH[cur] || cur) + (cur === names[0] ? '（默认）' : '') +
        '\n点一下换成' + (ICON_NAME_ZH[other] || other) + (other === names[0] ? '（默认）' : ''));
      b.addEventListener('click', () => S.setLook({ iconMap: { ...S.look.iconMap, [key]: other } }));
      pick.append(b);
    }
    panel.append(pick);
    // 在线更新（v1.7）：auto = 每 6 小时从仓库取词典、规则、价格和最新版本号；off = 不联网，只用安装包自带的
    const UPD_TIP = {
      auto: '每 6 小时从 GitHub（经 jsDelivr）取最新的词典、规则和价格表（默认）。只取数据，不取代码；新版本只在每日面板上提示',
      off: '不联网，词典和价格只用安装包自带的（Google 调价或 Antigravity 加了新文字，要等装新版本才有）',
    };
    panel.append(row('updates', '在线更新词典和价格', LOOK_CHOICES.online.map((v) => {
      const b = el('button', 'p-btn' + (S.look.online === v ? ' on' : ''), v);
      setTip(b, UPD_TIP[v]);
      b.addEventListener('click', () => S.setLook({ online: v }));
      return b;
    })));
    panel.append(el('div', 'lk-note', updStatus(S.remote)));
    panel.append(el('div', 'lk-note', '配色跟着 Antigravity 的浅色 / 深色自动切换。选择保存在 look.json，所有窗口共用；点右上角 reset 恢复默认。'));
  };

  // 背景色取输入框一带不透明的颜色，和当前主题一致；取不到用 CSS 里的默认色
  const solidBg = (start) => {
    for (let e = start; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (opaque(c)) return c;
    }
    return '';
  };
  // 只认完全不透明的颜色（11-22 改）：原来只排除了完全透明，鼠标停在表格行上时拿到了行高亮的半透明色
  // （color-mix(… 22%, transparent)，计算值是 color(srgb … / 0.22)），提示框变成半透明、看不清。
  const opaque = (c) => {
    if (!c || c === 'transparent') return false;
    const m = /^rgba?\(([^)]*)\)$/.exec(c);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length < 4 || parseFloat(p[3]) >= 0.999; }
    const a = /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
    if (a) return parseFloat(a[1]) / (a[2] ? 100 : 1) >= 0.999;
    return true;
  };
  const placePanel = (panel) => {
    const bar = S.panelBar && S.panelBar.isConnected ? S.panelBar : document.querySelector(B);
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    // 11-22 改：宽度跟下面的输入框一样（原来最宽 780px，明细表太挤）；左边和输入框对齐。
    // 能用的高度（状态栏上方到窗口顶）记在 --p-avail，调用明细页的表格按它撑满。
    const box = bar.nextElementSibling && bar.nextElementSibling.getBoundingClientRect();
    const left = box && box.width > 0 ? box.left : r.left;
    const w = Math.min(Math.max(box && box.width > 0 ? box.width : r.width, r.width, 560), window.innerWidth - 24);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(12, Math.min(left, window.innerWidth - w - 12)) + 'px';
    panel.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
    const avail = Math.max(180, r.top - 24);
    panel.style.maxHeight = avail + 'px';
    panel.style.setProperty('--p-avail', avail + 'px');
    const bg = solidBg(bar.nextElementSibling) || solidBg(bar);
    if (bg) { panel.style.background = bg; panel.style.setProperty('--p-bg-live', bg); } // 固定表头、悬停卡片、日均标签也用这个底色
  };
  const closePanel = () => {
    document.querySelectorAll(P).forEach((p) => p.remove());
    if (S.panelOutside) document.removeEventListener('mousedown', S.panelOutside, true);
    if (S.panelKey) document.removeEventListener('keydown', S.panelKey, true);
    S.panelOutside = S.panelKey = null;
  };
  const togglePanel = (anchor, view) => {
    if (document.querySelector(P)) { closePanel(); return; }
    const p = el('div', PANEL_CLASS);
    S.panelView = view || 'usage'; // 每次打开都从每日用量开始（压缩查看器直接打开 ckpt）
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
  // ---------- 压缩查看器（2026-11-24 加）：点上下文后面的压缩徽章 ↻ 打开 ----------
  // 后台压缩上下文时，旧的步骤换成一条接续消息（Resuming from a compaction）：被截掉部分里用户的全部请求（原文）、
  // 检查点摘要（任务概述、进度、关键发现、错误和修复、当前上下文、下一步、承诺和约束）、artifacts 清单、对话日志的位置。
  // 工具输出（读过的文件内容、命令结果）和推理过程不在了。这里显示最近一次的接续消息里的摘要，
  // 由注入程序从 brain/<对话>/.system_generated/logs/transcript_full.jsonl 读出来（只读，只在本机）。
  S.setCheckpoint = (o) => {
    S.ckpt = o;
    const p = document.querySelector(P);
    if (p && S.panelView === 'ckpt') renderPanel(p);
  };
  const openCheckpoint = (id, anchor) => {
    S.ckptConv = id;
    if (!S.ckpt || S.ckpt.conv !== id) S.ckpt = null;
    try { if (typeof window.__agyZhAsk === 'function') window.__agyZhAsk(JSON.stringify({ t: 'checkpoint', conv: id })); } catch (e) {}
    const p = document.querySelector(P);
    if (!p) { togglePanel(anchor, 'ckpt'); return; }
    S.panelView = 'ckpt';
    renderPanel(p);
  };
  // 摘要是 Markdown：先转义，再把标题行、**粗体**、`代码` 换成标签
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mdLite = (s) => escHtml(s).split('\n').map((l) => {
    const h = /^\s{0,3}#{1,4}\s+(.*)$/.exec(l);
    const x = (h ? h[1] : l).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    return h ? '<b class="h">' + x + '</b>' : x;
  }).join('\n');
  const renderCkpt = (panel) => {
    panel.replaceChildren();
    const head = el('div', 'p-head');
    head.append(setTip(el('span', 'p-title', 'Context compaction'), '后台压缩上下文以后，智能体手里还剩什么'), el('span', 'p-fill'));
    const x = el('button', 'p-btn p-x', '×');
    setTip(x, '关闭（Esc）');
    x.addEventListener('click', closePanel);
    head.append(x);
    panel.append(head);
    const o = S.ckpt;
    if (!o || o.conv !== S.ckptConv) { panel.append(el('div', 'p-empty dim', typeof window.__agyZhAsk === 'function' ? 'loading…' : '注入程序没有连上，读不了日志')); return; }
    if (o.err) { panel.append(el('div', 'p-empty', o.err)); return; }
    const d = new Date(o.at);
    panel.append(el('div', 'p-range', 'compacted ' + o.n + '× · latest at step ' + o.step + ' · ' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) +
      ' · summary ' + o.summary.length.toLocaleString() + ' chars'));
    panel.append(el('div', 'p-note', '压缩以后，智能体手里只剩：被截掉部分里你的 ' + o.requests + ' 条请求（原文）、下面这份摘要、' + o.artifacts +
      ' 个 artifact 的路径、对话日志的位置。之前读过的文件内容、命令输出和推理过程都不在了，要用时得重新读文件或去日志里查。'));
    const box = el('div', 'p-ckpt');
    box.innerHTML = o.summary ? mdLite(o.summary) : '<span class="dim">（这次压缩的接续消息里没有摘要）</span>';
    panel.append(box);
    const foot = el('div', 'p-note', '完整记录：');
    foot.append(el('code', 'p-path', o.log));
    panel.append(foot);
  };
  const refreshPanel = () => {
    const p = document.querySelector(P);
    if (!p) return;
    placePanel(p);
    const top = p.scrollTop;
    try { renderPanel(p, true); } catch (e) { p.textContent = 'usage panel error: ' + e.message; }
    if (top && S.panelView !== 'calls') p.scrollTop = top; // 定时刷新后保持原来的滚动位置
    tipAfterRender();
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
  const agentSeg = (id, info) => seg('agent', ICON('agent'),
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
    return seg('muted', ICON('check'), ['done ' + pad(d.getHours()) + ':' + pad(d.getMinutes())], '这个子代理最近一次模型调用结束的时间');
  };
  // ---------- 活动行和子代理行（2026-11-22 加，v1.6）：agy 正在做什么 ----------
  // 数据来自上面的 S.act（noteAct 从状态流里记的步骤）。只在页面里显示，不改任何请求。
  const fmtDur = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm' + pad(s % 60) + 's';
    return Math.floor(s / 3600) + 'h' + pad(Math.floor((s % 3600) / 60)) + 'm';
  };
  const LIVE = /GENERATING|PENDING|RUNNING|WAIT/;
  // 当前步骤：还没完成的步骤里序号最大的；都完成了就取最后一步
  const actView = (id) => {
    const a = S.act.get(id);
    if (!a || !a.steps.size) return null;
    const ks = [...a.steps.keys()].sort((x, y) => x - y);
    const live = ks.filter((k) => LIVE.test(a.steps.get(k).status));
    const curK = live.length ? live[live.length - 1] : ks[ks.length - 1];
    const firstAt = Math.min(...ks.map((k) => a.steps.get(k).t0 || Infinity));
    return { a, ks, curK, cur: a.steps.get(curK), firstAt: Number.isFinite(firstAt) ? firstAt : 0 };
  };
  const stepName = (s) => (s.type === 'PLANNER_RESPONSE' ? 'model' : s.tool || s.type.toLowerCase());
  const curText = (v) => {
    const s = v.cur;
    if (s.type === 'USER_INPUT') return 'starting'; // 刚发出消息，模型还没开始回复
    if (s.type === 'PLANNER_RESPONSE') {
      if (s.status === 'GENERATING') return s.writing ? 'writing' : 'thinking';
      return 'planning'; // 模型这次回复已经完成，下一步还没开始
    }
    return stepName(s) + (s.text ? ': ' + s.text : '');
  };
  const timeline = (v) => v.ks.slice(-8).map((k) => {
    const s = v.a.steps.get(k);
    const d = s.t0 ? fmtDur((s.t1 || Date.now()) - s.t0) + (s.t1 ? '' : '…') : '';
    const t = s.t0 ? new Date(s.t0) : null;
    return (t ? pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()) : '--:--:--') + '  第 ' + (k + 1) + ' 步 ' + stepName(s) +
      (s.text ? ' — ' + s.text : '') + (d ? '（' + d + '）' : '') + (s.err ? '  ✗ 出错' : '');
  }).join('\n');
  // 11-22 试过把“正在做什么”（thinking / writing / run_command …）放进主栏 running 那一项和子代理行末尾，用户反馈这些
  // 界面上本来就看得到、没有用，行里也放不下，撤掉了。现在只在子代理那一项的悬停说明里写正在做哪一步、最近几步。

  // ---------- 子代理的数据（11-22 加）----------
  // 子代理的状态流只有打开它的窗格时才有，主窗格里看不到它的上下文、缓存和步骤。所以子代理在跑时每 3 秒向本机后台
  // 取一次它最近的步骤（GetCascadeTrajectorySteps，只读，不经过 Google，不耗额度），交给 takeSteps：
  // 步骤里有每次模型调用的 token（上下文、缓存命中率用）和工具参数（活动用）。跑完后再取最后一次。
  // 第一次从倒数约 8 步开始取（步骤序号来自调用元数据 S.costs；还没查到就等下一轮），以后从上次取到的地方往后取。
  S.subSteps = S.subSteps || new Map(); // 子代理 ID → { next 下次从第几步取, busy, at 上次取的时间, final 跑完后取过了 }
  S.fetchSubSteps = (id) => {
    const c = S.subSteps.get(id) || { next: -1, busy: false, at: 0, final: false };
    S.subSteps.set(id, c);
    if (c.busy) return;
    // 跑完后的最后一次没取成：撤掉 final，让 pollSubs 1.5 秒后再取。请求失败最多算 3 次；
    // 调用元数据还没到不算失败次数，只是等，从第一次取算起最多等 60 秒
    const retryFinal = (failed) => {
      c.at = Date.now();
      if (!c.final) return;
      c.finalSince = c.finalSince || c.at;
      if (failed) c.fails = (c.fails || 0) + 1;
      if ((c.fails || 0) < 3 && c.at - c.finalSince < 60000) c.final = false;
    };
    if (c.next < 0) {
      const cl = S.costs.get(id);
      if (!cl || !cl.at) { if (!cl) S.fetchCost(id); retryFinal(false); return; }
      const lastStep = cl.list.reduce((m, x) => (x && x.step >= 0 && x.step > m ? x.step : m), 0);
      c.next = Math.max(0, lastStep - 8);
    }
    c.busy = true;
    c.at = Date.now();
    const from = c.next;
    lsCall('GetCascadeTrajectorySteps', { cascadeId: id, stepOffset: from })
      .then((j) => {
        if (!j) retryFinal(true);
        const steps = (j && Array.isArray(j.steps)) ? j.steps : [];
        if (steps.length) {
          takeSteps({ stepsUpdate: { steps, indices: steps.map((_, i) => from + i), totalLength: from + steps.length } }, id);
          c.next = Math.max(from, from + steps.length - 2); // 最后两步可能还在变，下次重取
          S.render(); // 没取到新步骤就不重画
        }
      })
      .then(() => { c.busy = false; }, () => { c.busy = false; });
  };
  // 定时器每秒调一次：当前显示的对话树里，在跑的子代理隔 3 秒取一次，刚跑完的再取最后一次
  S.pollSubs = () => {
    const now = Date.now();
    const roots = new Set();
    for (const box of document.querySelectorAll('[data-testid="agent-input-box"]')) {
      const pid = paneConvId(box);
      roots.add(pid ? rootOf(pid) : currentRoot());
    }
    for (const id of S.subInfo.keys()) {
      const root = rootOf(id);
      if (!roots.has(root)) continue;
      const c = S.subSteps.get(id);
      if (subRunning(id, root)) {
        if (c && c.final) { c.final = false; c.fails = 0; c.finalSince = 0; } // 同一个子代理又开始跑了：跑完后要重新补取最后几步
        if (!c || now - c.at > 3000) S.fetchSubSteps(id);
      }
      else if (c && !c.final && !c.busy && now - c.at > 1500) { c.final = true; S.fetchSubSteps(id); }
    }
  };
  // 子代理的上下文：它的状态流不在时没有 contextWindowUsage，按最近一次调用发给模型的 token 估算；
  // 上限取同一个模型在别的对话里见过的上限（S.ctxMax，build 里记），没见过就只写 token 数。
  S.ctxMax = S.ctxMax || new Map(); // 模型编号 → 上下文上限
  const noteCtxMax = (md, ctx) => { const k = modelKey(md); if (k && ctx && Number(ctx.maxContextTokens) > 0) S.ctxMax.set(k, Number(ctx.maxContextTokens)); };
  const estCtx = (md) => {
    const mu = md && md.modelUsage;
    const max = S.ctxMax.get(modelKey(md));
    if (!mu || !max) return null;
    return { estimatedTokensUsed: promptTokens(mu), maxContextTokens: max, est: true };
  };

  // 子代理行（v1.6 重做）：树形，每个子代理一行——
  //   “├ ⑂ research · Paper Reviewer | ☄ Gemini 4 Neon · XHigh | ◔ 45% · 120k | ≋ 97% hit | $0.40 | ● read_file: x · step 12 · 1m05s”
  //   跑完：“└ … | ✓ done 1m40s · 9 steps”。接口返回的模型名只在和界面名对不上时显示；模型列表里没有、
  //   又没查到接口名的模型（如 PLACEHOLDER_M530）不显示模型。首字、速度在名字的悬停说明里。
  const plainText = (e) => { const c = e.cloneNode(true); c.querySelectorAll('.ic').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  const subRow = (id, info, root, last) => {
    const ag = S.agents.get(id) || {};
    const smd = ag.last;
    const smu = smd && smd.modelUsage;
    const sconv = S.convs.get(id) || {};
    if (sconv.ctx) noteCtxMax(smd, sconv.ctx);
    let ms = modelSeg(smd, info.model, info.modelTier);
    if (ms && /PLACEHOLDER|MODEL_/.test(plainText(ms))) ms = null;
    if (ms && ms.querySelectorAll('.tx').length > 1) ms.querySelectorAll('.tx.real:not(.odd)').forEach((x) => { const d = x.previousElementSibling; if (d && d.classList.contains('dot')) d.remove(); x.remove(); });
    const calls = callSegs(smd).map(plainText);
    const name = seg('agent', ICON('agent'), [info.typeName || 'subagent', info.role && info.role !== info.typeName ? clip(info.role, 32) : ''],
      '子代理' + (info.typeName ? ' ' + info.typeName : '') + (info.role ? '：' + info.role : '') +
      (info.modelTier ? '\n档次：' + info.modelTier.replace(/^MODEL_TIER_/, '') : '') + (info.inherit ? '\n沿用主代理的全部工具' : '') +
      (calls.length ? '\n最近一次调用：' + calls.join(' · ') : ''));
    name.prepend(el('span', 'tree', last ? '└' : '├'));
    const ctx = sconv.ctx || estCtx(smd);
    const cs = ctxSeg(ctx, smu, sconv.compactions, id);
    if (cs && ctx && ctx.est) cs.setAttribute('data-agy-tip', cs.getAttribute('data-agy-tip') + '\n\n（估算：按这个子代理最近一次调用发给模型的 token，上限取同一模型在别的对话里的上限）');
    // 花费只要这个子代理自己的；“今天花费”那一项主代理的行上已经有了（11-22 子代理行上重复出现过）
    // 固定 6 列：名字、模型、上下文、缓存、花费、状态；没有的那列是 null，build 里换成占位，各行才能按列对齐（见 alignCols）
    const own = safeCost(smd, [id]).filter((g) => !g.classList.contains('p-open'));
    const row = [name, ms || null, cs || null, cacheSeg(smu) || null, own[0] || null];
    const v = actView(id);
    const meta = S.casMeta.get(id);
    const startAt = (meta && meta.created) || (v && v.firstAt) || 0;
    if (subRunning(id, root)) {
      if (v) {
        const waiting = /WAIT/.test(v.cur.status);
        const g = seg(waiting ? 'warn' : 'run', el('span', 'pulse'), [waiting ? 'waiting' : startAt ? fmtDur(Date.now() - startAt) : 'running'],
          '这个子代理正在：' + curText(v) + '（第 ' + (v.curK + 1) + ' 步' + (waiting ? '，在等你批准' : '') + '）' +
          (startAt ? '\n已经跑了 ' + fmtDur(Date.now() - startAt) : '') + '\n\n最近几步：\n' + timeline(v));
        g.classList.add('sst');
        const tx = !waiting && startAt ? g.querySelector('.tx') : null;
        if (tx) tx.dataset.agyT0 = String(startAt); // 每秒的 tickClocks 只改这一格的文字
        row.push(g);
      } else row.push(runSeg('running'));
    } else {
      const end = (v && Math.max(...v.ks.map((k) => v.a.steps.get(k).t1 || v.a.steps.get(k).t0 || 0))) || ag.lastAt || 0;
      const pieces = [startAt && end > startAt ? 'done ' + fmtDur(end - startAt) : 'done', v && v.a.total ? v.a.total + ' steps' : ''];
      const g = seg('muted', ICON('check'), pieces, v ? '这个子代理做过的最后几步：\n' + timeline(v) : '这个子代理已经结束');
      g.classList.add('sst');
      row.push(g);
    }
    return row;
  };
  const quotaPieces = (key) => {
    const qs = quotaSegs(key);
    if (qs.length) return qs;
    const q = familyQuota(S.models.get(key)); // 拿不到 5h/每周额度时退回旧的单模型额度
    if (!q || q.remainingFraction === undefined) return [];
    const frac = Math.max(0, Math.min(1, Number(q.remainingFraction)));
    const pct = Math.round(frac * 100);
    const k = pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'quota';
    return [seg('quota', ICON('quota1'), [meter(frac, k), pct + '%', q.resetTime ? fmtReset(q.resetTime) : ''],
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
        ctxSeg(sconv.ctx || estCtx(md), mu, sconv.compactions, paneId), cacheSeg(mu), ...safeCost(md, [paneId]),
        stateSeg(paneId, root)].filter(Boolean);
      const line2 = [...callSegs(md), ...quotaPieces(modelKey(md) || info.model)];
      S.actShown = false;
      return toLines([line1, line2]);
    }

    const root = paneId ? rootOf(paneId) : currentRoot();
    const main = root ? S.agents.get(root) : null;
    const md = main && main.last;
    const mu = md && md.modelUsage;
    const rc = (root && S.convs.get(root)) || null;
    // 还没有模型调用（首页或新对话刚开始）：显示模型按钮当前选中的模型
    const selKey = md ? '' : selectedKey();
    if (rc && rc.ctx) noteCtxMax(md, rc.ctx);
    const line1 = [modelSeg(md, selKey), ctxSeg(rc && rc.ctx, mu, rc && rc.compactions, root), cacheSeg(mu),
      ...safeCost(md, root ? treeIds(root) : []), root ? runSeg('', !isRunning(root)) : null].filter(Boolean);
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
    const shownSubs = subs.slice(0, MAX_SUBS);
    const more = subs.length - shownSubs.length;
    // 各行按列对齐（11-22 用户要求）：所有行都没有的列去掉；某行缺的列放一个空的占位项（不画分隔竖线），
    // 每项标上列号 data-col，画完后 alignCols 把同一列设成一样宽
    const subCells = shownSubs.map(({ id, info }, i) => subRow(id, info, root, i === shownSubs.length - 1 && !more));
    const hasCol = subCells.length ? subCells[0].map((_, c) => subCells.some((r) => r[c])) : [];
    const subRows = subCells.map((r) => r.map((g, c) => {
      if (!hasCol[c]) return null;
      const x = g || el('span', 'seg ph');
      x.dataset.col = c;
      return x;
    }).filter(Boolean));
    if (more > 0) {
      const m = seg('muted', '', ['+' + more + ' more subagents']);
      m.prepend(el('span', 'tree', '└'));
      subRows.push([m]);
    }

    S.actShown = subRows.length > 0; // 子代理行里有在走的用时：每秒改用时的文字，每 5 秒整条重画
    const lines = toLines([line1, line2]).concat(toLines(subRows, 'sub'));
    // fetch 包装晚到（注入器在窗口打开很久后才连上，没有自动刷新）：用量不生效，提示手动刷新
    if (S.early === false) {
      const reloadKey = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '') ? 'Cmd+R' : 'Ctrl+R';
      lines.push(...toLines([[seg('warn', '', ['Press ' + reloadKey + ' to reload this window and enable usage stats'],
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
  const TIP_CLASS = 'agy-tip'; // 悬停提示框（见 setTip 一节）
  const T = '.' + TIP_CLASS;
  // 配色（2026-11-22 加）。每套 [显示名, 悬停说明, 浅色, 深色]；浅色、深色各 18 个值，顺序见 PAL_VARS。
  // cometix 是默认，用下面 CSS 里的基础色，不在这里。pl-ink 是 powerline 外形里色块上的字色。
  // 色值出处：Catppuccin（catppuccin.com，Latte / Mocha）、Tokyo Night（folke/tokyonight.nvim，Day / Night）、
  // Rosé Pine（rosepinetheme.com，Dawn / Main）、Gruvbox（morhetz/gruvbox，light / dark）、Nord（nordtheme.com，
  // 官方只有深色，浅色版把偏淡的几种和 nord0 混合调深）、Dracula（draculatheme.com，浅色是官方的 Alucard）。
  const PAL_VARS = ['--k-model', '--k-context', '--k-cache', '--k-timing', '--k-tokens', '--k-quota', '--k-warn', '--k-crit', '--k-run',
    '--k-muted', '--k-agent', '--k-cost', '--k-argon', '--sep', '--cell-off', '--k-text', '--p-bg', '--pl-ink'];
  const nd = (c, p) => `color-mix(in srgb, ${c} ${p}%, #2e3440)`; // Nord 浅色：和 nord0 混合调深
  const PALETTES = {
    catppuccin: ['Catppuccin', 'Catppuccin：浅色 Latte / 深色 Mocha',
      ['#7287fd', '#8839ef', '#04a5e5', '#e64553', '#179299', '#fe640b', '#df8e1d', '#d20f39', '#40a02b', '#8c8fa1', '#df8e1d', '#ea76cb', '#1e66f5', '#bcc0cc', '#ccd0da', '#4c4f69', '#eff1f5', '#ffffff'],
      ['#b4befe', '#cba6f7', '#89dceb', '#eba0ac', '#94e2d5', '#fab387', '#f9e2af', '#f38ba8', '#a6e3a1', '#7f849c', '#f9e2af', '#f5c2e7', '#89b4fa', '#585b70', '#45475a', '#cdd6f4', '#1e1e2e', '#1e1e2e']],
    'tokyo-night': ['Tokyo Night', 'Tokyo Night：浅色 Day / 深色 Night',
      ['#2e7de9', '#9854f1', '#007197', '#387068', '#118c74', '#b15c00', '#8c6c3e', '#c64343', '#587539', '#848cb5', '#8c6c3e', '#f52a65', '#188092', '#a8aecb', '#c4c8da', '#3760bf', '#e1e2e7', '#ffffff'],
      ['#7aa2f7', '#bb9af7', '#7dcfff', '#73daca', '#1abc9c', '#ff9e64', '#e0af68', '#db4b4b', '#9ece6a', '#737aa2', '#e0af68', '#f7768e', '#2ac3de', '#3b4261', '#292e42', '#c0caf5', '#1a1b26', '#1a1b26']],
    'rose-pine': ['Rosé Pine', 'Rosé Pine：浅色 Dawn / 深色 Main',
      ['#907aa9', '#d7827e', '#56949f', '#286983', '#56949f', '#ea9d34', '#ea9d34', '#b4637a', '#286983', '#797593', '#ea9d34', '#b4637a', '#286983', '#cecacd', '#dfdad9', '#575279', '#faf4ed', '#fffaf3'],
      ['#c4a7e7', '#ebbcba', '#9ccfd8', '#9ccfd8', '#9ccfd8', '#f6c177', '#f6c177', '#eb6f92', '#31748f', '#908caa', '#f6c177', '#eb6f92', '#31748f', '#524f67', '#403d52', '#e0def4', '#191724', '#191724']],
    gruvbox: ['Gruvbox', 'Gruvbox：浅色 light / 深色 dark',
      ['#076678', '#8f3f71', '#427b58', '#b57614', '#427b58', '#af3a03', '#b57614', '#9d0006', '#79740e', '#928374', '#b57614', '#9d0006', '#076678', '#d5c4a1', '#ebdbb2', '#3c3836', '#fbf1c7', '#fbf1c7'],
      ['#83a598', '#d3869b', '#8ec07c', '#fabd2f', '#8ec07c', '#fe8019', '#fabd2f', '#fb4934', '#b8bb26', '#a89984', '#fabd2f', '#fb4934', '#83a598', '#504945', '#3c3836', '#ebdbb2', '#282828', '#282828']],
    nord: ['Nord', 'Nord：官方只有深色，浅色版把偏淡的颜色调深了',
      ['#5e81ac', nd('#b48ead', 80), nd('#88c0d0', 60), nd('#8fbcbb', 60), nd('#8fbcbb', 60), nd('#d08770', 85), nd('#ebcb8b', 60), '#bf616a', nd('#a3be8c', 65), '#7b88a1', nd('#ebcb8b', 60), nd('#bf616a', 90), '#5e81ac', '#d8dee9', '#e5e9f0', '#2e3440', '#eceff4', '#ffffff'],
      ['#81a1c1', '#b48ead', '#88c0d0', '#8fbcbb', '#8fbcbb', '#d08770', '#ebcb8b', '#bf616a', '#a3be8c', '#7b88a1', '#ebcb8b', '#bf616a', '#5e81ac', '#434c5e', '#3b4252', '#d8dee9', '#2e3440', '#2e3440']],
    dracula: ['Dracula', 'Dracula：浅色是官方的 Alucard / 深色 Dracula',
      ['#644ac9', '#a3144d', '#036a96', '#644ac9', '#036a96', '#a34d14', '#846e15', '#cb3a2a', '#14710a', '#6c664b', '#846e15', '#846e15', '#644ac9', '#cfcfde', '#ece7d2', '#1f1f1f', '#fffbeb', '#fffbeb'],
      ['#bd93f9', '#ff79c6', '#8be9fd', '#bd93f9', '#8be9fd', '#ffb86c', '#f1fa8c', '#ff5555', '#50fa7b', '#6272a4', '#f1fa8c', '#f1fa8c', '#bd93f9', '#44475a', '#44475a', '#f8f8f2', '#282a36', '#282a36']],
    mono: ['Mono', '单色：只用深浅不同的灰，警告和超限才上色',
      ['#3f4248', '#55585e', '#6b6e74', '#55585e', '#6b6e74', '#4a4d53', '#b8790e', '#c4223b', '#55585e', '#8b8e94', '#6b6e74', '#3f4248', '#2f3237', '#cfcfd2', '#e4e4e7', '#3f4248', '#ffffff', '#ffffff'],
      ['#d4d6da', '#bfc2c7', '#a8abb1', '#bfc2c7', '#a8abb1', '#c9ccd1', '#f9e2af', '#f38ba8', '#bfc2c7', '#7d8086', '#a8abb1', '#d4d6da', '#e6e8eb', '#4a4d53', '#3a3d42', '#d4d6da', '#1f2023', '#1f2023']],
  };
  const PAL_INFO = { cometix: ['Cometix', '本项目默认：仿 ccline 的 cometix 预设。浅色以 Catppuccin Latte 为底、把偏淡的颜色调深，深色是 Catppuccin Mocha'] };
  for (const [k, p] of Object.entries(PALETTES)) PAL_INFO[k] = [p[0], p[1]];
  const DARK = (sel) => `body.theme-dark ${sel}, :root[style*="color-scheme: dark"] ${sel}`;
  const PAL_CSS = Object.entries(PALETTES).map(([k, [, , light, dark]]) => {
    const sels = [B, P, T].map((x) => `${x}[data-pal="${k}"]`);
    const vars = (vals) => PAL_VARS.map((v, i) => `${v}:${vals[i]}`).join('; ');
    return `${sels.join(', ')}{${vars(light)}}\n${sels.map(DARK).join(', ')}{${vars(dark)}}`;
  }).join('\n');
  const style = document.createElement('style');
  style.textContent = `
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400..500,0..1,0&icon_names=account_tree,auto_awesome,calendar_month,check,data_usage,database,date_range,event,history,hourglass_top,offline_bolt,paid,palette,person,schedule,speed,timelapse,timer,today&display=block");
${B}, ${P}, ${T}{
  --k-model:#5c64d6; --k-context:#8839ef; --k-cache:#1b8fbf; --k-timing:#c4566a; --k-tokens:#158a90;
  --k-quota:#e0620d; --k-warn:#c9800f; --k-crit:#d20f39; --k-run:#40a02b; --k-muted:#8c8fa1;
  --k-agent:#df8e1d; --k-cost:#c03d8e; --k-argon:#1e66f5;
  --sep:#c9c6bc; --cell-off:#e6e2d8; --p-bg:#fffefb; --k-text:#4c4f69; --pl-ink:#ffffff;
}
${B}{
  display:flex; flex-direction:column; gap:1px; padding:0 .9rem .35rem;
  font-family:"Google Sans Code","Cascadia Mono",Consolas,ui-monospace,"Microsoft YaHei UI",monospace;
  font-size:12px; line-height:1.65; font-weight:500; font-variant-numeric:tabular-nums;
  color:var(--k-muted); user-select:text; cursor:default;
}
body.theme-dark ${B}, :root[style*="color-scheme: dark"] ${B}, body.theme-dark ${P}, :root[style*="color-scheme: dark"] ${P},
body.theme-dark ${T}, :root[style*="color-scheme: dark"] ${T}{
  --k-model:#b4befe; --k-context:#cba6f7; --k-cache:#89dceb; --k-timing:#f2cdcd; --k-tokens:#94e2d5;
  --k-quota:#fab387; --k-warn:#f9e2af; --k-crit:#f38ba8; --k-run:#a6e3a1; --k-muted:#7f849c;
  --k-agent:#f9e2af; --k-cost:#f5c2e7; --k-argon:#89b4fa; --p-bg:#1e1e2e; --k-text:#cdd6f4;
  --sep:#585b70; --cell-off:#45475a; --pl-ink:#1e1e2e;
}
/* 其他配色（data-pal，见 PALETTES）：浅色、深色各一条，选择器比上面的基础色更具体 */
${PAL_CSS}
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
/* 压缩过上下文：小徽章（图标 + 次数），详细说明在上下文这一项的悬停提示里（issue #2：原来的 “compacted 1×” 太宽，会把 running 挤到下一行） */
${B} .comp{display:inline-flex; align-items:center; color:var(--k-warn); font-weight:600; font-size:11px; padding:0 .4em; border-radius:4px; line-height:1.45;
  background:color-mix(in srgb, var(--k-warn) 15%, transparent)}
${B} .comp .cyc{margin-right:.12em; font-weight:700}
${B} .comp.clk{cursor:pointer} ${B} .comp.clk:hover{background:color-mix(in srgb, var(--k-warn) 30%, transparent)}
/* 单次调用很贵：红色小徽章（感叹号 + 金额），刚出现时闪几下（2026-11-24） */
${B} .costly{display:inline-flex; align-items:center; color:var(--k-crit); font-weight:600; font-size:11px; padding:0 .4em; border-radius:4px; line-height:1.45;
  background:color-mix(in srgb, var(--k-crit) 14%, transparent)}
${B} .costly .ex{margin-right:.15em; font-weight:800}
${B} .costly.flash{animation:agyCostly .9s ease-in-out 6}
@keyframes agyCostly{50%{background:color-mix(in srgb, var(--k-crit) 42%, transparent)}}
/* running 一直占着位置，空闲时只是看不见：开始、结束生成时状态栏的行数不变，不会上下跳。
   11-22：第一行太长时 running 会被挤到第二行（issue #2 的老问题，花费数字变长后又出现了）。改成按 0 宽排：永远留在第一行，
   行里有空位就显示全，空位不够就截短。plain 外形的分隔竖线画在项的左外侧，这一项要裁掉溢出，所以把竖线挪进项里 */
${B} .ln > .seg.k-run{flex:1 1 0; min-width:0; max-width:max-content; overflow:hidden}
${B} .ln > .seg.k-run > *{flex-shrink:0}
${B}[data-skin="plain"] .ln > .seg.k-run{margin-left:.55em; padding-left:1.05em}
${B}[data-skin="plain"] .ln > .seg.k-run::before{left:0}
${B} .seg.k-run.idle{visibility:hidden}
${B} .pace-ok{color:var(--k-run)}
${B} .pace-hi{color:var(--k-warn)}
${B} .real.odd{opacity:1; font-weight:600; color:var(--k-warn)}
${B} .real.prev{font-style:italic}
${B} .ln.sub{margin-left:-.5em; font-size:11.5px} /* 子代理行比主代理行缩进 1.1em */
/* 子代理行末尾的状态（● 9m47s / ✓ done …）：按 0 宽排，所以永远不会被挤到第二行；行里剩多少空就占多少，放不下就截掉末尾。
   plain 外形的分隔竖线画在项的左外侧，这一项要裁掉溢出，所以把竖线挪进项里（左内边距） */
${B} .seg.sst{flex:1 1 0; min-width:0; max-width:max-content; overflow:hidden}
${B} .seg.sst > *{flex-shrink:0}
${B}[data-skin="plain"] .seg.sst{margin-left:.55em; padding-left:1.05em}
${B}[data-skin="plain"] .seg.sst::before{left:0}
/* 子代理行按列对齐（见 alignCols）：最小宽度按边框盒算；占位项不画分隔竖线和底色 */
${B} .ln.sub > .seg[data-col]{box-sizing:border-box}
${B} .ln.sub > .seg.ph::before{visibility:hidden}
${B} .ln.sub > .seg.ph{background:none; clip-path:none}
/* 子代理行开头的树形线 ├ └ */
${B} .tree{color:var(--k-muted); margin-right:.4em; font-weight:400; opacity:.8}
${B} .gap{display:inline-block; width:.5em}
${B} .cells{display:inline-flex; gap:2px; margin-right:.1em}
${B} .cells i{display:block; width:5px; height:10px; border-radius:1.5px; background:var(--cell-off)}
${B} .cells i.on{background:var(--kc)}
${B} .pulse{width:7px; height:7px; border-radius:50%; background:var(--kc); margin-right:.45em; animation:agyPulse 1.2s ease-in-out infinite}
@keyframes agyPulse{0%,100%{opacity:1}50%{opacity:.25}}
/* 进度条的另外两种样式（见 meter）：细条、小圆环；上下文的仪表图标也是圆环 */
${B} .meter.thin{display:inline-block; width:34px; height:5px; border-radius:3px; background:var(--cell-off); overflow:hidden; margin-right:.1em}
${B} .meter.thin i{display:block; height:100%; border-radius:3px; background:var(--kc)}
${B} .meter.ring{display:inline-flex; width:13px; height:13px}
${B} .meter.ring svg, ${B} .gauge svg{width:100%; height:100%; display:block; transform:rotate(-90deg)}
${B} .ic.gauge svg{width:.92em; height:.92em}
${B} .ring .trk, ${B} .gauge .trk{fill:none; stroke:var(--cell-off); stroke-width:3.6}
${B} .ring .arc, ${B} .gauge .arc{fill:none; stroke:var(--kc); stroke-width:3.6; stroke-linecap:round}
${B}[data-icons="off"] .ic{display:none}
/* 图标整套（见 ICON_ITEMS）：outline 是同一套字体的线条版；unicode 用普通字符，不依赖在线字体 */
${B}[data-icons="outline"] .ic:not(.svg){font-variation-settings:"FILL" 0,"wght" 500,"opsz" 20}
${B} .ic.uni{font-family:"Cascadia Mono",Consolas,"Segoe UI Symbol","Apple Symbols",ui-monospace,monospace; font-size:14px; font-weight:700; text-align:center; font-variation-settings:normal}
/* 外形 pill：每项一个圆角底色块，不画竖线 */
${B}[data-skin="pill"] .ln{margin-left:0; clip-path:none; gap:3px 5px}
${B}[data-skin="pill"] .seg{margin-left:0; padding:0 .6em; border-radius:999px; line-height:1.6; background:color-mix(in srgb, var(--kc) 13%, transparent)}
${B}[data-skin="pill"] .seg::before{content:none}
/* 外形 powerline：箭头色块，字用 --pl-ink；第一块左边是平的 */
${B}[data-skin="powerline"] .ln{margin-left:0; clip-path:none; row-gap:3px}
${B}[data-skin="powerline"] .seg{margin-left:-.3em; padding:0 .95em 0 1.05em; line-height:1.75; background:var(--kc); color:var(--pl-ink);
  clip-path:polygon(0 0, calc(100% - .6em) 0, 100% 50%, calc(100% - .6em) 100%, 0 100%, .6em 50%)}
${B}[data-skin="powerline"] .seg:first-child{margin-left:0; padding-left:.7em; border-radius:5px 0 0 5px;
  clip-path:polygon(0 0, calc(100% - .6em) 0, 100% 50%, calc(100% - .6em) 100%, 0 100%)}
${B}[data-skin="powerline"] .seg::before{content:none}
${B}[data-skin="powerline"] .seg .pace-ok, ${B}[data-skin="powerline"] .seg .pace-hi, ${B}[data-skin="powerline"] .seg .real.odd{color:inherit; font-weight:700}
${B}[data-skin="powerline"] .seg .real{opacity:.82}
${B}[data-skin="powerline"] .cells i, ${B}[data-skin="powerline"] .meter.thin{background:color-mix(in srgb, var(--pl-ink) 30%, transparent)}
${B}[data-skin="powerline"] .cells i.on, ${B}[data-skin="powerline"] .meter.thin i, ${B}[data-skin="powerline"] .pulse{background:var(--pl-ink)}
${B}[data-skin="powerline"] .ring .trk, ${B}[data-skin="powerline"] .gauge .trk{stroke:color-mix(in srgb, var(--pl-ink) 30%, transparent)}
${B}[data-skin="powerline"] .ring .arc, ${B}[data-skin="powerline"] .gauge .arc{stroke:var(--pl-ink)}
${B}[data-skin="powerline"] .comp{color:inherit; background:color-mix(in srgb, var(--pl-ink) 22%, transparent)}
${B}[data-skin="powerline"] .costly{color:inherit; background:color-mix(in srgb, var(--pl-ink) 30%, transparent)}
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
${P} .ic{font-family:"Material Symbols Rounded"; font-weight:normal; font-style:normal; font-size:14px; line-height:1; vertical-align:-2px;
  margin-right:.25em; font-variation-settings:"FILL" 1,"wght" 500,"opsz" 20; display:inline-block; width:1em; overflow:hidden}
/* Theme 页（2026-11-22 加）：配色画廊（每张卡片是当前状态栏的实时副本）+ 外形、进度条、信息密度、图标的选择 */
${P} .lk-sec{margin:.55rem 0 .3rem; color:var(--k-text); font-weight:600}
${P} .lk-grid{display:grid; grid-template-columns:1fr; gap:.4rem}
${P} .lk-card{display:block; box-sizing:border-box; width:100%; text-align:left; font:inherit; color:inherit; background:transparent; cursor:pointer;
  border:1px solid var(--sep); border-radius:8px; padding:.3rem .55rem .35rem; overflow:hidden}
${P} .lk-card:hover{border-color:var(--k-muted)}
${P} .lk-card.on{border-color:var(--k-cost); box-shadow:inset 0 0 0 1px var(--k-cost)}
${P} .lk-name{display:flex; align-items:center; gap:.45em; color:var(--k-text); font-weight:600; margin-bottom:.15rem}
${P} .lk-tag{font-size:10px; font-weight:500; color:var(--k-muted); border:1px solid var(--sep); border-radius:4px; padding:0 .35em; line-height:1.4}
${P} .lk-card.on .lk-tag.cur{color:var(--k-cost); border-color:var(--k-cost)}
${P} .lk-prev{padding:0; font-size:11px; pointer-events:none}
${P} .lk-empty{color:var(--k-muted); padding:.2rem 0}
${P} .lk-row{display:flex; align-items:center; flex-wrap:wrap; gap:.35rem; margin-top:.4rem}
${P} .lk-lab{width:6.2em; color:var(--k-text)}
${P} .lk-note{margin-top:.55rem; color:var(--k-muted); font-size:11px}
${P} .ic.svg{display:inline-flex; align-items:center; overflow:visible} ${P} .ic.svg svg{width:1em; height:1em; display:block}
${P} .ic.ol{font-variation-settings:"FILL" 0,"wght" 500,"opsz" 20}
${P} .lk-icons.dim{opacity:.45}
${P} .lk-icons .lk-row{margin-top:.25rem}
${P} .lk-ib{padding:.1em .35em; line-height:1}
${P} .lk-ib .ic{margin-right:0; font-size:17px; vertical-align:middle}
${P} .p-range{color:var(--k-muted); margin-left:.35rem}
${P} .p-acct{color:var(--k-muted); font-size:11px; margin-right:.2rem; white-space:nowrap; cursor:default}
${P} .p-new{color:var(--k-run); font-size:11px; margin-right:.4rem; white-space:nowrap; cursor:default; font-weight:600}
/* 柱状图：上面留 16px 给柱顶的金额；每根柱子从下往上叠（column-reverse），柱顶那段圆角 */
${P} .p-chart{height:122px; padding-top:16px; box-sizing:border-box; border-bottom:1px solid var(--sep)}
${P} .p-bars{position:relative; display:flex; align-items:stretch; gap:3px; height:100%}
${P} .p-col{position:relative; flex:1; min-width:0; display:flex; flex-direction:column-reverse; border-radius:3px 3px 0 0; cursor:pointer}
${P} .p-col:hover, ${P} .p-col.sel{background:color-mix(in srgb, var(--sep) 28%, transparent)}
${P} .p-part{background:var(--kc); flex:none; transition:opacity .12s, filter .12s}
${P} .p-part.top{border-radius:2px 2px 0 0}
/* 悬停：停在哪一段就高亮哪一段，同一天的其他段变淡；停在图例上，每一天里这个模型的那一段高亮 */
${P} .p-col:has(.p-part:hover) .p-part:not(:hover){opacity:.35}
${P} .p-part:hover{filter:brightness(1.12) saturate(1.15); box-shadow:inset 0 0 0 1.5px color-mix(in srgb, #fff 60%, transparent)}
${P} .p-bars.focus .p-part{opacity:.2}
${P} .p-bars.focus .p-part.hl{opacity:1; filter:brightness(1.08)}
${P} .p-val{flex:none; align-self:center; font-size:10px; line-height:14px; color:var(--k-cost); white-space:nowrap; pointer-events:none}
${P} .p-avg{position:absolute; left:0; right:0; height:0; border-top:1px dashed color-mix(in srgb, var(--k-cost) 55%, transparent); pointer-events:none}
${P} .p-labels{display:flex; gap:3px; margin:.2rem 0 .45rem}
${P} .p-labels span{flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; font-size:10.5px; line-height:1.25; white-space:nowrap}
${P} .p-labels b{font-weight:500}
${P} .p-labels i{font-style:normal; opacity:.7}
${P} .p-labels.dense i{opacity:1}
${P} .p-labels span.today{color:var(--k-cost); font-weight:600}
/* ↺：那天每周额度被提前重置（日期后面、表格额度格后面） */
${P} .p-rs{font-style:normal; font-weight:600; color:var(--k-quota); margin-left:.25em}
${P} .p-labels .p-rs{opacity:1}
${P} .p-legend{display:flex; flex-wrap:wrap; gap:.15rem 1rem; margin-bottom:.45rem}
${P} .p-legend > span{color:var(--kc); display:inline-flex; align-items:center; cursor:default}
${P} .p-legend i{display:inline-block; width:8px; height:8px; border-radius:2px; background:var(--kc); margin-right:.35em}
${P} .p-legend .v{margin-left:.45em; opacity:.75}
/* 今天的汇总卡片：四格，上面小字标签、下面数值（颜色跟状态栏里同类的项一样） */
${P} .p-kpi{display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:.4rem; margin:.1rem 0 .55rem}
${P} .p-kpi .kc{display:flex; flex-direction:column; gap:.05rem; padding:.3rem .55rem; border:1px solid var(--sep); border-radius:8px; cursor:default; min-width:0}
${P} .p-kpi .kl{color:var(--k-muted); font-size:11px}
${P} .p-kpi .kv{color:var(--kc); font-size:17px; font-weight:600; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
${P} td.tk{color:var(--k-tokens)}
/* 表格：限高滚动，表头固定；鼠标停在某一行，对应的柱子高亮；点柱子时对应的行闪一下 */
${P} .p-table{overflow:auto; max-height:12.5em}
${P} table{width:100%; border-collapse:collapse}
${P} th{position:sticky; top:0; z-index:1; background:var(--p-bg-live, var(--p-bg)); font-weight:500; text-align:right; padding:.05rem .5rem; border-bottom:1px solid var(--sep); white-space:nowrap}
${P} td{text-align:right; padding:.05rem .5rem; white-space:nowrap}
${P} th:first-child, ${P} td:first-child{text-align:left; padding-left:0}
${P} td.c{color:var(--k-cost)} ${P} td.c.costly{color:var(--k-crit); font-weight:700; background:color-mix(in srgb, var(--k-crit) 13%, transparent)} ${P} td.c.costly::before{content:"! "}${P} td.h{color:var(--k-cache)} ${P} td.q{color:var(--k-quota)}
${P} tbody tr:hover td{background:color-mix(in srgb, var(--sep) 22%, transparent)}
${P} tr.today td{font-weight:600}
${P} tr.clk{cursor:pointer}
${P} td.h.miss{color:var(--k-warn); font-weight:600}
${P} .p-tools .k-miss{--kc:var(--k-warn)} ${P} .p-foot .k-miss.clk{cursor:pointer} ${P} .p-foot .k-miss.clk:hover{text-decoration:underline}
/* 调用明细页：表格更高；对话、模型两列左对齐 */
${P} .p-table.calls{max-height:max(14em, calc(var(--p-avail, 40em) - 6.5rem))} /* 撑满面板能用的高度（标题行和底部说明留 6.5rem） */
${P} .p-table.calls th, ${P} .p-table.calls td{padding:.05rem .32rem; font-size:11px}
${P} .p-table.calls td.cv, ${P} .p-table.calls td.md{text-align:left; overflow:hidden; text-overflow:ellipsis}
${P} .p-table.calls td.cv{max-width:clamp(10em, 24vw, 26em)} ${P} .p-table.calls td.md{max-width:12em}
${P} .p-table.calls th:nth-child(2), ${P} .p-table.calls th:nth-child(3){text-align:left}
${P} .p-note{margin-top:.4rem; color:var(--k-muted); font-size:11px}
${P} .p-note:empty{display:none}
/* 调用明细：筛选按钮连成一组；表格下面的“再显示” */
${P} .p-seg{display:inline-flex}
${P} .p-seg .p-btn{border-radius:0; margin-left:-1px}
${P} .p-seg .p-btn:first-child{border-radius:6px 0 0 6px; margin-left:0}
${P} .p-seg .p-btn:last-child{border-radius:0 6px 6px 0}
${P} .p-seg .p-btn.on{position:relative; z-index:1}
${P} .p-more{display:flex; align-items:center; justify-content:center; gap:.6rem; margin-top:.4rem; font-size:11px}
${P} .p-more .dim{color:var(--k-muted)}
${P} .p-seg[hidden], ${P} .p-more[hidden]{display:none}
/* 调用明细第二行：视图、来源、模型几组按钮，放不下就换行；模型按钮前面一个和每日面板同色的小方块 */
${P} .p-tools{display:flex; flex-wrap:wrap; align-items:center; gap:.35rem .6rem; margin:-.1rem 0 .4rem}
${P} .p-tools[hidden]{display:none}
${P} .p-tools .p-btn[class*=" k-"]::before{content:""; display:inline-block; width:7px; height:7px; border-radius:2px; background:var(--kc); margin-right:.35em; vertical-align:1px}
${P} .p-chip{max-width:22em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
${P} tr.flash td{animation:agyFlash 1.2s ease-out}
@keyframes agyFlash{0%{background:color-mix(in srgb, var(--k-cost) 24%, transparent)}100%{background:transparent}}
${P} .p-empty{padding:.4rem 0}
${P} .p-note{color:var(--k-muted); margin:.25rem 0 .45rem; white-space:normal; line-height:1.5}
${P} .p-ckpt{white-space:pre-wrap; line-height:1.5; max-height:58vh; overflow:auto; padding:.4rem .55rem; border:1px solid var(--sep); border-radius:6px; overflow-wrap:anywhere}
${P} .p-ckpt b.h{display:inline-block; margin-top:.3rem; color:var(--k-cost)}
${P} .p-ckpt code, ${P} .p-path{font-family:ui-monospace, Consolas, Menlo, monospace; font-size:.92em; overflow-wrap:anywhere; user-select:text}
${P} .p-foot{margin-top:.5rem; display:flex; flex-direction:column; gap:.05rem}
${P} .p-foot div{color:var(--kc)}
/* 悬停卡片（代替系统提示框）：跟着鼠标，不挡鼠标事件 */
${P} .p-card{position:absolute; z-index:3; pointer-events:none; min-width:170px; max-width:320px; padding:.4rem .6rem .45rem;
  border:1px solid var(--sep); border-radius:8px; background:var(--p-bg-live, var(--p-bg)); box-shadow:0 6px 20px rgba(0,0,0,.16);
  font-size:11.5px; line-height:1.55; color:var(--k-text)}
${P} .p-card .t{font-weight:600; margin-bottom:.1rem}
${P} .p-card .sum{color:var(--k-cost)}
${P} .p-card .row{display:flex; align-items:center; gap:.45em}
${P} .p-card .row i{display:inline-block; flex:none; width:8px; height:8px; border-radius:2px; background:var(--kc)}
${P} .p-card .row .n{color:var(--kc)}
${P} .p-card .row .v{margin-left:auto; padding-left:1em}
${P} .p-card .row .dim{min-width:2.8em; text-align:right}
${P} .p-card .dim{color:var(--k-muted)}
${P} .p-card .q{color:var(--k-quota)}
${P} .k-model{--kc:var(--k-model)} ${P} .k-context{--kc:var(--k-context)} ${P} .k-cache{--kc:var(--k-cache)} ${P} .k-tokens{--kc:var(--k-tokens)}
${P} .k-quota{--kc:var(--k-quota)} ${P} .k-cost{--kc:var(--k-cost)} ${P} .k-run{--kc:var(--k-run)} ${P} .k-argon{--kc:var(--k-argon)} ${P} .k-muted{--kc:var(--k-muted)}
/* 悬停提示（代替系统 title，见 setTip 一节）：挂在 body 上，不挡鼠标；背景色由脚本取元素一带的实际底色 */
${T}{position:fixed; z-index:2147483600; pointer-events:none; box-sizing:border-box; max-width:min(440px, calc(100vw - 16px));
  padding:.35rem .6rem .4rem; border:1px solid var(--sep); border-radius:8px; background:var(--p-bg); box-shadow:0 6px 20px rgba(0,0,0,.18);
  font-family:"Google Sans Code","Cascadia Mono",Consolas,ui-monospace,"Microsoft YaHei UI",monospace;
  font-size:11.5px; line-height:1.55; font-weight:500; color:var(--k-text); white-space:pre-line; overflow-wrap:anywhere}
`;

  // ---------- 悬停提示（2026-11-22 加，issue #2）----------
  // 以前用系统 title 提示：生成回复时状态栏每 300 毫秒整个重画，鼠标下面的元素被换掉，系统提示的计时一直重来，
  // 就弹不出来；macOS 的系统提示本来就慢，更明显。改成自己画的提示框：挂在 body 上，文字放在 data-agy-tip 里；
  // 每次重画后按鼠标最后的位置重新找元素，提示框不会被重画打断，里面的数字也跟着更新。状态栏和每日面板共用。
  const setTip = (e, text) => { if (e && text) e.setAttribute('data-agy-tip', text); return e; };
  const tip = { el: null, target: null, x: -1, y: -1, timer: 0, hideAt: 0 };
  const tipBox = () => {
    if (!tip.el || !tip.el.isConnected) {
      tip.el = el('div', TIP_CLASS);
      tip.el.setAttribute('data-agy-no-i18n', '');
      tip.el.setAttribute('role', 'tooltip');
      tip.el.hidden = true;
      document.body.append(tip.el);
    }
    return tip.el;
  };
  const tipOwner = (node) => {
    const t = node && node.closest ? node.closest('[data-agy-tip]') : null;
    return t && t.closest(B + ',' + P) ? t : null;
  };
  const hideTip = () => {
    clearTimeout(tip.timer);
    tip.timer = 0;
    tip.target = null;
    if (tip.el && !tip.el.hidden) { tip.el.hidden = true; tip.hideAt = Date.now(); }
  };
  // 显示在元素上方（状态栏贴着输入框，下方没地方）；上方放不下才放下方
  const placeTip = () => {
    const t = tip.target;
    if (!t || !t.isConnected) { hideTip(); return; }
    const box = lookAttrs(tipBox());
    const text = t.getAttribute('data-agy-tip') || '';
    if (box.textContent !== text) box.textContent = text;
    const bg = solidBg(t);
    if (bg) box.style.background = bg;
    box.hidden = false;
    const r = t.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let y = r.top - h - 6;
    if (y < 8) y = Math.min(r.bottom + 6, window.innerHeight - h - 8);
    box.style.left = x + 'px';
    box.style.top = y + 'px';
  };
  const tipMove = (ev) => {
    tip.x = ev.clientX;
    tip.y = ev.clientY;
    const t = tipOwner(ev.target);
    if (t === tip.target) return;
    if (!t) { hideTip(); return; }
    const showing = tip.el && !tip.el.hidden;
    tip.target = t;
    clearTimeout(tip.timer);
    tip.timer = 0;
    // 正在显示，或刚关掉不到 0.6 秒：直接换成这一项（像系统提示那样连着看）；否则停 0.35 秒再显示
    if (showing || Date.now() - tip.hideAt < 600) { placeTip(); return; }
    tip.timer = setTimeout(() => { tip.timer = 0; if (tip.target) placeTip(); }, 350);
  };
  // 状态栏或面板重画以后调用：鼠标下的元素换成了新的，就按鼠标位置重新找
  const tipAfterRender = () => {
    if (!tip.target || tip.target.isConnected) return;
    const t = tip.x >= 0 ? tipOwner(document.elementFromPoint(tip.x, tip.y)) : null;
    if (!t) { hideTip(); return; }
    tip.target = t;
    if (tip.el && !tip.el.hidden) placeTip(); // 正在等 0.35 秒的话，计时到了会用新元素
  };
  // 挂监听；返回去掉监听的函数（换新版本时用，见 start）
  const tipListen = () => {
    const out = (ev) => { if (!ev.relatedTarget) hideTip(); }; // 鼠标移出窗口
    document.addEventListener('mousemove', tipMove, true);
    document.addEventListener('mousedown', hideTip, true);
    document.addEventListener('wheel', hideTip, { capture: true, passive: true });
    document.addEventListener('mouseout', out, true);
    window.addEventListener('blur', hideTip);
    return () => {
      document.removeEventListener('mousemove', tipMove, true);
      document.removeEventListener('mousedown', hideTip, true);
      document.removeEventListener('wheel', hideTip, { capture: true });
      document.removeEventListener('mouseout', out, true);
      window.removeEventListener('blur', hideTip);
      hideTip();
    };
  };

  // 子代理行按列对齐：同一列（data-col）的项取最宽那项的宽度做最小宽度。最后一列（状态）按 0 宽排、会被截短，不参与。
  // 先全部清掉、再一起量、最后一起设，只触发一次排版。窗格隐藏时量出来是 0，等于不对齐，下次重画再对。
  // 量宽度要等浏览器排版（实测每次约 3 毫秒，占整次重画的一半多），所以按内容缓存：
  // 各列的文字、外观设置、缩放、字体加载状态都没变时，直接用上次量出的宽度，不再量。
  // 缓存最多用 30 秒：图标字体晚到等签名看不出来的变化，最晚 30 秒后也会重新量。
  const alignCols = (bar) => {
    const lines = bar.querySelectorAll('.ln.sub');
    if (lines.length < 2) { bar._agyAlign = null; return; }
    const cols = new Map();
    let sig = JSON.stringify(S.look) + '|' + devicePixelRatio + '|' + document.fonts.status + '|' + document.fonts.size;
    for (const l of lines) {
      for (const g of l.children) {
        const c = g.dataset.col;
        if (c === undefined || g.classList.contains('sst') || g.classList.contains('k-run')) continue;
        if (!cols.has(c)) cols.set(c, []);
        cols.get(c).push(g);
        sig += '\n' + c + ':' + g.className + ':' + g.textContent;
      }
    }
    const old = bar._agyAlign;
    let widths = old && old.sig === sig && Date.now() - old.at < 30000 ? old.widths : null;
    if (!widths) {
      for (const gs of cols.values()) for (const g of gs) g.style.minWidth = '';
      widths = [...cols.values()].map((gs) => Math.max(...gs.map((g) => g.getBoundingClientRect().width)));
      bar._agyAlign = widths.every((w) => w > 0) ? { sig, widths, at: Date.now() } : null; // 窗格隐藏时量出来是 0，不记
    }
    [...cols.values()].forEach((gs, i) => { if (widths[i] > 0) gs.forEach((g) => { g.style.minWidth = widths[i] + 'px'; }); });
  };
  // 子代理在跑时每秒调一次：只改用时那几个字，不重画整条（整条重画每次约 6 毫秒）
  const tickClocks = () => {
    const now = Date.now();
    for (const e of document.querySelectorAll(B + ' [data-agy-t0]')) {
      const t = fmtDur(now - Number(e.dataset.agyT0));
      if (e.textContent !== t) e.textContent = t;
    }
  };

  // 保证每个输入框上方都有状态栏；force 时重画内容
  // S.actShown（有子代理行）按所有窗格合起来算：build 只写自己窗格的，多个窗格时不能让最后一个说了算（11-23 审查发现）
  const ensure = (force) => {
    if (!document.body) return;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    const prevAct = S.actShown;
    let act = false;
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
      lookAttrs(bar);
      if (force || fresh) {
        S.actShown = false;
        bar.replaceChildren(...build(paneConvId(box)));
        alignCols(bar);
        act = act || S.actShown;
      }
    }
    S.actShown = force ? act : prevAct || act; // 没重画的窗格沿用原来的
    tipAfterRender();
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

  // 换外观：fromFile = 注入程序推过来的 look.json（比页面里记着的新才用）；否则是在 Theme 页里点的，
  // 记在 S.lookPick 等注入程序读走（见 inject.mjs 的 syncCost）。换完马上重画状态栏和面板（进度条样式、详略会改内容）。
  S.setLook = (o, fromFile) => {
    const l = cleanLook({ ...S.look, ...o });
    if (fromFile) {
      if (!((l.at || 0) > (S.look.at || 0))) return;
    } else {
      l.at = Date.now();
      S.lookPick = l;
    }
    S.look = l;
    ensure(true);
    refreshPanel();
  };
  // 注入程序检查完在线更新后推过来（见 inject.mjs 的 pushRemote）：换价格表，重画状态栏和打开着的面板
  S.setRemote = (r) => {
    if (!r || typeof r !== 'object') return;
    S.remote = r;
    setPrices(r.on !== false ? r.prices : null);
    ensure(true);
    refreshPanel();
  };

  // 每秒检查一次：输入框被重新创建就补上状态栏，切换了对话就重画；每 30 秒重画一次（额度重置时间会变）；
  // 按需查后台对话摘要（子代理是否还在跑，见 S.fetchCascades）
  const start = () => {
    // 换掉旧版本留下的定时器、样式和状态栏
    if (S.timer) clearInterval(S.timer);
    if (S.styleEl && S.styleEl !== style) S.styleEl.remove();
    S.styleEl = style;
    document.querySelectorAll('.' + BAR_CLASS).forEach((b) => b.remove());
    closePanel(); // 旧版本开着的面板和它的监听也一起去掉
    if (S.tipOff) S.tipOff(); // 旧版本的悬停提示监听和提示框
    document.querySelectorAll(T).forEach((e) => e.remove());
    S.tipOff = tipListen();
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
      if (S.lsHeaders && document.visibilityState !== 'hidden') { try { S.pollSubs(); } catch (e) { /* 子代理步骤取不到不影响其他显示 */ } }
      if (S.lsHeaders && !S.account && Date.now() - (S.acctAskAt || 0) > 60000) {
        S.acctAskAt = Date.now();
        lsCall('GetUserStatus', {}).then((j) => { if (j) S.onMessage('GetUserStatus', j); });
      }
      // 今天 agy CLI 的用量变了（注入程序扫到变化会马上推一次历史）：马上整条重画，今天花费不用等 30 秒一次的重画（2026-11-24 加）
      const cliToday = S.history && S.history.days && S.history.days[dayName()] && S.history.days[dayName()].cli;
      const cliKey = cliToday ? cliToday.calls + ':' + cliToday.convs : '';
      if (cliKey !== S.cliKeySeen) { S.cliKeySeen = cliKey; if (hidden()) dirty = true; else ensure(true); }
      const nowSel = selectedLabel();
      if (location.pathname !== path) { path = location.pathname; S.navAt = Date.now(); sel = nowSel; ensure(true); }
      else if (hidden()) { if (ticks % 30 === 0) dirty = true; ensure(false); } // 后台：只保证状态栏还在，回到前台再重画
      // 换了模型、每 30 秒、子代理行在显示时每 5 秒（跑完的行到时间要收起）整条重画；其余的秒里子代理的用时只改文字
      else if (nowSel !== sel || ticks % 30 === 0 || (S.actShown && ticks % 5 === 0)) { sel = nowSel; ensure(true); }
      else { tickClocks(); ensure(false); } // 页面上没有在走的用时就什么都不改
      if (ticks % 30 === 0 && !hidden()) refreshPanel(); // 面板开着时每 30 秒刷新一次（注入程序也是每 30 秒推一次历史）
    }, 1000);
    render();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
