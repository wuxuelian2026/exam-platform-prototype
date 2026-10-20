import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
function between(start, end) {
  const index = html.indexOf(start);
  const endIndex = html.indexOf(end, index);
  assert.ok(index >= 0 && endIndex > index, start);
  return html.slice(index, endIndex);
}
const source = [
  between("    function scheduleRoleCanWrite(", "    function scheduleStepBarHtml("),
  between("    function scheduleDefaultSessionRows(", "    function scheduleWizardCandidateSource("),
  between("    function scheduleWizardCandidateSource(", "    function scheduleWizardEntryMode("),
  between("    function scheduleWizardSelectedDates(", "    function scheduleWizardDatePickerHtml("),
  between("    function scheduleWizardAppendSessionRecords(", "    function scheduleWizardTimeState("),
  between("    function saveScheduleSessionBasic(", "    function saveScheduleCandidateAssignment("),
  between("    function scheduleRoleStep1Html(", "    function syncScheduleArrangeRoomLinked("),
  between("    function scheduleDirectMutationBlocked(", "    function batchChangeAuditHtml(")
].join("\n");

function fixture(overrides = {}) {
  const batch = {
    id: "session-test", stage: "schedule", status: "编排中", examMode: "线下考试",
    examWindow: "2026-10-20 至 2026-10-21", site: "测试考点", sessions: 2, conflicts: 0,
    ...overrides
  };
  const messages = [];
  const context = vm.createContext({
    window: {}, AUTH_SESSION: { role: "platform" }, location: { search: "" }, URLSearchParams,
    isOnlineBatch: (item) => item.examMode === "线上考试",
    escapeHtml: (value) => String(value), batchTagHtml: (_tag, value) => value,
    batchSessionSuffix: () => "TEST", scheduleWizardEntryMode: () => "start",
    batchChangeIsFrozen: () => false, syncBatchDemo() {}, appendBatchChangeRecord() {},
    refreshBatchChangeView() {}, closeDrawer() {}, toast: (message) => messages.push(message)
  });
  vm.runInContext(source, context);
  const renderers = [
    (role) => context.scheduleRoleStep1Html(role, batch),
    (role) => context.scheduleRoleArrangeStep1Html(role, batch, "start"),
    (role) => context.scheduleRoleArrangeStep1Html(role, batch, "continue")
  ];
  return { batch, context, messages, renderers };
}
function assertCreation(f, role, expected) {
  for (const render of f.renderers) {
    assert.equal(render(role).includes("data-schedule-step-create"), expected, role);
  }
}

test("training can create first and additional sessions in both scheduling views", () => {
  for (const overrides of [
    { sessions: 0 },
    { sessions: 2 },
    { sessions: 2, scheduleStep1Done: true },
    { sessions: 2, conflicts: 1, scheduleStep1Done: true }
  ]) assertCreation(fixture(overrides), "training", true);
});

test("organizer and platform retain creation in the arranging phase", () => {
  for (const role of ["organizer", "platform"]) {
    assertCreation(fixture({ scheduleStep1Done: true }), role, true);
  }
});

test("waiting, reviewing, published and online phases do not expose creation", () => {
  for (const overrides of [
    { status: "待排期" }, { status: "待复核" }, { status: "已发布" },
    { schedulePhaseStatus: "待复核" }, { schedulePhaseStatus: "已发布" },
    { stage: "grades", status: "待发布" },
    { examMode: "线上考试", schedulePhaseStatus: "编排中" }
  ]) {
    for (const role of ["training", "organizer", "platform"]) {
      assertCreation(fixture(overrides), role, false);
    }
  }
  assertCreation(fixture(), "student", false);
});

test("saving a first session keeps creation available for the next session", () => {
  const f = fixture({ sessions: 0 });
  const basic = { site: f.batch.site, room: "A201", major: "钢琴", dates: ["2026-10-20"], date: "2026-10-20", start: "13:00", end: "14:00", capacity: 10 };
  f.context.readScheduleSessionBasicFromDrawer = () => ({ batch: f.batch, basic, wizard: {} });
  for (let index = 1; index <= 2; index += 1) {
    assertCreation(f, "training", true);
    f.context.saveScheduleSessionBasic();
    assert.equal(f.batch.sessions, index);
    assert.equal(f.batch.scheduleStep1Done, true);
    assertCreation(f, "training", true);
    basic.start = "14:00";
    basic.end = "15:00";
  }
  assert.equal(new Set(f.batch.scheduleSessionRecords.map((row) => row.id)).size, 2);
  assert.equal(f.messages.length, 2);
});

test("creation visibility fix does not broaden legacy edit or delete controls", () => {
  const f = fixture({ scheduleStep1Done: true });
  for (const role of ["training", "organizer", "platform"]) {
    const rendered = f.context.scheduleRoleStep1Html(role, f.batch);
    assert.ok(rendered.includes("data-schedule-step-create"));
    assert.ok(!rendered.includes("data-schedule-step-edit"));
    assert.ok(!rendered.includes("data-schedule-step-delete"));
  }
});

test("published mutation guard and frozen-batch save protection remain in effect", () => {
  const f = fixture({ status: "已发布" });
  assert.equal(f.context.scheduleDirectMutationBlocked(f.batch), true);
  f.context.batchChangeIsFrozen = () => true;
  f.context.readScheduleSessionBasicFromDrawer = () => ({ batch: f.batch });
  f.context.saveScheduleSessionBasic();
  assert.equal(f.batch.sessions, 2);
  assert.equal(f.batch.scheduleSessionRecords, undefined);
  const clickHandler = between('      var scheduleStepCreate = event.target.closest("[data-schedule-step-create]");', '      var scheduleStepEdit =');
  assert.match(clickHandler, /batchChangeIsFrozen\(currentBatchContext\(\), "schedule"\) \|\|\s*scheduleDirectMutationBlocked\(currentBatchContext\(\)\)/);
});
