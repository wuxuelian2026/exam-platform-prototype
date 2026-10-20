import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const shared = read("../current/shared/hbyx-exam-entry-groups.js");
const student = read("../current/student/index.html");
const judge = read("../current/judge/index.html");
const between = (text, start, end) => {
  const index = text.indexOf(start);
  assert.ok(index >= 0 && text.indexOf(end, index) > index);
  return text.slice(index, text.indexOf(end, index));
};
const context = vm.createContext({ window: {} });
vm.runInContext(shared, context);
const display = context.window.HBYXExamEntryGroups.display;

test("both mobile pages load the shared formatter and all their inline scripts parse", () => {
  for (const html of [student, judge]) {
    assert.ok(html.includes('src="../shared/hbyx-exam-entry-groups.js"'));
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  }
});

test("offline dance displays explicit group, member order and member count without inferring from level", () => {
  for (const subject of ["中国舞", "国际标准舞", "芭蕾舞"]) {
    const result = display({ subject, mode: "offline", level: "5级", entryGroup: { name: "第2组", memberOrder: 3, memberCount: 7 } });
    assert.equal(result.visible, true);
    assert.equal(result.text, "第2组 · 组内序号 03 · 共 7 人");
  }
  assert.equal(display({ categoryCode: "DANCE", entryGroup: { name: "特别组" } }).text, "特别组");
});

test("online dance and non-dance never display an entry group, even with stale grouping metadata", () => {
  for (const record of [{ categoryCode: "DANCE", online: true }, { categoryCode: "DANCE", mode: "online" }, { categoryCode: "DANCE", examMode: "在线考试" }, { subject: "钢琴" }]) {
    assert.equal(display({ ...record, entryGroup: { name: "第1组" } }).visible, false);
  }
});

test("missing groups stay pending, and incomplete group metadata does not invent counts or sequence", () => {
  for (const entryGroup of [undefined, null, {}, { name: "  " }]) {
    assert.equal(display({ categoryCode: "DANCE", entryGroup }).text, "待分组");
  }
  assert.equal(display({ categoryCode: "DANCE", entryGroup: { name: "第1组", memberOrder: -1, memberCount: "7" } }).text, "第1组");
});

test("student route changes clear previous group text and hide the row for music or online dance", () => {
  const row = {}, text = {};
  const c = vm.createContext({ window: context.window, document: { querySelector: () => row }, setApplicationText: (_, value) => { text.value = value; } });
  vm.runInContext(between(student, "      function syncExamDetailEntryGroup(", "      function syncApplicationDetail("), c);
  c.syncExamDetailEntryGroup({ mode: "offline", entryGroup: { name: "第3组" } }, "中国舞");
  assert.equal(row.hidden, false); assert.equal(text.value, "第3组");
  c.syncExamDetailEntryGroup({ mode: "online" }, "中国舞");
  assert.equal(row.hidden, true); assert.equal(text.value, "");
  c.syncExamDetailEntryGroup({}, "钢琴");
  assert.equal(row.hidden, true); assert.equal(text.value, "");
  assert.match(student, /syncExamDetailEntryGroup\(data, parts.subject\)/);
});

test("judge candidate field uses textContent and does not affect per-person score links", () => {
  const appended = [];
  const c = vm.createContext({ window: context.window, document: { createElement: () => ({}) } });
  vm.runInContext(between(judge, "      function appendCandidateEntryGroup(", "      function renderScheduleCandidates("), c);
  const row = { querySelector: () => ({ appendChild: field => appended.push(field) }) };
  c.appendCandidateEntryGroup(row, { subject: "中国舞", entryGroup: { name: "<img onerror=alert(1)>" } });
  assert.equal(appended[0].textContent, "入场分组：<img onerror=alert(1)>");
  assert.equal(appended[0].innerHTML, undefined);
  c.appendCandidateEntryGroup(row, { subject: "钢琴" });
  assert.equal(appended.length, 1);
  const render = between(judge, "      function renderScheduleCandidates(", "      function renderScheduleDetail(");
  assert.match(render, /appendCandidateEntryGroup\(row, task\)/);
  assert.match(render, /setCandidate\(scoreId\)/);
});

test("judge demo has a reachable dance session with manually mixed-level group membership", () => {
  const c = vm.createContext({ SCHEDULE_TASKS: {}, SCORE_TASKS: {} });
  vm.runInContext(between(judge, '      SCHEDULE_TASKS["dance-afternoon"] =', "      function judgeLevelCodesFromRange("), c);
  const session = c.SCHEDULE_TASKS["dance-afternoon"];
  assert.equal(session.scoreIds.length, 10);
  const tasks = session.scoreIds.map(id => c.SCORE_TASKS[id]);
  assert.ok(tasks.every(task => task.textbook === "中国舞等级考试教材" && task.repertoires.includes("规定舞蹈组合")));
  const first = tasks.filter(task => task.entryGroup.name === "第1组");
  assert.equal(first.length, 7);
  assert.equal(new Set(first.map(task => task.level)).size, 2);
  assert.equal(tasks.filter(task => task.entryGroup.name === "第2组").length, 3);
  assert.match(judge, /data-schedule-id="dance-afternoon"/);
});
