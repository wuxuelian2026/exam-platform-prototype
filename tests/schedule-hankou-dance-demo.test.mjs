import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("    function scheduleArrangeMockDates("), html.indexOf("    function scheduleEntrySubject("));
function fixture(id = "batch-demo-05") {
  const context = vm.createContext({
    batchSessionSuffix: () => "05",
    scheduleArrangeRoomResources: batch => [{ site: batch.site, rooms: ["A201", "A202"] }]
  });
  vm.runInContext(source, context);
  const batch = { id, site: "宜昌青少年美育中心考点", examWindow: "2026-08-21 至 2026-08-22" };
  return { batch, candidates: context.scheduleWizardCandidateSource(batch), sessions: context.scheduleArrangeMockSessionRows(batch) };
}

test("Hankou dance demo covers three catalog subjects and the customer's 3/4/3 level distribution", () => {
  const { batch, candidates } = fixture();
  const hankou = candidates.filter(candidate => candidate.id.includes("-HK-DANCE-"));
  assert.equal(hankou.length, 30);
  assert.equal(new Set(candidates.map(candidate => candidate.id)).size, candidates.length);
  assert.equal(new Set(candidates.map(candidate => candidate.code)).size, candidates.length);
  for (const [major, code] of [["中国舞", "02001"], ["国际标准舞", "02002"], ["芭蕾舞", "02003"]]) {
    const rows = hankou.filter(candidate => candidate.major === major);
    assert.equal(rows.length, 10);
    assert.deepEqual(["2级", "3级", "5级"].map(level => rows.filter(row => row.level === level).length), [3, 4, 3]);
    assert.ok(rows.every(row => row.subjectCode === code && row.organization === "汉口美育培训学校" && row.site === batch.site));
  }
});

test("new candidates are assigned exactly once into A201 with complete counts and supported majors", () => {
  const { candidates, sessions } = fixture();
  const session = sessions.find(row => row.room === "A201" && row.date === "2026-08-21" && row.time === "14:00-17:00");
  assert.equal(session.assigned, 31);
  assert.equal(session.candidateIds.length, session.assigned);
  assert.ok(session.capacity >= session.assigned);
  assert.ok(session.candidateIds.every(id => session.majors.includes(candidates.find(row => row.id === id)?.major)));
  for (const candidate of candidates.filter(row => row.id.includes("-HK-DANCE-"))) {
    assert.ok(session.candidateIds.includes(candidate.id));
    assert.equal(sessions.filter(row => row.candidateIds.includes(candidate.id)).length, 1);
  }
  assert.equal((session.entryGroups || []).length, 0);
});

test("other batches retain original demo candidates and capacities", () => {
  const { candidates, sessions } = fixture("other");
  assert.equal(candidates.length, 3);
  assert.equal(sessions[1].capacity, 28);
  assert.equal(sessions[1].candidateIds.length, 1);
});
