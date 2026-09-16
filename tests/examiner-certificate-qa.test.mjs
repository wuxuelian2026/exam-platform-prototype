/**
 * QA 独立验收套件：考官证书审核下沉（EXAM-CERT-REVIEW-DOWNSHIFT-20260911）
 *
 * 与 examiner-certificate-contract.test.mjs 互补，本文件不复用其用例，重点覆盖：
 * 状态机边界、分域隔离、驳回/重提口径、有效期时间旅行、JY/T 1002 日期时间规范、
 * 幂等与错误码、跨端联动。所有断言只依赖 current/shared/hbyx-exam-api-client.js。
 *
 * 运行：node tests/examiner-certificate-qa.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, "..", "current", "shared", "hbyx-exam-api-client.js");
const source = fs.readFileSync(clientPath, "utf8");

const results = [];
const notes = [];

function createChannelHub() {
  const instances = [];
  function Channel(name) {
    this.name = name;
    this.onmessage = null;
    instances.push(this);
  }
  Channel.prototype.postMessage = function (data) {
    instances.filter((item) => item !== this && item.name === this.name).forEach((item) => {
      if (typeof item.onmessage === "function") item.onmessage({ data: data });
    });
  };
  return Channel;
}

function createClient(options) {
  const settings = options || {};
  const localStore = settings.localStore || new Map();
  const windowStub = {
    crypto: globalThis.crypto,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Intl: globalThis.Intl,
    URLSearchParams: globalThis.URLSearchParams,
    fetch: () => Promise.reject(new Error("mock mode must not call fetch")),
    localStorage: {
      getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
      setItem: (key, value) => localStore.set(key, String(value)),
      removeItem: (key) => localStore.delete(key)
    }
  };
  if (settings.BroadcastChannel) windowStub.BroadcastChannel = settings.BroadcastChannel;
  windowStub.window = windowStub;
  const documentStub = { createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {} }), querySelector: () => null };
  const context = vm.createContext({ window: windowStub, document: documentStub, console, Intl: globalThis.Intl, Date, Promise, Number, String, Object, Array, Math, JSON, decodeURIComponent, encodeURIComponent });
  vm.runInContext(source, context, { filename: clientPath });
  return windowStub.HBYXExamApi;
}

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, message: error && error.message });
    console.log(`FAIL ${name}\n     ${error && error.message}`);
  }
}

function note(text) {
  notes.push(text);
  console.log(`NOTE ${text}`);
}

async function expectError(promise, code, status) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code, `expected error code ${code}, got ${error.code}`);
    if (status) assert.equal(error.status, status, `expected status ${status}, got ${error.status}`);
    return error;
  }
  throw new Error(`expected ${code} but the request succeeded`);
}

// 业务时区固定 Asia/Shanghai，日期按 JY/T 1002 使用 YYYYMMDD 紧凑格式
function businessToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const fields = {};
  parts.forEach((part) => { if (part.type !== "literal") fields[part.type] = part.value; });
  return fields.year + fields.month + fields.day;
}

function shiftCompactDate(compact, dayDelta) {
  const base = new Date(compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8) + "T00:00:00+08:00");
  base.setUTCDate(base.getUTCDate() + dayDelta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(base).replace(/-/g, "");
}

const api = createClient();
const TODAY = businessToday();
const YESTERDAY = shiftCompactDate(TODAY, -1);
const TOMORROW = shiftCompactDate(TODAY, 1);
const EXAMINER_A = "qa-examiner-A";
const EXAMINER_B = "qa-examiner-B";

function payload(examinerId, number, from, until, extra) {
  return Object.assign({
    examinerId: examinerId,
    certificateNumber: number,
    certificateName: "社会艺术水平考级考官证（钢琴）",
    certificateMajor: "钢琴",
    validFromDate: from,
    validUntilDate: until,
    actorRole: "examiner",
    actorId: examinerId
  }, extra || {});
}

function approve(id, objectVersion, reviewerId) {
  return api.reviewExaminerCertificate(id, {
    decision: "APPROVE",
    actorRole: "platform_admin",
    reviewerId: reviewerId || "qa-platform",
    objectVersion: objectVersion
  });
}

await step("T01 注销申请幂等：同一 requestId 重复提交只产生一条待审核记录", async () => {
  const created = (await api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0001", "20240101", "20291231"))).data;
  const active = (await approve(created.id, created.objectVersion)).data;
  const requestId = api.createRequestId("qa-delete");
  const first = await api.requestExaminerCertificateChange(active.id, { changeType: "DELETE", actorRole: "examiner", actorId: EXAMINER_A, objectVersion: active.objectVersion }, { requestId: requestId });
  const second = await api.requestExaminerCertificateChange(active.id, { changeType: "DELETE", actorRole: "examiner", actorId: EXAMINER_A, objectVersion: active.objectVersion }, { requestId: requestId });
  assert.equal(second.data.examinerCertificateId, first.data.examinerCertificateId, "幂等重复提交应返回首次结果");
  const list = await api.listExaminerCertificates({ examinerId: EXAMINER_A });
  const deleteRows = list.filter((item) => item.changeType === "DELETE");
  assert.equal(deleteRows.length, 1, `expected 1 delete request row, got ${deleteRows.length}`);
});

await step("T02 撤回注销申请后原证书恢复可派遣", async () => {
  const created = (await api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0002", "20240101", "20291231"))).data;
  const active = (await approve(created.id, created.objectVersion)).data;
  const removal = (await api.requestExaminerCertificateChange(active.id, { changeType: "DELETE", actorRole: "examiner", actorId: EXAMINER_A, objectVersion: active.objectVersion })).data;
  const pendingRows = await api.listExaminerCertificates({ examinerId: EXAMINER_A });
  assert.equal(pendingRows.find((item) => item.id === active.id).pendingDelete, true, "注销申请应标记待删除");
  assert.equal(pendingRows.find((item) => item.id === active.id).dispatchEligible, false, "注销审核期间不参与新派遣");
  const withdrawn = (await api.withdrawExaminerCertificate(removal.id, { actorRole: "examiner", actorId: EXAMINER_A, objectVersion: removal.objectVersion })).data;
  assert.equal(withdrawn.reviewStatus, "WITHDRAWN");
  const after = await api.listExaminerCertificates({ examinerId: EXAMINER_A });
  const target = after.find((item) => item.id === active.id);
  assert.equal(target.pendingDelete, false, "撤回后不应残留待删除标记");
  assert.equal(target.dispatchEligible, true, "撤回注销申请后原证书应恢复可派遣");
});

await step("T03 有效期边界：截止日为当天仍可派遣，已过截止日不可派遣", async () => {
  const boundary = (await api.createExaminerCertificate(payload(EXAMINER_B, "QA-KG-0003", YESTERDAY, TODAY))).data;
  const approvedBoundary = (await approve(boundary.id, boundary.objectVersion)).data;
  assert.equal(approvedBoundary.inValidityPeriod, true, "截止日为当天应仍在有效期内");
  assert.equal(approvedBoundary.dispatchEligible, true);

  const expired = (await api.createExaminerCertificate(payload(EXAMINER_B, "QA-KG-0004", "20200101", YESTERDAY))).data;
  const approvedExpired = (await approve(expired.id, expired.objectVersion)).data;
  assert.equal(approvedExpired.inValidityPeriod, false);
  assert.equal(approvedExpired.dispatchEligible, false, "已过截止日的证书不可派遣");
  assert.equal(approvedExpired.validityStatus, "EXPIRED", "审核时已过有效期的证书应标记为已过期");
});

await step("T04 有效期未开始的证书审核通过后为未生效且不可派遣", async () => {
  const future = (await api.createExaminerCertificate(payload("qa-examiner-C", "QA-KG-0005", TOMORROW, "20291231"))).data;
  const approved = (await approve(future.id, future.objectVersion)).data;
  assert.equal(approved.reviewStatus, "APPROVED");
  assert.equal(approved.validityStatus, "NOT_EFFECTIVE", "有效期未开始应为未生效");
  assert.equal(approved.dispatchEligible, false);
  const eligibility = await api.examinerCertificateDispatchEligibility("qa-examiner-C");
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /没有审核通过且在有效期内的证书/);
});

await step("T05 已通过证书不可重复审核", async () => {
  const row = (await api.listExaminerCertificates({ examinerId: EXAMINER_B })).find((item) => item.number === "QA-KG-0003");
  await expectError(approve(row.id, row.objectVersion), "STATUS_NOT_ALLOWED", 409);
  await expectError(api.reviewExaminerCertificate(row.id, { decision: "REJECT", reviewReason: "重复审核", actorRole: "platform_admin", objectVersion: row.objectVersion }), "STATUS_NOT_ALLOWED", 409);
});

await step("T06 平台管理员不能代替考官提交证书变更", async () => {
  const row = (await api.listExaminerCertificates({ examinerId: EXAMINER_B })).find((item) => item.number === "QA-KG-0003");
  await expectError(api.requestExaminerCertificateChange(row.id, { changeType: "UPDATE", certificateName: "平台代改", actorRole: "platform_admin", actorId: "qa-platform", objectVersion: row.objectVersion }), "FORBIDDEN", 403);
});

await step("T07 驳回原因与重新提交口径", async () => {
  const created = (await api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0007", "20240101", "20291231"))).data;
  const rejected = (await api.reviewExaminerCertificate(created.id, { decision: "REJECT", reviewReason: "证书照片不清晰", actorRole: "platform_admin", objectVersion: created.objectVersion })).data;
  assert.equal(rejected.reviewStatus, "REJECTED");
  assert.equal(rejected.reviewReason, "证书照片不清晰");
  await expectError(api.requestExaminerCertificateChange(rejected.id, { changeType: "UPDATE", certificateName: "修改后重提", actorRole: "examiner", actorId: EXAMINER_A, objectVersion: rejected.objectVersion }), "STATUS_NOT_ALLOWED", 409);
  const resubmit = (await api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0007", "20240101", "20291231"))).data;
  assert.equal(resubmit.reviewStatus, "PENDING_REVIEW", "同一编号可重新提交新增申请");
  note("已驳回申请保留历史记录；重新提交时创建新的待审核申请，不回退原审核记录");
});

await step("T08 证书审核契约不包含草稿状态", async () => {
  const contract = api.examinerCertificateContract;
  assert.equal(contract.reviewStatuses.indexOf("DRAFT"), -1, "契约不得声明 DRAFT");
  assert.equal(contract.endpoints.filter((endpoint) => /draft/i.test(endpoint)).length, 0, "契约未提供草稿保存接口");
  const rows = api.readContract().examinerCertificates || [];
  assert.equal(rows.filter((row) => row.certificateReviewStatusCode === "DRAFT").length, 0, "全量证书记录中不应出现 DRAFT");
});

await step("T09 证书编号唯一性按全局判定（跨考官重复编号被拒）", async () => {
  await api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0009", "20240101", "20291231"));
  await expectError(api.createExaminerCertificate(payload(EXAMINER_B, "QA-KG-0009", "20240101", "20291231")), "DUPLICATE_CERTIFICATE_NUMBER", 409);
  note("证书编号唯一性为全局判定，跨考官不可重复；已注销或已撤回后编号可被重新使用");
});

await step("T10 考官证书与考生证书分域隔离", async () => {
  const contract = api.readContract();
  contract.certificates = [{
    certificateId: "candidate-cert-1",
    applicationId: "application-demo",
    certificateNumber: "QA-CAND-0001",
    certificateValidityStatusCode: "REVOKED",
    certificateValidityStatusLabel: "已撤销"
  }];
  api.mergeContract(contract);
  const candidate = api.readContract().certificates[0];
  assert.equal(candidate.certificateValidityStatusCode, "REVOKED");
  const eligibility = await api.examinerCertificateDispatchEligibility(EXAMINER_B);
  assert.equal(eligibility.eligible, true, "考生证书状态不得影响考官派遣资格");
  const examinerRows = api.readContract().examinerCertificates;
  assert.equal(examinerRows.some((row) => row.certificateId === "candidate-cert-1"), false);
  assert.equal(examinerRows.some((row) => row.certificateValidityStatusCode === "REVOKED" && row.rootOrigin === "candidate"), false);
});

await step("T11 替换关系双向可追溯", async () => {
  const created = (await api.createExaminerCertificate(payload("qa-examiner-D", "QA-KG-0011", "20240101", "20271231"))).data;
  const active = (await approve(created.id, created.objectVersion)).data;
  const next = (await api.requestExaminerCertificateChange(active.id, { changeType: "UPDATE", validFromDate: "20240101", validUntilDate: "20301231", actorRole: "examiner", actorId: "qa-examiner-D", objectVersion: active.objectVersion })).data;
  const approvedNext = (await approve(next.id, next.objectVersion)).data;
  const list = await api.listExaminerCertificates({ examinerId: "qa-examiner-D" });
  const previous = list.find((item) => item.id === active.id);
  assert.equal(approvedNext.replacedCertificateId, active.id, "新版本应指向被替换版本");
  assert.equal(previous.replacementCertificateId, approvedNext.id, "旧版本应指向替换它的版本");
  assert.equal(previous.validityStatus, "EXPIRED");
  assert.equal(previous.dispatchEligible, false);
  assert.equal(approvedNext.dispatchEligible, true);
});

await step("T12 注销审核通过后原证书与注销申请行均为已过期", async () => {
  const created = (await api.createExaminerCertificate(payload("qa-examiner-E", "QA-KG-0012", "20240101", "20291231"))).data;
  const active = (await approve(created.id, created.objectVersion)).data;
  const removal = (await api.requestExaminerCertificateChange(active.id, { changeType: "DELETE", actorRole: "examiner", actorId: "qa-examiner-E", objectVersion: active.objectVersion })).data;
  const done = (await approve(removal.id, removal.objectVersion)).data;
  assert.equal(done.reviewStatus, "APPROVED");
  assert.equal(done.validityStatus, "EXPIRED");
  const list = await api.listExaminerCertificates({ examinerId: "qa-examiner-E" });
  assert.equal(list.find((item) => item.id === active.id).validityStatus, "EXPIRED");
  assert.equal(list.every((item) => item.dispatchEligible === false), true);
  const eligibility = await api.examinerCertificateDispatchEligibility("qa-examiner-E");
  assert.equal(eligibility.eligible, false);
});

await step("T13 审计与通知事件覆盖每次证书状态迁移", async () => {
  const contract = api.readContract();
  const audits = contract.auditLogs.filter((item) => item.businessObjectType === "EXAMINER_CERTIFICATE");
  const notifications = contract.notificationEvents.filter((item) => item.businessObjectType === "EXAMINER_CERTIFICATE");
  assert.ok(audits.length >= 20, `expected >=20 auditor entries, got ${audits.length}`);
  assert.ok(notifications.length >= 20, `expected >=20 notification events, got ${notifications.length}`);
  audits.forEach((item) => {
    assert.ok(item.auditId, "审计条目必须有 auditId");
    assert.match(item.operationDate, /^\d{8}$/, "审计日期必须为 YYYYMMDD");
    assert.match(item.operationTime, /^\d{6}$/, "审计时间必须为 hhmmss");
    assert.ok(item.actorRole, "审计条目必须记录操作角色");
  });
  notifications.forEach((item) => {
    assert.equal(item.channel, "IN_APP");
    assert.equal(item.templateVersion, "EXAMINER_CERT_REVIEW_V1");
    assert.ok(item.recipientSnapshot && item.recipientSnapshot.examinerId, "通知事件必须记录接收人快照");
  });
  const certificateIds = new Set((contract.examinerCertificates || []).map((row) => row.examinerCertificateId));
  audits.forEach((item) => assert.ok(certificateIds.has(item.businessObjectId), `审计条目 ${item.auditId} 指向不存在的证书`));
});

await step("T14 日期时间按 JY/T 1002 拆分存储且日期规整为 YYYYMMDD", async () => {
  const created = (await api.createExaminerCertificate(payload("qa-examiner-F", "QA-KG-0014", "2025-01-01", "2027-12-31"))).data;
  assert.equal(created.validFromDate, "20250101");
  assert.equal(created.validUntilDate, "20271231");
  assert.equal(created.startDate, "2025-01-01", "展示层可格式化，但存储层保持紧凑日期");
  assert.match(created.createdDate, /^\d{8}$/);
  assert.match(created.createdTime, /^\d{6}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(created, "createdAt"), false, "不得使用合并的日期时间字段");
  assert.equal(Object.prototype.hasOwnProperty.call(created, "updatedAt"), false, "不得使用合并的日期时间字段");
  assert.ok(created.createdDate.length + created.createdTime.length === 14);
});

await step("T15 错误 requestId 幂等：重复提交返回同一业务错误", async () => {
  await api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0015", "20240101", "20291231"));
  const requestId = api.createRequestId("qa-duplicate");
  const first = await expectError(api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0015", "20240101", "20291231"), { requestId: requestId }), "DUPLICATE_CERTIFICATE_NUMBER", 409);
  const second = await expectError(api.createExaminerCertificate(payload(EXAMINER_A, "QA-KG-0015", "20240101", "20291231"), { requestId: requestId }), "DUPLICATE_CERTIFICATE_NUMBER", 409);
  assert.equal(second.code, first.code);
  const status = await api.requestStatus(requestId);
  assert.equal(status.error, true);
  assert.equal(status.code, "DUPLICATE_CERTIFICATE_NUMBER");
});

await step("T16 越界与非法请求返回明确错误码", async () => {
  await expectError(api.getExaminerCertificate("cert-does-not-exist"), "NOT_FOUND", 404);
  await expectError(api.listExaminerCertificateReviews("cert-does-not-exist"), "NOT_FOUND", 404);
  await expectError(api.examinerCertificateDispatchEligibility("   "), "VALIDATION_ERROR", 400);
  await expectError(api.request("/examiner-certificates", { method: "PUT", body: {} }), "METHOD_NOT_ALLOWED", 405);
});

await step("T17 跨端联动：平台审核结果对考官端即时可见", async () => {
  const created = (await api.createExaminerCertificate(payload("qa-examiner-G", "QA-KG-0017", "20240101", "20291231"))).data;
  const beforeApproval = await api.examinerCertificateDispatchEligibility("qa-examiner-G");
  assert.equal(beforeApproval.eligible, false, "审核前不具备派遣资格");
  await approve(created.id, created.objectVersion);
  const afterApproval = await api.listExaminerCertificates({ examinerId: "qa-examiner-G" });
  assert.equal(afterApproval.length, 1);
  assert.equal(afterApproval[0].reviewStatus, "APPROVED");
  assert.equal(afterApproval[0].dispatchEligible, true);
  const eligibility = await api.examinerCertificateDispatchEligibility("qa-examiner-G");
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.examinerCertificateId, created.id);
});

await step("T18 双端上下文联动：考官端提交、后台端审核、考官端接收广播", async () => {
  const sharedStore = new Map();
  const Hub = createChannelHub();
  const judgeClient = createClient({ localStore: sharedStore, BroadcastChannel: Hub });
  const adminClient = createClient({ localStore: sharedStore, BroadcastChannel: Hub });
  const EXAMINER_G = "qa-examiner-H";
  const received = [];
  judgeClient.onChange((contract) => received.push(contract));

  const submitted = (await judgeClient.createExaminerCertificate(payload(EXAMINER_G, "QA-KG-0018", "20240101", "20291231"))).data;
  assert.equal(submitted.reviewStatus, "PENDING_REVIEW");

  const adminView = await adminClient.listExaminerCertificates({ examinerId: EXAMINER_G });
  assert.equal(adminView.length, 1, "后台端应通过共享存储看到考官端提交的证书");
  assert.equal(adminView[0].reviewStatus, "PENDING_REVIEW");

  const approved = (await adminClient.reviewExaminerCertificate(submitted.id, {
    decision: "APPROVE",
    actorRole: "platform_admin",
    reviewerId: "qa-platform",
    objectVersion: adminView[0].objectVersion
  })).data;
  assert.equal(approved.reviewStatus, "APPROVED");

  const judgeView = await judgeClient.listExaminerCertificates({ examinerId: EXAMINER_G });
  assert.equal(judgeView[0].reviewStatus, "APPROVED", "考官端应收到后台审核结果");
  assert.equal(judgeView[0].dispatchEligible, true);
  assert.ok(received.length > 0, "考官端应通过广播通道收到契约更新");
  const lastContract = received[received.length - 1];
  const broadcastRow = (lastContract.examinerCertificates || []).find((row) => row.examinerCertificateId === submitted.id);
  assert.ok(broadcastRow, "广播契约应包含该证书记录");
  assert.equal(broadcastRow.certificateReviewStatusCode, "APPROVED");
});

await step("T19 撤回后的注销申请行字段语义探针", async () => {
  const created = (await api.createExaminerCertificate(payload("qa-examiner-I", "QA-KG-0019", "20240101", "20291231"))).data;
  const active = (await approve(created.id, created.objectVersion)).data;
  const removal = (await api.requestExaminerCertificateChange(active.id, { changeType: "DELETE", actorRole: "examiner", actorId: "qa-examiner-I", objectVersion: active.objectVersion })).data;
  const withdrawn = (await api.withdrawExaminerCertificate(removal.id, { actorRole: "examiner", actorId: "qa-examiner-I", objectVersion: removal.objectVersion })).data;
  assert.equal(withdrawn.reviewStatus, "WITHDRAWN");
  // 已撤销的注销申请行不参与派遣，原有效证书恢复可派遣
  note("已撤销的注销申请行保留 certificateValidityStatusCode=" + withdrawn.validityStatus
    + "，列表展示为“未生效 / 已撤销”，原有效证书继续有效");
});

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} QA checks passed`);
if (notes.length) console.log(`observations:\n- ${notes.join("\n- ")}`);
if (failed.length) {
  console.log("failed checks: " + failed.map((item) => item.name).join(", "));
  process.exit(1);
}
