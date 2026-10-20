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
  between("    function scheduleDefaultSessionRows(", "    function syncScheduleArrangeRoomLinked("),
  between("    function scheduleRoleArrangePreviewHtml(", "    function scheduleRoleStep2Html(")
].join("\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function fixture() {
  const batch = {
    id: "multi-test", name: "多专业排期", site: "测试考点", stage: "schedule", status: "编排中",
    examWindow: "2026-10-20 至 2026-10-21", sessions: 0, conflicts: 0,
    scheduleSessionRecords: [], scheduleSessionRecordsInitialized: true,
    scheduleCandidatePool: [
      { id: "piano", name: "钢琴考生", code: "EN001", major: "钢琴", level: "3级", site: "测试考点" },
      { id: "dance", name: "舞蹈考生", code: "EN002", major: "中国舞", level: "4级", site: "测试考点" },
      { id: "violin", name: "提琴考生", code: "EN003", major: "小提琴", level: "5级", site: "其他考点" }
    ]
  };
  const messages = [];
  const fields = { site: "测试考点", room: "A201", start: "08:00", end: "09:00", count: "10", note: "" };
  const selection = { majors: ["钢琴", "中国舞"], dates: ["2026-10-20"] };
  const context = vm.createContext({
    window: {}, location: { search: "?scheduleEntry=start" }, URLSearchParams,
    isOnlineBatch: () => false, currentBatchContext: () => batch, escapeHtml,
    batchTagHtml: (_tag, value) => value, batchSessionSuffix: () => "TEST",
    scheduleManageRows: () => [],
    batchChangeIsFrozen: () => false, syncBatchDemo() {}, appendBatchChangeRecord() {},
    refreshBatchChangeView() {}, closeDrawer() {}, toast: (message) => messages.push(message),
    drawerBody: {
      querySelectorAll: (selector) => (selector.includes("data-schedule-major-field") ? selection.majors : selection.dates).map((value) => ({ value })),
      querySelector: (selector) => {
        const key = selector.match(/data-schedule-(.+)-field/)[1];
        return { value: fields[key] };
      }
    }
  });
  vm.runInContext(source, context);
  const basic = () => context.readScheduleSessionBasicFromDrawer().basic;
  const save = () => context.saveScheduleSessionBasic();
  const edit = () => { context.window.__scheduleSessionWizard = { editingSessionId: batch.scheduleSessionRecords[0].id }; };
  return { batch, context, messages, fields, selection, basic, save, edit };
}

test("structured majors are authoritative, deduplicated, and legacy single majors remain valid", () => {
  const { context: c } = fixture();
  assert.deepEqual(plain(c.scheduleSessionMajors({ major: "钢琴" })), ["钢琴"]);
  assert.deepEqual(plain(c.scheduleSessionMajors({ majors: ["钢琴", "中国舞", "钢琴", "", null], major: "旧值" })), ["钢琴", "中国舞"]);
  assert.deepEqual(plain(c.scheduleSessionMajors({ majors: [], major: "旧值" })), []);
});

test("creation and edit render labelled checkboxes and repopulate every selected major", () => {
  const f = fixture();
  const rendered = f.context.scheduleSessionWizardHtml(f.batch, { step: 1, basic: f.basic(), separateDialog: true });
  assert.match(rendered, /<legend>专业（多选） \*<\/legend>/);
  for (const major of ["钢琴", "中国舞"]) assert.ok(rendered.includes(`data-schedule-major-field value="${major}" checked`));
  assert.ok(rendered.includes('data-schedule-major-field value="小提琴">'));
  assert.ok(!rendered.includes("专业为单选"));
  const legacy = f.context.scheduleWizardMajorOptionsHtml(f.batch, { major: "旧专业" });
  assert.ok(legacy.includes('value="旧专业" checked'));
});

test("at least one selected major is required, without falling back to the first unchecked option", () => {
  const f = fixture();
  f.selection.majors = [];
  assert.equal(f.context.readScheduleSessionBasicFromDrawer(), null);
  f.save();
  assert.equal(f.batch.sessions, 0);
  assert.match(f.messages.at(-1), /至少选择1个专业/);
});

test("multiple dates create one session per date containing all majors, with independent arrays", () => {
  const f = fixture();
  f.selection.dates.push("2026-10-21");
  f.save();
  assert.equal(f.batch.sessions, 2);
  for (const record of f.batch.scheduleSessionRecords) {
    assert.deepEqual(plain(record.majors), ["钢琴", "中国舞"]);
    assert.equal(record.major, "钢琴、中国舞");
  }
  assert.notEqual(f.batch.scheduleSessionRecords[0].majors, f.batch.scheduleSessionRecords[1].majors);
});

test("editing expands or reduces unassigned majors and preserves assigned candidates", () => {
  const f = fixture();
  f.save();
  Object.assign(f.batch.scheduleSessionRecords[0], { candidateIds: ["piano"], assigned: 1 });
  f.edit();
  f.selection.majors = ["钢琴", "小提琴"];
  f.save();
  const record = f.batch.scheduleSessionRecords[0];
  assert.deepEqual(plain(record.majors), ["钢琴", "小提琴"]);
  assert.deepEqual(plain(record.candidateIds), ["piano"]);
  assert.equal(record.assigned, 1);
});

test("removing an assigned major is blocked without changing the session or losing candidates", () => {
  const f = fixture();
  f.save();
  Object.assign(f.batch.scheduleSessionRecords[0], { candidateIds: ["piano", "dance"], assigned: 2 });
  const before = plain(f.batch.scheduleSessionRecords);
  f.edit();
  f.selection.majors = ["钢琴"];
  f.save();
  assert.deepEqual(plain(f.batch.scheduleSessionRecords), before);
  assert.match(f.messages.at(-1), /先调整考生分配/);
});

test("legacy assigned counts without complete candidate IDs cannot silently lose a major", () => {
  const f = fixture();
  f.save();
  f.batch.scheduleSessionRecords[0].assigned = 5;
  f.edit();
  f.selection.majors = ["钢琴"];
  f.save();
  assert.match(f.messages.at(-1), /先调整考生分配/);
});

test("candidate pool includes any selected major but excludes unrelated and overlapping assignments", () => {
  const f = fixture();
  const basic = f.basic();
  const ids = () => plain(f.context.scheduleSessionPendingCandidates(f.batch, basic, "").map((candidate) => candidate.id));
  assert.deepEqual(ids(), ["piano", "dance"]);
  f.batch.scheduleSessionRecords.push({ id: "other", date: basic.date, time: "08:00-09:00", site: "其他考点", room: "B201", candidateIds: ["dance"] });
  assert.deepEqual(ids(), ["piano"]);
  assert.deepEqual(plain(f.context.scheduleSessionPendingCandidates(f.batch, basic, "other").map((candidate) => candidate.id)), ["piano", "dance"]);
});

test("multi-major candidate filter offers all session majors and reset does not select a joined label", () => {
  const f = fixture();
  const rendered = f.context.scheduleSessionWizardHtml(f.batch, { step: 2, basic: f.basic(), selectedIds: [], separateDialog: true });
  assert.ok(rendered.includes('<option value="">全部场次专业</option>'));
  assert.ok(!rendered.includes('data-schedule-candidate-filter="major" disabled'));
  assert.ok(rendered.includes('data-schedule-candidate-default-major=""'));
  assert.ok(rendered.includes('data-schedule-candidate-major="钢琴"'));
  assert.ok(rendered.includes('data-schedule-candidate-major="中国舞"'));
  assert.ok(!rendered.includes('data-schedule-candidate-major="小提琴"'));
});

test("candidate assignment accepts multiple majors but rejects unrelated or unknown candidates", () => {
  const f = fixture();
  const basic = f.basic();
  f.save();
  const record = f.batch.scheduleSessionRecords[0];
  const assign = (ids) => {
    f.context.window.__scheduleSessionWizard = { editingSessionId: record.id, basic, selectedIds: ids };
    f.context.saveScheduleCandidateAssignment();
  };
  assign(["piano", "dance"]);
  assert.equal(f.batch.scheduleSessionRecords[0].assigned, 2);
  for (const ids of [["violin"], ["missing"]]) {
    const before = plain(f.batch.scheduleSessionRecords);
    assign(ids);
    assert.match(f.messages.at(-1), /专业不匹配/);
    assert.deepEqual(plain(f.batch.scheduleSessionRecords), before);
  }
});

test("multi-major assignment still blocks capacity overflow and candidate time conflicts", () => {
  const f = fixture();
  const basic = f.basic();
  f.save();
  const record = f.batch.scheduleSessionRecords[0];
  f.context.window.__scheduleSessionWizard = { editingSessionId: record.id, basic: { ...basic, capacity: 1 }, selectedIds: ["piano", "dance"] };
  f.context.saveScheduleCandidateAssignment();
  assert.match(f.messages.at(-1), /不能超过预估人数/);
  f.batch.scheduleSessionRecords.push({ id: "other", date: basic.date, time: "08:30-09:30", candidateIds: ["dance"] });
  f.context.window.__scheduleSessionWizard = { editingSessionId: record.id, basic, selectedIds: ["piano", "dance"] };
  f.context.saveScheduleCandidateAssignment();
  assert.match(f.messages.at(-1), /重叠时段已分配/);
  assert.equal(record.assigned, 0);
});

test("capacity, dates and room overlap validations still apply to multi-major sessions", () => {
  for (const [field, value, message] of [["count", "1.5", /正整数/], ["end", "08:00", /晚于/]]) {
    const f = fixture();
    f.fields[field] = value;
    assert.equal(f.context.readScheduleSessionBasicFromDrawer(), null);
    assert.match(f.messages.at(-1), message);
  }
  const f = fixture();
  f.save();
  assert.equal(f.context.readScheduleSessionBasicFromDrawer(), null);
  assert.match(f.messages.at(-1), /已有场次冲突/);
  f.selection.dates = ["2026-10-22"];
  assert.equal(f.context.readScheduleSessionBasicFromDrawer(), null);
  assert.match(f.messages.at(-1), /考试范围内/);
});

test("editing capacity cannot be reduced below assigned candidates", () => {
  const f = fixture();
  f.save();
  Object.assign(f.batch.scheduleSessionRecords[0], { assigned: 2, candidateIds: ["piano", "dance"] });
  f.edit();
  f.fields.count = "1";
  f.save();
  assert.match(f.messages.at(-1), /预估人数不能小于/);
  assert.equal(f.batch.scheduleSessionRecords[0].capacity, 10);
});

test("JSON row attributes preserve labels with punctuation and quotes for edit and assignment", () => {
  const f = fixture();
  f.selection.majors = ['钢琴、基础', '舞蹈"A&B'];
  f.save();
  const rendered = f.context.scheduleRoleArrangeStep1Html("training", f.batch, "start");
  assert.ok(rendered.includes(`data-schedule-session-majors="${escapeHtml(JSON.stringify(f.selection.majors))}"`));
  const row = { getAttribute: (name) => ({ "data-schedule-session-majors": JSON.stringify(f.selection.majors), "data-schedule-session-major": "不用拆分展示文本", "data-schedule-session-date": "2026-10-20" }[name] || "") };
  assert.deepEqual(plain(f.context.scheduleSessionWizardFromRow(row).basic.majors), f.selection.majors);
  assert.deepEqual(plain(f.context.scheduleSessionMajorsFromRow({ getAttribute: (name) => name === "data-schedule-session-major" ? "钢琴" : "" })), ["钢琴"]);
});

test("preview lists each assigned candidate's own major instead of every session major", () => {
  const f = fixture();
  f.save();
  Object.assign(f.batch.scheduleSessionRecords[0], { assigned: 2, candidateIds: ["piano", "dance"] });
  const rendered = f.context.scheduleRoleArrangePreviewHtml("training", f.batch, "测试机构", "start");
  assert.ok(rendered.includes("钢琴、中国舞"));
  assert.ok(rendered.includes("钢琴考生"));
  assert.ok(rendered.includes("舞蹈考生"));
  assert.ok(rendered.includes("钢琴</td><td>3级"));
  assert.ok(rendered.includes("中国舞</td><td>4级"));
  assert.ok(!rendered.includes("钢琴、中国舞 3级"));
});
