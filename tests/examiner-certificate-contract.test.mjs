import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, "..", "current", "shared", "hbyx-exam-api-client.js");
const source = fs.readFileSync(clientPath, "utf8");

const results = [];

function createClient() {
  const localStore = new Map();
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

const api = createClient();
const EXAMINER = "judge-contract-001";
const BASE_REQUEST = { examinerId: EXAMINER, certificateMajor: "钢琴", actorRole: "examiner", validFromDate: "20250101", validUntilDate: "20271231" };

await step("契约声明包含 7 个接口与分域状态", async () => {
  const contract = api.examinerCertificateContract;
  assert.equal(contract.endpoints.length, 7);
  assert.equal(contract.reviewDomain, "examinerCertificateReview");
  assert.equal(contract.validityDomain, "examinerCertificateValidity");
  assert.deepEqual(Array.from(contract.reviewStatuses), ["PENDING_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"]);
  assert.deepEqual(Array.from(contract.validityStatuses), ["NOT_EFFECTIVE", "EFFECTIVE", "EXPIRED"]);
});

let created;
await step("新增证书进入待审核且不产生派遣资格", async () => {
  const response = await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9001", certificateName: "社会艺术水平考级考官证（钢琴）" });
  created = response.data;
  assert.equal(created.reviewStatus, "PENDING_REVIEW");
  assert.equal(created.validityStatus, "NOT_EFFECTIVE");
  assert.equal(created.changeType, "CREATE");
  assert.equal(created.objectVersion, 1);
  assert.equal(created.dispatchEligible, false);
  assert.ok(created.auditEventIds.length === 1);
  assert.ok(created.notificationEventIds.length === 1);
  const eligibility = await api.examinerCertificateDispatchEligibility(EXAMINER);
  assert.equal(eligibility.eligible, false);
});

await step("新增必填校验与编号唯一性", async () => {
  await expectError(api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "", certificateName: "无编号" }), "VALIDATION_ERROR", 400);
  await expectError(api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9001", certificateName: "重复编号" }), "DUPLICATE_CERTIFICATE_NUMBER", 409);
  await expectError(api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9002", certificateName: "倒置日期", validFromDate: "20270101", validUntilDate: "20260101" }), "VALIDATION_ERROR", 400);
});

await step("平台审核通过后证书生效并可派遣", async () => {
  const approved = await api.reviewExaminerCertificate(created.id, { decision: "APPROVE", actorRole: "platform_admin", reviewerId: "platform-001", objectVersion: created.objectVersion });
  assert.equal(approved.data.reviewStatus, "APPROVED");
  assert.equal(approved.data.validityStatus, "EFFECTIVE");
  assert.equal(approved.data.dispatchEligible, true);
  assert.equal(approved.data.objectVersion, 2);
  const eligibility = await api.examinerCertificateDispatchEligibility(EXAMINER);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.examinerCertificateId, created.id);
});

await step("同一 requestId 重复提交返回首次结果", async () => {
  const requestId = api.createRequestId("idem");
  const first = await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9101", certificateName: "幂等证书" }, { requestId });
  const second = await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9101", certificateName: "幂等证书" }, { requestId });
  assert.equal(second.data.examinerCertificateId, first.data.examinerCertificateId);
  const status = await api.requestStatus(requestId);
  assert.equal(status.data.examinerCertificateId, first.data.examinerCertificateId);
  const list = await api.listExaminerCertificates({ examinerId: EXAMINER });
  assert.equal(list.filter((item) => item.number === "HB-KG-2026-9101").length, 1);
});

await step("错误角色不能新增、撤回或审核", async () => {
  await expectError(api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9201", certificateName: "越权证书", actorRole: "candidate" }), "FORBIDDEN", 403);
  await expectError(api.withdrawExaminerCertificate(created.id, { actorRole: "platform_admin", objectVersion: 2 }), "FORBIDDEN", 403);
  await expectError(api.reviewExaminerCertificate(created.id, { decision: "APPROVE", actorRole: "examiner", objectVersion: 2 }), "FORBIDDEN", 403);
});

await step("驳回需要原因，驳回后原状态不变且可重新提交", async () => {
  const pending = (await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9301", certificateName: "待驳回证书" })).data;
  await expectError(api.reviewExaminerCertificate(pending.id, { decision: "REJECT", actorRole: "platform_admin", objectVersion: pending.objectVersion }), "VALIDATION_ERROR", 400);
  const rejected = (await api.reviewExaminerCertificate(pending.id, { decision: "REJECT", reviewReason: "证书照片不清晰", actorRole: "platform_admin", objectVersion: pending.objectVersion })).data;
  assert.equal(rejected.reviewStatus, "REJECTED");
  assert.equal(rejected.reviewReason, "证书照片不清晰");
  assert.equal(rejected.dispatchEligible, false);
  const reviews = await api.listExaminerCertificateReviews(pending.id);
  assert.equal(reviews.reviewHistory.length, 1);
  assert.equal(reviews.reviewHistory[0].decision, "REJECTED");
});

await step("审核使用旧 objectVersion 返回版本冲突", async () => {
  const pending = (await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9401", certificateName: "并发证书" })).data;
  const error = await expectError(api.reviewExaminerCertificate(pending.id, { decision: "APPROVE", actorRole: "platform_admin", objectVersion: 99 }), "VERSION_CONFLICT", 409);
  assert.equal(error.currentVersion, 1);
  assert.equal(error.currentStatus, "PENDING_REVIEW");
});

await step("考官可撤回未决申请，新增申请撤回后不生效", async () => {
  const pending = (await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9501", certificateName: "待撤回证书" })).data;
  const withdrawn = (await api.withdrawExaminerCertificate(pending.id, { actorRole: "examiner", actorId: EXAMINER, objectVersion: pending.objectVersion })).data;
  assert.equal(withdrawn.reviewStatus, "WITHDRAWN");
  assert.equal(withdrawn.validityStatus, "NOT_EFFECTIVE");
  await expectError(api.withdrawExaminerCertificate(pending.id, { actorRole: "examiner", objectVersion: withdrawn.objectVersion }), "STATUS_NOT_ALLOWED", 409);
});

let updated;
await step("编辑证书生成新版本，审核前旧证书仍有效", async () => {
  updated = (await api.requestExaminerCertificateChange(created.id, { changeType: "UPDATE", certificateName: "社会艺术水平考级考官证（钢琴）续期", validFromDate: "20250101", validUntilDate: "20291231", actorRole: "examiner", objectVersion: 2 })).data;
  assert.equal(updated.changeType, "UPDATE");
  assert.equal(updated.reviewStatus, "PENDING_REVIEW");
  assert.equal(updated.replacedCertificateId, created.id);
  const list = await api.listExaminerCertificates({ examinerId: EXAMINER });
  const original = list.find((item) => item.id === created.id);
  assert.equal(original.validityStatus, "EFFECTIVE");
  assert.equal(original.dispatchEligible, true);
  assert.equal(updated.dispatchEligible, false);
  await expectError(api.requestExaminerCertificateChange(created.id, { changeType: "DELETE", actorRole: "examiner", objectVersion: 2 }), "CHANGE_REQUEST_EXISTS", 409);
});

await step("编辑审核通过后新版本生效且旧版本被替换", async () => {
  const approved = (await api.reviewExaminerCertificate(updated.id, { decision: "APPROVE", actorRole: "platform_admin", objectVersion: updated.objectVersion })).data;
  assert.equal(approved.validityStatus, "EFFECTIVE");
  assert.equal(approved.dispatchEligible, true);
  const list = await api.listExaminerCertificates({ examinerId: EXAMINER });
  const original = list.find((item) => item.id === created.id);
  assert.equal(original.validityStatus, "EXPIRED");
  assert.equal(original.replacementCertificateId, updated.id);
  assert.equal(original.dispatchEligible, false);
});

await step("撤回编辑申请后原证书保持有效", async () => {
  const pending = (await api.requestExaminerCertificateChange(updated.id, { changeType: "UPDATE", certificateName: "再次续期", validFromDate: "20250101", validUntilDate: "20301231", actorRole: "examiner", objectVersion: 2 })).data;
  const withdrawn = (await api.withdrawExaminerCertificate(pending.id, { actorRole: "examiner", objectVersion: pending.objectVersion })).data;
  assert.equal(withdrawn.reviewStatus, "WITHDRAWN");
  const eligibility = await api.examinerCertificateDispatchEligibility(EXAMINER);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.examinerCertificateId, updated.id);
});

await step("注销申请审核期间不参与新派遣，已通过任务不受影响", async () => {
  const removal = (await api.requestExaminerCertificateChange(updated.id, { changeType: "DELETE", actorRole: "examiner", objectVersion: 2 })).data;
  assert.equal(removal.changeType, "DELETE");
  const list = await api.listExaminerCertificates({ examinerId: EXAMINER });
  const target = list.find((item) => item.id === updated.id);
  assert.equal(target.validityStatus, "EFFECTIVE");
  assert.equal(target.pendingDelete, true);
  assert.equal(target.dispatchEligible, false);
  const eligibility = await api.examinerCertificateDispatchEligibility(EXAMINER);
  assert.equal(eligibility.eligible, false);
  const approved = (await api.reviewExaminerCertificate(removal.id, { decision: "APPROVE", actorRole: "platform_admin", objectVersion: removal.objectVersion })).data;
  assert.equal(approved.reviewStatus, "APPROVED");
  assert.equal(approved.validityStatus, "EXPIRED");
  const afterList = await api.listExaminerCertificates({ examinerId: EXAMINER });
  assert.equal(afterList.find((item) => item.id === updated.id).validityStatus, "EXPIRED");
});

await step("注销被驳回后原证书恢复可派遣", async () => {
  const target = (await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9601", certificateName: "待注销证书" })).data;
  const active = (await api.reviewExaminerCertificate(target.id, { decision: "APPROVE", actorRole: "platform_admin", objectVersion: target.objectVersion })).data;
  const removal = (await api.requestExaminerCertificateChange(active.id, { changeType: "DELETE", actorRole: "examiner", objectVersion: active.objectVersion })).data;
  await api.reviewExaminerCertificate(removal.id, { decision: "REJECT", reviewReason: "该考官证书仍在有效期内", actorRole: "platform_admin", objectVersion: removal.objectVersion });
  const list = await api.listExaminerCertificates({ examinerId: EXAMINER });
  const restored = list.find((item) => item.id === active.id);
  assert.equal(restored.validityStatus, "EFFECTIVE");
  assert.equal(restored.dispatchEligible, true);
});

await step("审核与撤回写入审计和通知事件", async () => {
  const contract = api.readContract();
  assert.ok(contract.auditLogs.length >= 8, "expected audit logs");
  assert.ok(contract.notificationEvents.length >= 8, "expected notification events");
  const audit = contract.auditLogs.find((item) => item.action === "CERTIFICATE_REJECTED");
  assert.ok(audit, "expected rejection audit entry");
  assert.equal(audit.actorRole, "platform_admin");
  const notify = contract.notificationEvents.find((item) => item.eventType === "EXAMINER_CERTIFICATE_APPROVED");
  assert.ok(notify, "expected approval notification");
  assert.equal(notify.channel, "IN_APP");
  assert.equal(notify.status, "PENDING");
  assert.equal(notify.templateVersion, "EXAMINER_CERT_REVIEW_V1");
});

await step("不存在的证书与非法状态返回明确错误码", async () => {
  await expectError(api.getExaminerCertificate("cert-missing"), "NOT_FOUND", 404);
  const pending = (await api.createExaminerCertificate({ ...BASE_REQUEST, certificateNumber: "HB-KG-2026-9701", certificateName: "未通过证书" })).data;
  await expectError(api.requestExaminerCertificateChange(pending.id, { changeType: "UPDATE", actorRole: "examiner", objectVersion: pending.objectVersion, certificateName: "改名字" }), "STATUS_NOT_ALLOWED", 409);
  await expectError(api.requestExaminerCertificateChange(created.id, { changeType: "RENAME", actorRole: "examiner", objectVersion: 1 }), "VALIDATION_ERROR", 400);
});

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed checks: " + failed.map((item) => item.name).join(", "));
  process.exit(1);
}
