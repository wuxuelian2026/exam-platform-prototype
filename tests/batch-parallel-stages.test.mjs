import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
function between(start, end, last = false) {
  const index = last ? html.lastIndexOf(start) : html.indexOf(start);
  assert.ok(index >= 0, start);
  const endIndex = html.indexOf(end, index);
  assert.ok(endIndex > index, end);
  return html.slice(index, endIndex);
}
const source = [
  between("    var BATCH_STAGE_ORDER =", "    var BATCH_STAGE_STATUS_BY_LEGACY ="),
  between("    function autoAdvancePublishedOfflineSchedule(", "    function autoAdvancePublishedOfflineGrades("),
  between("    function syncBatchFlowSummaries(", "    function batchCityName("),
  between("    function ticketCandidateRows(", "    function ticketStateTagHtml("),
  between("    function createTicketGenerationTask(", "    function createTicketDownloadTask("),
  between("    function syncBatchDemo(", "    function batchTagHtml("),
  between("    function publishDispatchAssignmentRows(", "    function tagHtml("),
  between("    function confirmJudgeDispatchDrawer(", "    function confirmSchedulePublish("),
  between("    function confirmSchedulePublish(", "    var PAGINATION_DEFAULT_SIZE =", true)
].join("\n");

function fixture(overrides = {}, role = "organizer") {
  const batch = { id: "parallel-test", name: "并行阶段测试", stage: "schedule", status: "待复核", examMode: "线下考试", scheduled: 4, sessions: 1, pendingSchedule: 0, conflicts: 0, ticketAvailable: 0, ticketsGenerated: 0, ticketsRegenerate: 0, ...overrides };
  const messages = [], writes = [], summaries = {}, steps = [];
  const rows = Array.from({ length: 3 }, (_, index) => {
    const attributes = { "data-ticket-status": "待生成", "data-ticket-id": `ticket-${index}` };
    const checkbox = { checked: false };
    return { cells: Array.from({ length: 9 }, () => ({})), getAttribute: (name) => attributes[name] || "", setAttribute: (name, value) => { attributes[name] = value; }, querySelector: (selector) => selector === "[data-ticket-check]" ? checkbox : {} };
  });
  const panel = { querySelector: () => null, querySelectorAll: (selector) => selector.includes("[data-ticket-row]") ? rows : [] };
  const button = { disabled: false, textContent: "发布", getAttribute: () => "", hasAttribute: () => false, closest: () => panel };
  const context = vm.createContext({
    AUTH_SESSION: { role }, window: { __schedulePublishMode: "publish", HBYXExamApi: { createRequestId: () => "request-test", write: (...args) => { writes.push(args); return context.failWrite ? Promise.reject(new Error("failed")) : Promise.resolve(); }, errorState: () => ({}) } },
    document: { querySelector: () => null, querySelectorAll(selector) { if (selector === "[data-flow-step]") return steps; const key = selector.match(/data-flow-summary="([^"]+)"/); return key ? [summaries[key[1]] ||= {}] : []; } },
    currentBatchContext: () => batch, currentBatchDemoId: batch.id,
    BATCH_STAGE_STATUS_BY_LEGACY: {},
    formatDemoNumber: (value) => String(value || 0), padDemoNumber: (value) => String(value).padStart(2, "0"), batchDemoOrgs: () => ["测试机构"],
    schedulePhaseOf: (item) => item.schedulePhaseStatus || item.status,
    scheduleRoleCanWrite: (name, phase) => ["platform", "organizer", "training"].includes(name) && phase === "编排中",
    scheduleStepState: () => ({ done: [true] }),
    scheduleEntryBatchErrors: () => [],
    batchChangeIsFrozen: () => false, closeDrawer() {}, showPage() {},
    syncBatchMetric() {}, syncBatchStageVisibility() {}, renderBatchWorkbenchState() {}, setBatchTag() {},
    appendBatchChangeRecord() {}, refreshBatchChangeView() {}, resourceAudit() {}, formatDateTime: () => "2026-10-20 12:00:00",
    batchSessionSuffix: () => "01", batchTagHtml: (_tag, value) => value, ticketStateTagHtml: (value) => value, escapeHtml: (value) => String(value), updateTicketSummary() {},
    drawerBody: { querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: (callback) => callback(), toast: (message) => messages.push(message)
  });
  vm.runInContext(source, context);
  for (const stage of context.BATCH_STAGE_ORDER) {
    const classes = new Map();
    steps.push({ dataset: {}, classes, getAttribute: () => stage, classList: { toggle: (name, active) => classes.set(name, active) } });
  }
  return { batch, context, messages, writes, summaries, steps, button, panel };
}
const phase = (f, stage) => f.context.batchStagePhase(f.batch, stage);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("offline dispatch and tickets remain locked until scheduling is published", () => {
  for (const status of ["待排期", "编排中", "待复核"]) {
    const f = fixture({ status });
    assert.equal(phase(f, "dispatch"), "pending");
    assert.equal(phase(f, "tickets"), "pending");
  }
});

test("schedule publication opens both stages and populates ticket capacity", () => {
  const f = fixture();
  f.context.confirmSchedulePublish();
  assert.equal(f.batch.schedulePhaseStatus, "已发布");
  assert.equal(phase(f, "schedule"), "done");
  assert.equal(phase(f, "dispatch"), "current");
  assert.equal(phase(f, "tickets"), "current");
  assert.equal(phase(f, "grades"), "pending");
  assert.equal(f.batch.ticketAvailable, f.batch.scheduled);
  assert.equal(f.summaries.dispatch.textContent, "待指派");
  assert.equal(f.summaries.tickets.textContent, "待生成");
  for (const stage of ["dispatch", "tickets"]) {
    const step = f.steps.find((item) => item.getAttribute() === stage);
    assert.equal(step.classes.get("is-pending"), false);
    assert.equal(step.classes.get("is-done"), false);
  }
});

test("submitting a schedule does not open either downstream stage", () => {
  const f = fixture({ status: "编排中" }, "training");
  f.context.window.__schedulePublishMode = "submit";
  f.context.confirmSchedulePublish();
  assert.equal(f.batch.schedulePhaseStatus, "待复核");
  assert.equal(phase(f, "dispatch"), "pending");
  assert.equal(phase(f, "tickets"), "pending");
});

test("publication preserves role and final-validation restrictions", () => {
  for (const role of ["platform", "organizer"]) {
    const f = fixture({}, role);
    f.context.confirmSchedulePublish();
    assert.equal(f.batch.stage, "dispatch");
  }
  for (const role of ["training"]) {
    const f = fixture({}, role);
    f.context.confirmSchedulePublish();
    assert.equal(f.batch.stage, "schedule");
  }
  for (const overrides of [{ conflicts: 1 }, { pendingSchedule: 1 }]) {
    const f = fixture(overrides);
    f.context.confirmSchedulePublish();
    assert.equal(phase(f, "tickets"), "pending");
  }
});

test("legacy published schedules also open both stages without inventing generated tickets", () => {
  const f = fixture({ status: "已发布" });
  assert.equal(f.context.autoAdvancePublishedOfflineSchedule(f.batch), true);
  assert.equal(phase(f, "dispatch"), "current");
  assert.equal(phase(f, "tickets"), "current");
  assert.ok(Array.from(f.context.ticketCandidateRows(f.batch)).every((row) => row.status === "待生成" && row.ticketNo === "-"));
});

test("ticket generation before assignment does not overwrite dispatch status", async () => {
  const f = fixture();
  f.context.confirmSchedulePublish();
  f.context.createTicketGenerationTask(f.button);
  await settle();
  assert.equal(f.batch.ticketsGenerated, 4);
  assert.equal(f.batch.ticketPhaseStatus, "生成后");
  assert.equal(f.batch.status, "待指派");
  assert.equal(f.batch.dispatchPhaseStatus, "待指派");
  assert.equal(phase(f, "dispatch"), "current");
  assert.equal(phase(f, "tickets"), "current");
  assert.equal(f.writes.length, 1);
});

test("publishing tickets first leaves dispatch open and assignment preserves ticket publication", async () => {
  const f = fixture();
  f.context.confirmSchedulePublish();
  f.batch.ticketsGenerated = 4;
  await f.context.publishBatchTickets(f.button);
  assert.equal(phase(f, "tickets"), "done");
  assert.equal(phase(f, "dispatch"), "current");
  f.context.confirmJudgeDispatchDrawer(true);
  assert.equal(f.batch.dispatchPhaseStatus, "已指派");
  assert.equal(f.batch.ticketPhaseStatus, "已开放下载");
  assert.equal(f.summaries.tickets.textContent, "已开放下载");
});

test("publishing dispatch first leaves tickets open and ticket generation preserves dispatch publication", async () => {
  const f = fixture();
  f.context.confirmSchedulePublish();
  f.button.closest = () => ({ querySelectorAll: () => [] });
  f.context.publishDispatchAssignmentRows(f.button);
  assert.equal(phase(f, "dispatch"), "done");
  assert.equal(phase(f, "tickets"), "current");
  f.button.closest = () => f.panel;
  f.context.createTicketGenerationTask(f.button);
  await settle();
  assert.equal(f.batch.dispatchPhaseStatus, "已发布");
  assert.equal(f.batch.status, "已发布");
  await f.context.publishBatchTickets(f.button);
  assert.equal(phase(f, "dispatch"), "done");
  assert.equal(phase(f, "tickets"), "done");
  assert.equal(phase(f, "grades"), "pending");
});

test("empty, partial or regeneration-pending ticket sets cannot be published", () => {
  for (const overrides of [{ scheduled: 0 }, { ticketsGenerated: 0 }, { ticketsGenerated: 2 }, { ticketsGenerated: 4, ticketsRegenerate: 1 }]) {
    const f = fixture({ stage: "dispatch", status: "待指派", schedulePhaseStatus: "已发布", ticketAvailable: 4, ...overrides });
    f.context.syncBatchDemo(f.batch);
    f.context.publishBatchTickets(f.button);
    assert.equal(f.writes.length, 0);
    assert.notEqual(f.batch.ticketPhaseStatus, "已开放下载");
  }
});

test("failed ticket publication leaves both phases unchanged and is retryable", async () => {
  const f = fixture({ stage: "dispatch", status: "待指派", schedulePhaseStatus: "已发布", ticketAvailable: 4, ticketsGenerated: 4 });
  f.context.failWrite = true;
  await f.context.publishBatchTickets(f.button);
  assert.equal(phase(f, "tickets"), "current");
  assert.equal(phase(f, "dispatch"), "current");
  assert.equal(f.button.disabled, false);
});

test("revoking schedule publication relocks both downstream stages", () => {
  const f = fixture({ stage: "dispatch", status: "待指派", schedulePhaseStatus: "待复核" });
  assert.equal(phase(f, "dispatch"), "pending");
  assert.equal(phase(f, "tickets"), "pending");
  f.context.createTicketGenerationTask(f.button);
  f.context.publishBatchTickets(f.button);
  assert.equal(f.writes.length, 0);
});

test("legacy completed offline stages retain read-only history", () => {
  const f = fixture({ stage: "grades", status: "待确认", ticketsGenerated: 4, ticketAvailable: 4 });
  assert.equal(phase(f, "dispatch"), "done");
  assert.equal(phase(f, "tickets"), "done");
  assert.equal(f.context.batchStageStatusView(f.batch, "tickets").text, "已开放下载");
});

test("online recording and dispatch retain their original sequential flow", () => {
  for (const [stage, status, recording, dispatch] of [
    ["enroll", "报名中", "pending", "pending"],
    ["tickets", "视频录制中", "current", "pending"],
    ["tickets", "视频已录制", "done", "current"],
    ["dispatch", "待指派", "done", "current"],
    ["grades", "待确认", "done", "done"]
  ]) {
    const f = fixture({ examMode: "线上考试", stage, status, schedulePhaseStatus: "已发布" });
    assert.equal(phase(f, "schedule"), "not-applicable");
    assert.equal(phase(f, "tickets"), recording);
    assert.equal(phase(f, "dispatch"), dispatch);
    assert.equal(f.context.offlineScheduleIsPublished(f.batch), false);
  }
});

test("ticket generation and publication actions are visible to all operating roles", () => {
  assert.match(html, /data-ticket-async-generate data-auth-roles="platform organizer training"[^>]*>全部生成/);
  assert.match(html, /data-ticket-publish data-auth-roles="platform organizer training"[^>]*>发布/);
});
