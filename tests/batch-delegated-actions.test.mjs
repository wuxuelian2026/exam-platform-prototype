import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
function implementation(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = html.slice(start);
  const end = rest.search(/\n    (?:function |var )/);
  assert.ok(end > 0, name);
  return rest.slice(0, end);
}
function fixture(role) {
  const messages = [];
  const context = vm.createContext({
    AUTH_SESSION: { role }, BATCH_FREEZE_STATES: {}, BATCH_DEMO_LIST: [], location: { search: "" }, URLSearchParams,
    batchDemoOrgs: () => ["模拟下级机构"],
    rollbackRole: () => role, roleOrganizationDataScope: () => ({ names: role === "training" ? { 子机构: true } : { 承办单位: true, 子机构: true } }),
    toast: message => messages.push(message), schedulePhaseOf: batch => batch.status
  });
  vm.runInContext(["enrollmentRoleCanManage", "requireEnrollmentManagement", "updateEnrollmentActions", "setEnrollmentPaid", "batchChangeIsFrozen", "scheduleRoleCanWrite", "scheduleManageCanEdit", "scheduleDirectMutationBlocked", "scheduleEntryWritable"].map(implementation).join("\n"), context);
  return { context, messages };
}

test("platform and organizer expose the same enrollment actions for their scoped institutions", () => {
  for (const registration of ["待缴费", "已缴费", "待退款", "已退款", "已取消"]) {
    const rendered = ["platform", "organizer"].map(role => {
      const f = fixture(role), cell = {};
      f.context.updateEnrollmentActions({ dataset: { org: "子机构", registration }, querySelector: () => cell });
      return cell.innerHTML;
    });
    assert.equal(rendered[0], rendered[1], registration);
  }
});

test("enrollment delegation checks organization rather than creator, and denies unknown roles", () => {
  for (const role of ["platform", "organizer", "training", "unknown"]) {
    const { context: c } = fixture(role);
    assert.equal(c.enrollmentRoleCanManage({ dataset: { org: "子机构", creator: "平台" } }), role !== "unknown");
    assert.equal(c.enrollmentRoleCanManage({ dataset: { org: "其他承办的机构" } }), role === "platform");
    assert.equal(c.enrollmentRoleCanManage(null), false);
  }
});

test("generated demo institutions require both a scoped batch and explicit institution membership", () => {
  const { context: c } = fixture("organizer");
  c.BATCH_DEMO_LIST.push({ name: "辖区批次", org: "承办单位" }, { name: "其他批次", org: "其他承办" });
  assert.equal(c.enrollmentRoleCanManage({ dataset: { org: "模拟下级机构", batch: "辖区批次" } }), true);
  assert.equal(c.enrollmentRoleCanManage({ dataset: { org: "外部机构", batch: "辖区批次" } }), false);
  assert.equal(c.enrollmentRoleCanManage({ dataset: { org: "模拟下级机构", batch: "其他批次" } }), false);
});

test("superiors can confirm payment, out-of-scope and frozen rows stay unchanged", () => {
  for (const role of ["platform", "organizer", "training"]) {
    const { context: c } = fixture(role);
    const batch = { id: "payment" };
    Object.assign(c, { batchChangeContext: () => batch, formatDateTime: () => "2026-10-20 12:00", refreshBatchChangeView() {} });
    const row = { dataset: { org: "子机构", registration: "待缴费" }, querySelector: () => null };
    assert.equal(c.setEnrollmentPaid(row), true, role);
    assert.equal(row.dataset.registration, "已缴费");
    c.BATCH_FREEZE_STATES.payment = { status: "已冻结", scope: "报名" };
    row.dataset.registration = "待缴费";
    assert.equal(c.setEnrollmentPaid(row), false);
    assert.equal(row.dataset.registration, "待缴费");
  }
  const { context: c } = fixture("organizer");
  const row = { dataset: { org: "外部机构", registration: "待缴费" } };
  assert.equal(c.setEnrollmentPaid(row), false);
  assert.equal(row.dataset.registration, "待缴费");
});

test("all enrollment mutation handlers enforce row scope, including stale drawers and batch payment", () => {
  for (const name of ["openEnrollmentPaymentConfirm", "openEnrollmentRefundConfirm", "cancelEnrollmentRow", "confirmCancelEnrollment", "requestEnrollmentRefund", "confirmEnrollmentRefundRequest", "confirmEnrollmentRefund"]) {
    assert.match(implementation(name), /requireEnrollmentManagement\(/, name);
  }
  assert.match(implementation("batchConfirmEnrollmentPaid"), /selectedRows\.some.*enrollmentRoleCanManage/);
});

test("platform and organizer share editable scheduling and grouping permissions", () => {
  for (const role of ["platform", "organizer"]) {
    const { context: c } = fixture(role);
    assert.equal(c.scheduleRoleCanWrite(role, "编排中"), true);
    assert.equal(c.scheduleEntryWritable({ id: "s", status: "编排中" }), true);
    for (const status of ["待复核", "已发布", "线上考试"]) assert.equal(c.scheduleRoleCanWrite(role, status), false);
    assert.equal(c.scheduleEntryWritable({ id: "s", status: "已发布" }), false);
    c.BATCH_FREEZE_STATES.s = { status: "已冻结", scope: "排期" };
    assert.equal(c.scheduleEntryWritable({ id: "s", status: "编排中" }), false);
  }
});

test("organizer cannot forge an acting institution through the scheduling URL", () => {
  const { context: c } = fixture("organizer");
  c.location.search = "?scheduleOrg=" + encodeURIComponent("其他承办的机构");
  assert.equal(c.batchChangeIsFrozen({ id: "s" }, "schedule"), true);
  assert.equal(c.scheduleDirectMutationBlocked({ status: "编排中" }), true);
  c.location.search = "?scheduleOrg=" + encodeURIComponent("子机构");
  assert.equal(c.batchChangeIsFrozen({ id: "s" }, "schedule"), false);
});

test("dispatch, tickets and grades have platform/organizer parity; issuance stays platform-only", () => {
  const roleSync = implementation("syncRolePageActions");
  const organizerBranch = roleSync.slice(roleSync.indexOf('      if (role === "organizer") {'));
  assert.doesNotMatch(organizerBranch, /syncRoleActionHidden\('[^']*result-(?:publish|adjust|return)/);
  for (const operation of ["enroll", "schedule", "tickets", "dispatch", "grades", "certificates"]) {
    for (const role of ["platform", "organizer"]) {
      const { context: c } = fixture(role);
      assert.equal(c.batchChangeIsFrozen({ id: "b" }, operation), role === "organizer" && operation === "certificates", `${role}/${operation}`);
      c.BATCH_FREEZE_STATES.b = { status: "已冻结", scope: "全批次" };
      assert.equal(c.batchChangeIsFrozen({ id: "b" }, operation), true);
    }
  }
  const { context: c } = fixture("training");
  for (const operation of ["dispatch", "grades", "certificates"]) assert.equal(c.batchChangeIsFrozen({ id: "b" }, operation), true);
});
