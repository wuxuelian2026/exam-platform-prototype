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

test("batch analysis labels capacity utilization with its calculation scope", () => {
  const source = implementation("analyticsBatchAnalysisHtml");
  assert.match(source, /<strong>排期容量利用率<\/strong>/);
  assert.match(source, /已分配人数/);
  assert.match(source, /有效容量/);
  assert.match(source, /剩余容量/);
  assert.doesNotMatch(source, /\[\["已排期", batch\.scheduled/);
  assert.doesNotMatch(html, /排期场次利用率/);
  assert.doesNotMatch(html, />排期利用率</);
});

test("batch analysis keeps the metric name and scope visually separated", () => {
  assert.match(html, /\.analytics-panel-head > div \{ display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; \}/);
});

test("capacity utilization is weighted by session capacity and excludes invalid sessions", () => {
  const context = vm.createContext({
    scheduleSessionRows: () => [
      { assigned: 20, capacity: 25, status: "已发布" },
      { assigned: 30, capacity: 40, status: "已发布" },
      { assigned: 15, capacity: 20, status: "已作废" }
    ],
    analyticsPercent: (part, total) => (Math.round(part * 1000 / total) / 10) + "%"
  });
  vm.runInContext(implementation("analyticsScheduleCapacity"), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.analyticsScheduleCapacity({ sessions: 3, scheduled: 50 }))), {
    sessionCount: 2,
    assigned: 50,
    capacity: 65,
    remaining: 15,
    rate: "76.9%"
  });
});

test("incomplete demo session detail falls back to batch-level capacity without negative utilization", () => {
  const context = vm.createContext({
    scheduleSessionRows: () => [
      { assigned: 0, capacity: 20, status: "草稿" },
      { assigned: 0, capacity: 18, status: "草稿" }
    ],
    analyticsPercent: (part, total) => (Math.round(part * 1000 / total) / 10) + "%"
  });
  vm.runInContext(implementation("analyticsScheduleCapacity"), context);
  const result = context.analyticsScheduleCapacity({ sessions: 25, scheduled: 832 });
  assert.equal(result.sessionCount, 25);
  assert.equal(result.capacity, 850);
  assert.equal(result.remaining, 18);
  assert.equal(result.rate, "97.9%");
});

test("organization capacity rows reconcile with batch totals", () => {
  const context = vm.createContext({
    dashboardTodoRole: () => "platform",
    authRoleConfig: () => ({}),
    batchDemoOrgs: () => ["武汉少儿艺术中心", "武汉美育培训学校"],
    analyticsPercent: (part, total) => (Math.round(part * 1000 / total) / 10) + "%"
  });
  vm.runInContext(["analyticsDistributeCounts", "analyticsOrganizationCapacityRows"].map(implementation).join("\n"), context);
  const rows = context.analyticsOrganizationCapacityRows({ pendingSchedule: 10, conflicts: 3 }, {
    assigned: 832, capacity: 850, rate: "97.9%", sessionCount: 25
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.assigned, 0), 832);
  assert.equal(rows.reduce((sum, row) => sum + row.capacity, 0), 850);
  assert.equal(rows.reduce((sum, row) => sum + row.pending, 0), 10);
  assert.equal(rows.reduce((sum, row) => sum + row.conflicts, 0), 3);
  assert.equal(rows.reduce((sum, row) => sum + row.sessions, 0), 25);
  assert.ok(rows[0].rateValue <= rows[1].rateValue);
});

test("batch analysis exposes organization capacity detail and totals", () => {
  const source = implementation("analyticsBatchAnalysisHtml");
  assert.match(source, /报名机构排期容量明细/);
  assert.match(source, /容量利用率/);
  assert.match(source, /共享场次容量按实际分配人数拆分/);
  assert.match(source, /<tfoot>/);
  assert.match(source, /analytics-org-capacity-table" data-no-pagination data-no-sticky/);
  assert.match(implementation("paginationTable"), /data-no-pagination/);
  assert.match(implementation("syncStickyTableColumns"), /data-no-sticky/);
  assert.match(html, /\.analytics-org-capacity-table \{ min-width: 0; table-layout: fixed; \}/);
});
