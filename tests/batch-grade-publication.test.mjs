import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
function between(start, end) {
  const index = html.indexOf(start);
  assert.ok(index >= 0, start);
  const stop = html.indexOf(end, index + start.length);
  assert.ok(stop > index, end);
  return html.slice(index, stop);
}
function implementation(name) {
  const marker = `    function ${name}(`;
  const index = html.indexOf(marker);
  assert.ok(index >= 0, marker);
  const rest = html.slice(index);
  const stop = rest.search(/\n    (?:function |var )/);
  assert.ok(stop > 0, name);
  return rest.slice(0, stop);
}
const source = [
  between("    var BATCH_STAGE_ORDER =", "    var BATCH_STAGE_STATUS_BY_LEGACY ="),
  between("    var BATCH_STAGE_DONE_STATUS =", "    function offlineScheduleIsPublished("),
  ...["offlineScheduleIsPublished", "offlineParallelStageStatus", "batchStagePhase", "batchStageStatusView", "autoAdvancePublishedOfflineGrades", "gradeStatusLabel", "gradePublicationState", "publishBatchGrades", "updateResultActions", "applyResultStatus", "applyOnlineGradeStatus", "resultPublishBodyHtml", "normalizeOfflineGradesPanel", "onlineGradesStageView", "uniqueBatchDemoList"].map(implementation)
].join("\n");

function fixture(overrides = {}, role = "platform") {
  const batch = { id: "grade-test", name: "成绩发布测试", stage: "grades", status: "待发布", examMode: "线下考试", scheduled: 3, scorePendingInput: 0, scorePendingConfirm: 3, scorePublished: 0, ...overrides };
  const messages = [], writes = [], routes = [];
  const context = vm.createContext({
    AUTH_SESSION: { role }, BATCH_STAGE_STATUS_BY_LEGACY: {},
    window: { HBYXExamApi: { createRequestId: () => "grade-request", write: (...args) => { writes.push(args); return context.failWrite ? Promise.reject(new Error("failure")) : Promise.resolve(); }, errorState: () => ({ retryable: true }) } },
    document: { querySelector: () => null }, currentBatchContext: () => batch,
    batchChangeIsFrozen: () => !!context.frozen, closeDrawer() {}, renderBatchDemoSelector() {}, syncBatchDemo() {},
    showPage: (...args) => routes.push(args), toast: (message) => messages.push(message), formatDateTime: () => "2026-10-20 12:00:00",
    escapeHtml: (value) => String(value), formatDemoNumber: (value) => String(value || 0), batchTagHtml: (_tag, value) => `<span>${value}</span>`,
    pendingStageView: () => ({ pending: true }), syncStickyTableColumnsAsync() {}, authRoleConfig: () => ({ unit: "测试培训机构" })
  });
  vm.runInContext(source, context);
  return { batch, context, messages, writes, routes, button: { disabled: false } };
}
const onlineRows = () => [
  { name: "甲", grade: "良好", status: "待确认" },
  { name: "乙", grade: "优秀", status: "已确认" },
  { name: "丙", grade: "不合格", status: "已发布" }
];

test("legacy confirmation states share one pending-publication status", () => {
  const f = fixture();
  for (const value of ["待确认", "已确认", "PENDING_REVIEW", "CONFIRMED", "PENDING_PUBLISH", "待发布"]) assert.equal(f.context.gradeStatusLabel(value), "待发布");
  for (const value of ["已发布", "更正中", "已作废"]) assert.equal(f.context.gradeStatusLabel(value), value);
});

test("merging grade statuses preserves both existing demo batch identities", () => {
  const f = fixture();
  const batches = [{ id: "batch-demo-12", stage: "grades", status: "待发布" }, { id: "batch-demo-13", stage: "grades", status: "待发布" }];
  assert.equal(f.context.uniqueBatchDemoList(batches).length, 2);
});

test("offline submitted grades no longer require a separate confirmation", () => {
  for (const status of ["待确认", "已确认", "待发布"]) {
    const f = fixture({ status });
    const state = f.context.gradePublicationState(f.batch);
    assert.equal(state.pendingPublish, 3);
    assert.equal(state.blocked, false);
    assert.equal(f.context.batchStageStatusView(f.batch, "grades").text, "待发布");
    const drawer = f.context.resultPublishBodyHtml();
    assert.match(drawer, /本次待发布/);
    assert.doesNotMatch(drawer, /待确认|已确认|发布已阻断/);
  }
});

test("online publication counts candidates rather than offline scheduled count", () => {
  const f = fixture({ examMode: "线上考试", scheduled: 0, onlineGradeMocks: onlineRows() });
  const state = f.context.gradePublicationState(f.batch);
  assert.equal(state.total, 3);
  assert.equal(state.pendingPublish, 2);
  assert.equal(state.published, 1);
  assert.equal(state.blocked, false);
  const view = f.context.onlineGradesStageView(f.batch, { text: "待发布" }, "platform");
  assert.equal(view.rows[0][3], "良好");
  assert.match(view.rows[0][4], /待发布/);
  assert.match(view.rows[1][4], /待发布/);
});

test("empty, unscored, correction and completed batches cannot publish", async () => {
  for (const overrides of [{ scheduled: 0 }, { status: "待评分" }, { scorePendingInput: 1 }, { status: "更正中" }, { status: "已作废" }, { status: "退回调整" }, { status: "已发布", scorePublished: 3 }, { stage: "dispatch", status: "待指派" }, { stage: "certificates", status: "待生成" }]) {
    const f = fixture(overrides);
    await f.context.publishBatchGrades(f.button);
    assert.equal(f.writes.length, 0, JSON.stringify(overrides));
  }
});

test("online missing ratings and unfinished scoring block publication", async () => {
  for (const row of [{ grade: "待确认", status: "待确认" }, { grade: "-", status: "待发布" }, { grade: "良好", status: "待评分" }, { grade: "优秀", status: "更正中" }]) {
    const f = fixture({ examMode: "线上考试", scheduled: 0, onlineGradeMocks: [row] });
    await f.context.publishBatchGrades(f.button);
    assert.equal(f.writes.length, 0);
  }
});

test("removing confirmation does not grant publication to other roles or frozen batches", async () => {
  for (const role of ["organizer", "training"]) {
    const f = fixture({}, role);
    await f.context.publishBatchGrades(f.button);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  f.context.frozen = true;
  await f.context.publishBatchGrades(f.button);
  assert.equal(f.writes.length, 0);
});

test("offline grades publish directly with audit and progress to certificates", async () => {
  const f = fixture({ status: "待确认", passed: 2 });
  await f.context.publishBatchGrades(f.button);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][1].expectedStatus, "待发布");
  assert.equal(f.batch.scorePublished, 3);
  assert.equal(f.batch.stage, "certificates");
  assert.equal(f.batch.certPending, 2);
  assert.equal(f.context.window.__resultAudit[0].action, "发布成绩");
  assert.equal(f.routes[0][1], "certificates");
});

test("online grades publish directly and persist published candidate statuses", async () => {
  const f = fixture({ examMode: "线上考试", scheduled: 0, onlineGradeMocks: onlineRows() });
  await f.context.publishBatchGrades(f.button);
  assert.equal(f.writes.length, 1);
  assert.ok(f.batch.onlineGradeMocks.every((row) => row.status === "已发布"));
  assert.equal(f.batch.scorePublished, 3);
  assert.equal(f.batch.stage, "certificates");
  assert.equal(f.batch.certPending, 2);
  await f.context.publishBatchGrades(f.button);
  assert.equal(f.writes.length, 1);
});

test("publication failure keeps pending grades intact and enables retry", async () => {
  const f = fixture();
  f.context.failWrite = true;
  await f.context.publishBatchGrades(f.button);
  assert.equal(f.button.disabled, false);
  assert.equal(f.batch.status, "待发布");
  assert.equal(f.batch.scorePublished, 0);
  assert.equal(f.batch.stage, "grades");
  assert.match(f.messages.at(-1), /超时/);
});

test("offline action permissions expose publish only for platform pending grades", () => {
  for (const role of ["platform", "organizer", "training"]) {
    for (const status of ["待发布", "已发布", "更正中", "已作废"]) {
      const f = fixture({}, role);
      const buttons = ["publish", "confirm", "grade-setting", "export"].map((action) => ({ action, getAttribute: () => action }));
      f.context.updateResultActions({ querySelectorAll: () => buttons }, status);
      assert.equal(buttons[0].hidden, !(role === "platform" && status === "待发布"));
      assert.equal(buttons[1].hidden, true);
      assert.equal(buttons[3].hidden, false);
    }
  }
});

test("online filters merge legacy records and hide all write actions after publication", () => {
  for (const role of ["platform", "organizer", "training"]) {
    const f = fixture({}, role);
    const tabs = ["待发布", "已发布", "更正中", "已作废"].map((status) => ({ getAttribute: () => status, classList: { toggle() {} }, setAttribute() {} }));
    const rows = ["待确认", "已确认", "已发布"].map((status) => ({ getAttribute: () => status }));
    const buttons = ["publish", "confirm", "grade-setting", "export"].map((action) => ({ getAttribute: () => action }));
    const root = { querySelectorAll: (selector) => selector === "[data-online-grade-status]" ? tabs : selector === "[data-online-grade-row]" ? rows : buttons };
    f.context.applyOnlineGradeStatus(root, "待发布");
    assert.equal(rows[0].hidden, role === "training");
    assert.equal(rows[1].hidden, role === "training");
    assert.equal(buttons[0].hidden, role !== "platform");
    assert.equal(buttons[1].hidden, true);
    f.context.applyOnlineGradeStatus(root, "已发布");
    assert.equal(buttons[0].hidden, true);
    assert.equal(buttons[2].hidden, true);
    f.batch.stage = "certificates";
    f.context.applyOnlineGradeStatus(root, "待发布");
    assert.equal(buttons[0].hidden, true);
    assert.equal(buttons[2].hidden, true);
  }
});

test("both grade interfaces remove confirmation tabs, actions and drawers", () => {
  const staticGrades = between('        <section class="page" data-page="grades">', '        <section class="page" data-page="certificates">');
  assert.doesNotMatch(staticGrades, /待确认|已确认|result-confirm|result-submit-confirm/);
  assert.equal((staticGrades.match(/data-result-status-tab="待发布"/g) || []).length, 1);
  const online = implementation("renderOnlineStageViewPanel");
  assert.doesNotMatch(online, /待确认|已确认|result-confirm|data-online-grade-action="confirm"/);
  assert.match(online, /data-online-grade-action="publish"/);
  assert.doesNotMatch(html, /"result-confirm": \{|"result-submit-confirm": \{/);
  assert.match(implementation("createBatchDemo"), /status\.stage !== "grades"/);
});
