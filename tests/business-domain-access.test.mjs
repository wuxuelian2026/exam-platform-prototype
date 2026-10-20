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
function fixture() {
  function element(attributes = {}) {
    const classes = new Set();
    return {
      hidden: false, dataset: {}, textContent: "",
      getAttribute: name => attributes[name] || null,
      classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) }
    };
  }
  const top = ["exam", "course", "training", "shared"].map(domain => element({ "data-top-domain": domain }));
  const routes = ["dashboard", "courses/publish", "courses/orders", "training/publish", "training/enrollments", "org/sites"];
  const links = routes.map(route => element({ "data-jump": route }));
  const sections = ["course", "training"].map(domain => {
    const section = element({ "data-domain": domain });
    section.parent = element();
    section.querySelectorAll = () => links.filter(link => link.getAttribute("data-jump").startsWith(domain === "course" ? "courses/" : "training/"));
    section.querySelector = () => section.parent;
    return section;
  });
  const title = element();
  const context = vm.createContext({
    AUTH_SESSION_KEY: "hbyx_exam_auth_session",
    AUTH_SESSION: null,
    AUTH_RETURN_ROUTE: "",
    authResetSms() {}, toast() {}, sessionStorage: { setItem() {} },
    history: { replaceState: (_state, _title, url) => { context.lastUrl = url; } },
    showPage: (view, sub) => { context.lastPage = `${view}/${sub}`; },
    document: {
      querySelectorAll: selector => ({
        "[data-top-domain]": top,
        ".menu-item[data-jump], .menu-item[data-nav]": links,
        ".menu-sub": sections,
        ".menu-group": [],
        "[data-domain]": sections
      })[selector] || [],
      querySelector: () => title
    }
  });
  for (const [start, end] of [
    ["    var AUTH_ROLE_CONFIG =", "    var AUTH_DEMO_ACCOUNTS ="],
    ["    function authRoleConfig(", "    function authDemoAccount("],
    ["    function authRouteKey(", "    function authRouteFromHash("],
    ["    function syncRoleMenus(", "    function syncBatchStageVisibility("],
    ["    function syncTopDomain(", "    function syncSidebar("],
    ["    function authLogin(", "    function authLogout("]
  ]) vm.runInContext(between(start, end), context);
  context.authApplySession = session => { context.AUTH_SESSION = session; context.syncRoleMenus(); };
  return { context, top, links, sections, title };
}

test("only platform can access course and training domains and all their subroutes", () => {
  const { context } = fixture();
  for (const role of ["platform", "organizer", "training", null]) {
    context.AUTH_SESSION = role ? { role } : null;
    for (const domain of ["course", "training"]) assert.equal(context.authCanAccessDomain(domain), role === "platform");
    for (const view of ["courses", "training"]) {
      for (const sub of ["", "publish", "orders", "enrollments", "detail/123", "unknown"]) {
        assert.equal(context.authCanAccessRoute(view, sub), role === "platform", `${role}: ${view}/${sub}`);
      }
    }
  }
});

test("external role route allowlists no longer contain the retired domains", () => {
  const { context } = fixture();
  for (const role of ["organizer", "training"]) assert.ok(context.AUTH_ROLE_CONFIG[role].routes.every(route => !/^(courses|training)\//.test(route)));
});

test("role switching hides top entries, sidebar parents and child links and restores platform access", () => {
  const f = fixture();
  for (const role of ["platform", "organizer", "training", "platform"]) {
    f.context.AUTH_SESSION = { role };
    f.context.syncRoleMenus();
    const hidden = role !== "platform";
    for (const tab of f.top.filter(tab => ["course", "training"].includes(tab.getAttribute("data-top-domain")))) {
      assert.equal(tab.hidden, hidden);
      assert.equal(tab.dataset.authHidden, String(hidden));
    }
    for (const section of f.sections) {
      assert.equal(section.hidden, hidden);
      assert.equal(section.parent.hidden, hidden);
      for (const link of section.querySelectorAll()) assert.equal(link.hidden, hidden);
    }
    assert.equal(f.links.find(link => link.getAttribute("data-jump") === "org/sites").hidden, false);
  }
});

test("requesting a forbidden domain cannot reveal its sidebar", () => {
  const f = fixture();
  for (const role of ["organizer", "training"]) {
    f.context.AUTH_SESSION = { role };
    f.context.syncRoleMenus();
    for (const domain of ["course", "training"]) {
      f.context.syncTopDomain(domain);
      assert.equal(f.title.textContent, "考级业务");
      assert.ok(f.sections.every(section => section.hidden));
    }
  }
  f.context.AUTH_SESSION = { role: "platform" };
  f.context.syncRoleMenus();
  f.context.syncTopDomain("course");
  assert.equal(f.sections[0].hidden, false);
  assert.equal(f.sections[1].hidden, true);
});

test("exam and existing shared access rules remain unchanged", () => {
  const { context } = fixture();
  for (const role of ["platform", "organizer", "training"]) {
    context.AUTH_SESSION = { role };
    assert.equal(context.authCanAccessDomain("exam"), true);
    assert.equal(context.authCanAccessDomain("shared"), context.AUTH_ROLE_CONFIG[role].shared);
    assert.equal(context.authCanAccessRoute("dashboard", "workbench"), true);
    assert.equal(context.authCanAccessRoute("org", "sites"), true);
  }
  context.AUTH_ROLE_CONFIG.organizer.shared = false;
  context.AUTH_SESSION = { role: "organizer" };
  assert.equal(context.authCanAccessDomain("shared"), false);
});

test("login with an old course or training return URL sends external roles to their workbench", () => {
  const { context } = fixture();
  for (const role of ["organizer", "training"]) {
    for (const route of ["courses/publish", "courses/orders", "training/publish", "training/enrollments"]) {
      context.AUTH_RETURN_ROUTE = route;
      context.authLogin(role, "demo");
      assert.equal(context.lastUrl, "#dashboard/workbench");
      assert.equal(context.lastPage, "dashboard/workbench");
    }
  }
  context.AUTH_RETURN_ROUTE = "training/publish";
  context.authLogin("platform", "admin");
  assert.equal(context.lastPage, "training/publish");
});

test("page entry and stale top button clicks use the same access guards", () => {
  const showPage = between("    function showPage(", "      var contentView = contentViewFor(view, sub);");
  assert.match(showPage, /if \(!authCanAccessRoute\(view, sub\)\)/);
  assert.match(showPage, /defaultRoute/);
  assert.match(html, /topDomain.dataset.authHidden === "true" \|\| !authCanAccessDomain\(domain\)/);
});
