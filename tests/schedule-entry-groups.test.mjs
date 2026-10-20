import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const between = (start, end, last = false) => {
  const index = last ? html.lastIndexOf(start) : html.indexOf(start);
  assert.ok(index >= 0 && html.indexOf(end, index) > index);
  return html.slice(index, html.indexOf(end, index));
};
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const batch = { id: "groups", name: "人工分组测试", stage: "schedule", status: "编排中", pendingSchedule: 0, conflicts: 0, scheduleSessionRecordsInitialized: true };
  batch.scheduleCandidatePool = Array.from({ length: 12 }, (_, index) => ({ id: "d" + index, code: "EN" + index, name: "考生" + index, major: "中国舞", level: index < 3 ? "2级" : index < 7 ? "3级" : "5级", organization: "测试机构" }));
  batch.scheduleCandidatePool.push({ id: "b", name: "芭蕾考生", major: "芭蕾舞", level: "3级" }, { id: "p", name: "钢琴考生", major: "钢琴", level: "2级" });
  const session = { id: "S1", date: "2026-10-20", time: "09:00-12:00", room: "A201", site: "测试考点", majors: ["中国舞", "芭蕾舞", "钢琴"], candidateIds: batch.scheduleCandidatePool.map(item => item.id), assigned: 14, entryGroups: [] };
  batch.scheduleSessionRecords = [session];
  const messages = [], audit = [];
  const c = vm.createContext({
    window: {}, AUTH_SESSION: { role: "training" }, location: { search: "" }, URLSearchParams,
    baseProfessionalCatalog: () => [{ code: "02001", name: "中国舞", categoryCode: "DANCE" }, { code: "02003", name: "芭蕾舞", categoryCode: "DANCE" }, { code: "01001", name: "钢琴", categoryCode: "MUSIC" }],
    isOnlineBatch: item => item.online, scheduleArrangeSessionRows: item => item.scheduleSessionRecords,
    scheduleWizardEntryMode: () => "start", currentBatchContext: () => batch,
    scheduleRoleCanWrite: (role, phase) => ["platform", "training", "organizer"].includes(role) && phase === "编排中",
    schedulePhaseOf: item => item.status, scheduleStepState: () => ({ done: [true] }),
    batchChangeIsFrozen: () => c.frozen, scheduleDirectMutationBlocked: item => item.status === "已发布",
    escapeHtml: value => String(value).replaceAll("<", "&lt;"),
    toast: message => messages.push(message), openDrawer() {}, closeDrawer() {}, syncBatchDemo() {}, refreshBatchChangeView() {},
    appendBatchChangeRecord: (...args) => audit.push(args), drawerBody: { querySelectorAll: () => [], querySelector: () => null },
    BATCH_STAGE_LABEL: { dispatch: "派遣" }, showPage() {}
  });
  vm.runInContext(between("    function scheduleWizardCandidateSource(", "    function scheduleSessionMajorsFromRow("), c);
  vm.runInContext(between("    function confirmSchedulePublish(", "    var PAGINATION_DEFAULT_SIZE =", true), c);
  const action = (groups, type, ids = [], index = 0, member = 0) => c.scheduleEntryApplyAction(batch, session, groups, type, ids, index, member);
  const group = (ids, id = "g1") => ({ id, candidateIds: ids });
  return { batch, session, c, messages, audit, action, group };
}

test("same professional subject permits mixed levels and groups of one or more than ten", () => {
  const f = fixture();
  for (const ids of [["d0"], ["d0", "d3", "d7"], Array.from({ length: 12 }, (_, i) => "d" + i)]) {
    assert.ok(f.action([], "create", ids).groups);
  }
});
test("cross-subject, non-dance, unknown and duplicate members are rejected atomically", () => {
  const f = fixture();
  for (const ids of [["d0", "b"], ["p"], ["unknown"], ["d0", "d0"]]) {
    assert.ok(f.action([], "create", ids).error);
  }
  const groups = [f.group(["d0"])];
  const snapshot = plain(groups);
  assert.match(f.action(groups, "add", ["b"]).error, /不能跨专业/);
  assert.match(f.action(groups, "add", ["d0"]).error, /重复/);
  assert.deepEqual(groups, snapshot);
});
test("grouping cannot include a candidate assigned only to another session", () => {
  const f = fixture(); f.session.candidateIds = ["d0"]; f.session.assigned = 1;
  assert.match(f.action([], "create", ["d1"]).error, /非本场次/);
});
test("empty groups and repeated group identities fail validation", () => {
  const f = fixture();
  for (const groups of [[f.group([])], [f.group(["d0"]), f.group(["d1"])]]) {
    assert.ok(f.c.scheduleEntryValidation(f.batch, f.session, groups, false).errors.length);
  }
});
test("incomplete grouping is draftable, but submission requires all dance candidates", () => {
  const f = fixture();
  const draft = f.c.scheduleEntryValidation(f.batch, f.session, [f.group(["d0"])], false);
  assert.equal(draft.errors.length, 0); assert.equal(draft.ungrouped.length, 12);
  assert.match(f.c.scheduleEntryValidation(f.batch, f.session, [], true).errors[0], /未分组/);
});
test("customer example can be manually formed as three level groups or two mixed-level groups", () => {
  const f = fixture(); f.session.candidateIds = Array.from({ length: 10 }, (_, i) => "d" + i); f.session.assigned = 10;
  for (const lists of [[["d0", "d1", "d2"], ["d3", "d4", "d5", "d6"], ["d7", "d8", "d9"]], [["d0", "d1", "d2", "d3", "d4", "d5", "d6"], ["d7", "d8", "d9"]]]) {
    const groups = lists.map((ids, i) => f.group(ids, "g" + i));
    assert.equal(f.c.scheduleEntryValidation(f.batch, f.session, groups, true).errors.length, 0);
  }
});
test("manual add, remove, dissolve and reorder keep stable group identity and member order", () => {
  const f = fixture();
  let groups = [f.group(["d0", "d1"]), f.group(["d2"], "g2")];
  groups = f.action(groups, "member-down", [], 0, 0).groups;
  assert.deepEqual(plain(groups[0].candidateIds), ["d1", "d0"]);
  groups = f.action(groups, "group-down").groups;
  assert.equal(groups[1].id, "g1");
  groups = f.action(groups, "add", ["d3"], 0).groups;
  groups = f.action(groups, "remove", [], 0, 0).groups;
  assert.deepEqual(plain(groups[0].candidateIds), ["d3"]);
  groups = f.action(groups, "remove", [], 0, 0).groups;
  assert.equal(groups.length, 1);
  assert.equal(f.action(groups, "dissolve").groups.length, 0);
});
test("candidate reassignment retains surviving groups, drops empty groups, never auto-groups new members", () => {
  const f = fixture();
  const groups = [f.group(["d0", "d1"]), f.group(["d2"], "g2")];
  const next = f.c.scheduleEntryGroupsReconcile(groups, ["d1", "d3"]);
  assert.deepEqual(plain(next), [f.group(["d1"])]);
  assert.deepEqual(groups[0].candidateIds, ["d0", "d1"]);
});
test("non-dance and online sessions do not acquire mandatory grouping", () => {
  const f = fixture(); f.session.candidateIds = ["p"]; f.session.assigned = 1;
  assert.equal(f.c.scheduleEntryValidation(f.batch, f.session, [], true).errors.length, 0);
  f.batch.online = true; f.session.candidateIds = ["d0"];
  assert.equal(f.c.scheduleEntryValidation(f.batch, f.session, [], true).errors.length, 0);
});
test("legacy dance counts without candidate detail cannot bypass complete grouping validation", () => {
  const f = fixture(); f.session.candidateIds = []; f.session.assigned = 10;
  assert.match(f.c.scheduleEntryValidation(f.batch, f.session, [], true).errors[0], /明细不完整/);
});
test("opening and canceling operates on a deep copy, and stale drafts cannot overwrite changes", () => {
  const f = fixture(); f.session.entryGroups = [f.group(["d0"])];
  f.c.openScheduleEntryGroups("S1");
  f.c.window.__scheduleEntryGroupDraft.groups[0].candidateIds.push("d1");
  assert.deepEqual(f.session.entryGroups[0].candidateIds, ["d0"]);
  f.session.note = "other edit";
  f.c.handleScheduleEntryAction({ getAttribute: () => "save" });
  assert.match(f.messages.at(-1), /场次已变更/); assert.equal(f.audit.length, 0);
});
test("save retains partial drafts with audit but no automatic additions", () => {
  const f = fixture(); f.c.openScheduleEntryGroups("S1");
  f.c.window.__scheduleEntryGroupDraft.groups = [f.group(["d0", "d3"])];
  f.c.handleScheduleEntryAction({ getAttribute: () => "save" });
  assert.deepEqual(plain(f.batch.scheduleSessionRecords[0].entryGroups), [f.group(["d0", "d3"])]);
  assert.equal(f.audit.length, 1);
});
test("reviewing, published and frozen sessions cannot mutate grouping including stale drawers", () => {
  for (const kind of ["review", "published", "frozen"]) {
    const f = fixture(); f.c.openScheduleEntryGroups("S1");
    if (kind === "platform") f.c.AUTH_SESSION.role = "platform";
    if (kind === "review") f.batch.status = "待复核";
    if (kind === "published") f.batch.status = "已发布";
    if (kind === "frozen") f.c.frozen = true;
    f.c.handleScheduleEntryAction({ getAttribute: () => "save" });
    assert.equal(f.audit.length, 0);
  }
});
test("final submission and publication both reject incomplete groups without advancing stages", () => {
  for (const mode of ["submit", "publish"]) {
    const f = fixture(); f.c.window.__schedulePublishMode = mode;
    if (mode === "publish") { f.c.AUTH_SESSION.role = "organizer"; f.batch.status = "待复核"; }
    f.c.confirmSchedulePublish();
    assert.equal(f.batch.stage, "schedule"); assert.match(f.messages.at(-1), /入场分组校验未通过/);
  }
});
test("roster follows group and member order while retaining each candidate's own level", () => {
  const f = fixture(); f.session.entryGroups = [f.group(["d7", "d0"])];
  const roster = f.c.scheduleEntryRoster(f.batch, f.session);
  assert.equal(roster[0].candidate.id, "d7"); assert.equal(roster[1].order, 2);
  assert.equal(roster[0].candidate.level, "5级"); assert.equal(roster[1].candidate.level, "2级");
  const markup = f.c.scheduleEntryRosterHtml(f.batch, f.session);
  assert.match(markup, /第1组/); assert.match(markup, /未分组/); assert.match(markup, /单人入场/);
  assert.ok(!markup.includes("评分"));
});
test("demo fixture matches the customer's ten-person example without altering other batches", () => {
  const f = fixture();
  const demo = f.c.scheduleWizardCandidateSource({ id: "batch-demo-05", site: "测试考点" });
  const china = demo.filter(item => item.major === "中国舞");
  assert.equal(china.length, 10);
  assert.deepEqual(["2级", "3级", "5级"].map(level => china.filter(item => item.level === level).length), [3, 4, 3]);
  assert.equal(f.c.scheduleWizardCandidateSource({ id: "other" }).length, 3);
});
test("published roster retains session identity, group order, individual levels and stable seat numbers", () => {
  const f = fixture(); f.session.entryGroups = [f.group(["d7", "d0"])];
  const rows = f.c.scheduleEntryPublishedRows(f.batch, "training");
  assert.equal(rows.length, 14);
  assert.deepEqual(plain(rows[0].slice(12)), ["08", "第1组", 1, "S1"]);
  assert.deepEqual(plain(rows[1].slice(12)), ["01", "第1组", 2, "S1"]);
  assert.equal(rows[0][5], "5级"); assert.equal(rows[1][5], "2级");
  assert.match(f.c.scheduleEntryRosterHtml(f.batch, f.session), /报名机构/);
});
test("CSV export respects organization scope, carries grouping and neutralizes formula injection", async () => {
  const f = fixture(); f.session.entryGroups = [f.group(["d7", "d0"])];
  f.batch.scheduleCandidatePool[7].name = '=SUM(1,2)';
  f.c.roleOrganizationDataScope = () => ({ names: { 测试机构: true } });
  let exported;
  f.c.Blob = Blob;
  f.c.URL = { createObjectURL: blob => { exported = blob; return "blob:test"; }, revokeObjectURL() {} };
  f.c.document = { createElement: () => ({ click() {} }) };
  f.c.setTimeout = fn => fn();
  f.c.scheduleEntryExport(f.batch);
  const csv = await exported.text();
  assert.match(csv, /入场组/); assert.match(csv, /第1组/); assert.match(csv, /'=SUM\(1,2\)/);
  assert.ok(csv.indexOf("EN7") < csv.indexOf('"EN0"'));
  assert.ok(!csv.includes("芭蕾考生"));
});
