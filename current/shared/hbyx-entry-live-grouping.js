/* 现场编组（按到场顺序出号）数据层
 * 后台保存编组方案与号段，发号端读取并出号，后台回显进度。
 * 跨页面 / 跨标签页通过 storage 事件同步。
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "hbyx_entry_live_grouping_v1";
  var EVENT_NAME = "hbyx-entry-live-grouping-change";

  function read() {
    try {
      var parsed = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function write(plans) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    } catch (error) { /* 存储不可用时退化为内存态 */ }
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { plans: plans } }));
    } catch (error) { /* noop */ }
    return plans;
  }

  function keyOf(batchId, sessionId) {
    return String(batchId || "") + "::" + String(sessionId || "");
  }

  function plans() {
    return read();
  }

  function planOf(batchId, sessionId) {
    var key = keyOf(batchId, sessionId);
    return read().find(function (plan) { return keyOf(plan.batchId, plan.sessionId) === key; }) || null;
  }

  /* 后台保存方案：已产生的发号流水不允许被后台覆盖（号码一经发出不重排） */
  function savePlan(input) {
    if (!input || !input.batchId || !input.sessionId) return null;
    var all = read();
    var key = keyOf(input.batchId, input.sessionId);
    var index = -1;
    all.forEach(function (plan, i) { if (keyOf(plan.batchId, plan.sessionId) === key) index = i; });
    var previous = index > -1 ? all[index] : null;
    var plan = {
      batchId: String(input.batchId),
      sessionId: String(input.sessionId),
      batchName: input.batchName || (previous && previous.batchName) || "",
      sessionLabel: input.sessionLabel || (previous && previous.sessionLabel) || "",
      mode: "live",
      perOrgN: input.perOrgN || (previous && previous.perOrgN) || {},
      issuers: input.issuers || (previous && previous.issuers) || [],
      candidates: input.candidates || (previous && previous.candidates) || [],
      issued: previous && Array.isArray(previous.issued) ? previous.issued : [],
      updatedAt: new Date().toISOString()
    };
    if (index > -1) all[index] = plan; else all.push(plan);
    write(all);
    return plan;
  }

  function nOf(plan, org) {
    var value = Number((plan && plan.perOrgN ? plan.perOrgN[org] : 0) || 10);
    if (!isFinite(value)) value = 10;
    return Math.max(1, Math.min(30, Math.round(value)));
  }

  function segments(plan) {
    var orgs = [];
    (plan.candidates || []).forEach(function (candidate) {
      var org = candidate.org || "未标注机构";
      if (orgs.indexOf(org) < 0) orgs.push(org);
    });
    var cursor = 1, stackCursor = 0;
    return orgs.map(function (org) {
      var total = (plan.candidates || []).filter(function (candidate) { return (candidate.org || "未标注机构") === org; }).length;
      var n = nOf(plan, org);
      var groupCount = n <= 1 ? total : Math.ceil(total / n);
      var cards = n <= 1 ? 0 : total;
      var segment = {
        org: org, n: n, total: total, groupCount: groupCount,
        fromGroup: cursor, toGroup: cursor + Math.max(groupCount, 1) - 1,
        stackFrom: stackCursor + 1, stackTo: stackCursor + cards
      };
      cursor += Math.max(groupCount, 1);
      stackCursor += cards;
      return segment;
    });
  }

  /* 号码按「到场顺序」分配：used 含撤回记录，撤回的号作废且不复用 */
  function nextSlot(plan, candidate) {
    var org = (candidate && candidate.org) || "未标注机构";
    var segment = segments(plan).find(function (item) { return item.org === org; });
    if (!segment) return null;
    var used = (plan.issued || []).filter(function (entry) { return entry.org === org; }).length;
    if (segment.n <= 1) {
      return { single: true, org: org, group: Math.min(segment.toGroup, segment.fromGroup + used), no: 1, stackIndex: 0 };
    }
    return {
      single: false, org: org,
      group: Math.min(segment.toGroup, segment.fromGroup + Math.floor(used / segment.n)),
      no: used % segment.n + 1,
      stackIndex: segment.stackFrom + used
    };
  }

  function codeText(entry) {
    if (!entry) return "-";
    return entry.single ? "第" + entry.group + "组 · 单人" : "第" + entry.group + "组-" + entry.no + "号";
  }

  function activeIssued(plan) {
    return (plan.issued || []).filter(function (entry) { return entry.status !== "已撤回"; });
  }

  /* 发号员使用授权手机号 + 短信验证码登录：此处只校验手机号是否在授权名单内，
   * 验证码由登录端按短信校验规则核对，后台只维护授权手机号与授权状态。 */
  function authenticate(phone) {
    var normalizedPhone = String(phone || "").replace(/\s|-/g, "");
    var found = null;
    read().forEach(function (plan) {
      if (found) return;
      (plan.issuers || []).forEach(function (issuer) {
        if (found) return;
        if (issuer.status !== "已授权") return;
        if (String(issuer.loginPhone || "").replace(/\s|-/g, "") !== normalizedPhone) return;
        found = { plan: plan, issuer: issuer };
      });
    });
    return found;
  }

  function issue(batchId, sessionId, issuer, candidateId) {
    var all = read();
    var key = keyOf(batchId, sessionId);
    var plan = all.find(function (item) { return keyOf(item.batchId, item.sessionId) === key; });
    if (!plan) return { error: "场次编组方案未发布，请联系考点考务" };
    if (!issuer || issuer.status !== "已授权") return { error: "发号员授权已失效" };
    var candidate = (plan.candidates || []).find(function (item) { return item.id === candidateId; });
    if (!candidate) return { error: "未找到该考生，请核对报名编号" };
    var duplicate = (plan.issued || []).some(function (entry) { return entry.candidateId === candidateId && entry.status !== "已撤回"; });
    if (duplicate) return { error: "该考生已发号，号码不可重复领取" };
    var slot = nextSlot(plan, candidate);
    if (!slot) return { error: "未找到该考生所属机构的号段" };
    var entry = {
      candidateId: candidate.id, code: candidate.code || candidate.id, name: candidate.name,
      org: slot.org, single: slot.single, group: slot.group, no: slot.no,
      stackIndex: slot.stackIndex, status: "已发号",
      at: new Date().toTimeString().slice(0, 8),
      by: issuer.name || "发号员"
    };
    plan.issued = (plan.issued || []).concat([entry]);
    plan.updatedAt = new Date().toISOString();
    write(all);
    return { entry: entry, plan: plan };
  }

  function revoke(batchId, sessionId, candidateId) {
    var all = read();
    var key = keyOf(batchId, sessionId);
    var plan = all.find(function (item) { return keyOf(item.batchId, item.sessionId) === key; });
    if (!plan) return { error: "场次编组方案不存在" };
    var target = null;
    (plan.issued || []).forEach(function (entry) {
      if (entry.candidateId === candidateId && entry.status === "已发号") target = entry;
    });
    if (!target) return { error: "该号已不可撤回" };
    target.status = "已撤回";
    target.revokedAt = new Date().toTimeString().slice(0, 8);
    plan.updatedAt = new Date().toISOString();
    write(all);
    return { entry: target, plan: plan };
  }

  function ticketOf(plan, candidateKey) {
    if (!plan || !candidateKey) return null;
    var key = String(candidateKey).trim();
    var hit = activeIssued(plan).find(function (entry) {
      return entry.candidateId === key || entry.code === key || entry.name === key;
    });
    return hit || null;
  }

  function subscribe(handler) {
    function onChange(event) {
      try { handler(read(), event); } catch (error) { /* noop */ }
    }
    global.addEventListener("storage", function (event) {
      if (event.key === STORAGE_KEY || event.key === null) onChange(event);
    });
    global.addEventListener(EVENT_NAME, onChange);
    return function () { global.removeEventListener(EVENT_NAME, onChange); };
  }

  global.HBYXEntryLiveGrouping = {
    storageKey: STORAGE_KEY,
    eventName: EVENT_NAME,
    plans: plans,
    planOf: planOf,
    savePlan: savePlan,
    segments: segments,
    nextSlot: nextSlot,
    codeText: codeText,
    activeIssued: activeIssued,
    authenticate: authenticate,
    issue: issue,
    revoke: revoke,
    ticketOf: ticketOf,
    subscribe: subscribe
  };
})(window);
