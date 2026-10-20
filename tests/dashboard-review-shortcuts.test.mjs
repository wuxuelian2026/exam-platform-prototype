import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
function between(start, end) {
  const offset = html.indexOf(start);
  assert.notEqual(offset, -1, start);
  const limit = html.indexOf(end, offset);
  assert.notEqual(limit, -1, end);
  return html.slice(offset, limit);
}
function fixture(role = "platform") {
  const root = { innerHTML: "", querySelector: () => root };
  const reviews = {
    'system/unit-review': ["待审核", "审核通过", "审核驳回"],
    'org/site-review': ["待审核", "审核通过"],
    'info/review': ["待审核", "已通过", "已驳回"],
  };
  const selectors = {
    '[data-page="org"] [data-subview="unit-review"] [data-unit-review-row][data-unit-review-status="待审核"]': 'system/unit-review',
    '[data-page="org"] [data-subview="site-review"] [data-site-review-row][data-site-review-status-value="待审核"]': 'org/site-review',
    '[data-page="info"] [data-subview="review"] [data-info-review-row][data-info-review-status="待审核"]': 'info/review',
  };
  const batchReviews = [
    { reviewStatus: "待审核", mode: "线下考试" },
    { reviewStatus: "已通过", publishStatus: "待发布", mode: "线上考试" },
    { reviewStatus: "已驳回", mode: "线下考试" },
  ];
  const context = vm.createContext({
    AUTH_SESSION: role ? { role } : null,
    BATCH_REVIEW_DEMO: batchReviews,
    document: { querySelectorAll(selector) {
      assert.ok(Object.hasOwn(selectors, selector), `scoped pending selector: ${selector}`);
      return reviews[selectors[selector]].filter(status => status === "待审核").map(() => ({ hidden: true }));
    } },
    dashboardTodoRole: () => context.AUTH_SESSION?.role,
    dashboardTodoBatchesForRole: () => [{ stage: "enroll" }, { stage: "grades", online: true }],
    dashboardTodoMeta: () => ({ done: false, todoCount: 3, priority: "紧急" }),
    isOnlineBatch: batch => !!batch.online,
    formatDemoNumber: String,
    renderDashboardTodoRows: renderedRoot => { assert.equal(renderedRoot, root); },
  });
  for (const [start, end] of [
    ["    var AUTH_ROLE_CONFIG =", "    var AUTH_DEMO_ACCOUNTS ="],
    ["    function authRoleConfig(", "    function authDemoAccount("],
    ["    function authRouteKey(", "    function authRouteFromHash("],
    ["    function dashboardReviewPendingCount(", "    var ANALYTICS_STAT_LEVELS ="]
  ]) vm.runInContext(between(start, end), context);
  return { context, root, reviews, batchReviews, page: { querySelector: () => root } };
}
const entries = [
  ["单位审核", "system/unit-review"],
  ["考点审核", "org/site-review"],
  ["计划审核", "plans/batch-review"],
  ["信息审核", "info/review"],
];

test("platform workbench exposes all four review routes in the requested order", () => {
  const { context } = fixture();
  const markup = context.dashboardReviewShortcutsHtml();
  assert.match(markup, /<nav[^>]*aria-label="审核入口"/);
  assert.equal((markup.match(/data-dashboard-review-entry/g) || []).length, 4);
  let last = -1;
  for (const [label, route] of entries) {
    const needle = `data-jump="${route}"><span>${label}</span>`;
    const offset = markup.indexOf(needle);
    assert.ok(offset > last, needle);
    last = offset;
  }
});

test("organizers, training institutions and anonymous users get no review entries or empty toolbar", () => {
  for (const role of ["organizer", "training", null]) {
    const { context } = fixture(role);
    assert.equal(context.dashboardReviewShortcutsHtml(), "", String(role));
  }
});

test("each shortcut follows the existing route permission guard", () => {
  const { context } = fixture();
  const allowed = context.authCanAccessRoute;
  context.authCanAccessRoute = (view, sub) => view !== "info" && allowed(view, sub);
  const markup = context.dashboardReviewShortcutsHtml();
  assert.equal((markup.match(/data-dashboard-review-entry/g) || []).length, 3);
  assert.ok(!markup.includes("信息审核"));
});

test("all four badges count pending applications, including hidden rows but excluding reviewed and pending-publication records", () => {
  const { context, reviews, batchReviews } = fixture();
  for (const [, route] of entries) {
    assert.equal(context.dashboardReviewPendingCount(...route.split("/")), 1, route);
    assert.ok(context.dashboardReviewShortcutsHtml().includes(`data-dashboard-review-count="${route}" aria-label="待审核 1 项">1</span>`));
  }
  reviews['system/unit-review'].push("待审核");
  batchReviews.push({ reviewStatus: "待审核", mode: "线上考试" });
  assert.equal(context.dashboardReviewPendingCount("system", "unit-review"), 2);
  assert.equal(context.dashboardReviewPendingCount("plans", "batch-review"), 2);
});

test("returning to the workbench recomputes counts after decisions and shows zero without disabling entry", () => {
  const { context, root, page, reviews, batchReviews } = fixture();
  context.renderDashboardWorkbench(page);
  for (const route of Object.keys(reviews)) reviews[route][0] = "已通过";
  batchReviews[0].reviewStatus = "已驳回";
  context.renderDashboardWorkbench(page);
  assert.equal((root.innerHTML.match(/dashboard-review-count is-empty/g) || []).length, 4);
  for (const [, route] of entries) {
    assert.ok(root.innerHTML.includes(`data-dashboard-review-count="${route}" aria-label="待审核 0 项">0</span>`));
  }
  assert.equal((root.innerHTML.match(/data-dashboard-review-entry/g) || []).length, 4);
  assert.ok(!root.innerHTML.includes("disabled"));
});

test("no counts are queried or exposed for roles without review access", () => {
  for (const role of ["organizer", "training", null]) {
    const { context } = fixture(role);
    context.document.querySelectorAll = () => assert.fail("unauthorized count lookup");
    assert.equal(context.dashboardReviewShortcutsHtml(), "");
  }
});

test("workbench rerenders shortcuts above unchanged batch metrics, filters and table without duplicates", () => {
  const { context, root, page } = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    context.renderDashboardWorkbench(page);
    assert.equal((root.innerHTML.match(/class="dashboard-review-shortcuts"/g) || []).length, 1);
    assert.ok(root.innerHTML.indexOf('aria-label="审核入口"') < root.innerHTML.indexOf('class="dashboard-todo-summary"'));
    for (const label of ["待办批次", "待处理事项", "线下 / 线上", "阶段筛选", "批次主链待办"]) assert.ok(root.innerHTML.includes(label));
    assert.match(root.innerHTML, /<tbody data-dashboard-todo-body>/);
    assert.match(root.innerHTML, /data-jump="batch-workbench\/overview"/);
  }
  context.AUTH_SESSION = { role: "training" };
  context.renderDashboardWorkbench(page);
  assert.ok(!root.innerHTML.includes("dashboard-review-shortcuts"));
  assert.ok(root.innerHTML.includes("批次主链待办"));
});

test("all roles render three metrics and eight headers without urgency indicators", () => {
  for (const role of ["platform", "organizer", "training"]) {
    const { context, root, page } = fixture(role);
    context.renderDashboardWorkbench(page);
    assert.equal((root.innerHTML.match(/class="card metric"/g) || []).length, 3);
    assert.equal((root.innerHTML.match(/<th>/g) || []).length, 8);
    assert.ok(!root.innerHTML.includes("紧急批次"));
    assert.ok(!root.innerHTML.includes("优先级"));
  }
  assert.match(html, /\.dashboard-todo-summary \{[^}]*repeat\(3,/);
});

test("batch todo rows and empty placeholder align to eight columns and retain processing links", () => {
  const { context } = fixture();
  context.escapeHtml = value => String(value ?? "");
  context.batchStageLabel = () => "报名阶段";
  context.batchStatusTag = () => "blue";
  context.batchTagHtml = (_, label) => label;
  context.dashboardTodoMeta = () => ({ order: 1, todo: "处理报名", detail: "待缴费", todoCount: 3, deadline: "2026-10-30", owner: "平台", route: "batch-workbench/enroll", priority: "紧急", priorityTag: "red" });
  vm.runInContext(between("    function renderDashboardTodoRows(", "    function dashboardReviewPendingCount("), context);
  const body = {}, count = {};
  const root = { getAttribute: () => "all", querySelector: selector => selector === "[data-dashboard-todo-body]" ? body : selector === "[data-dashboard-todo-count]" ? count : null };
  context.renderDashboardTodoRows(root);
  assert.equal((body.innerHTML.match(/<td(?: |>)/g) || []).length, 16);
  assert.ok(!body.innerHTML.includes("紧急"));
  assert.match(body.innerHTML, /data-jump="batch-workbench\/enroll"/);
  context.dashboardTodoBatchesForRole = () => [];
  context.renderDashboardTodoRows(root);
  assert.match(body.innerHTML, /colspan="8"/);
  assert.equal(count.textContent, "0 条");
});

test("review routes resolve to existing review pages and shortcut layout can wrap", () => {
  for (const [, route] of entries) {
    const [view, sub] = route.split("/");
    assert.ok(html.includes(`data-subview="${sub}"`), view + "/" + sub);
  }
  assert.match(html, /\.dashboard-review-shortcuts \{[^}]*flex-wrap: wrap/);
});
