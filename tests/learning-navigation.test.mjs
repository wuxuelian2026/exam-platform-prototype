import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const shared = read("../current/shared/hbyx-exam-navigation.js");
const admin = read("../current/admin/index.html");
const student = read("../current/student/index.html");
const between = (source, start, end) => {
  const offset = source.indexOf(start);
  assert.notEqual(offset, -1, start);
  const limit = source.indexOf(end, offset);
  assert.notEqual(limit, -1, end);
  return source.slice(offset, limit);
};

function fixture() {
  const stored = new Map();
  const messages = [];
  const input = { checked: true, disabled: false };
  const status = { textContent: "" };
  const tab = { hidden: false };
  const classes = new Set();
  const window = {
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value)
    },
    location: { hash: "#learning" }
  };
  const context = vm.createContext({
    window,
    AUTH_SESSION: { role: "platform" },
    toast: message => messages.push(message),
    lastRouteHash: "",
    currentView: () => window.location.hash.slice(1).split("?")[0],
    document: {
      querySelector: selector => ({
        "[data-learning-navigation-switch]": input,
        "[data-learning-navigation-status]": status,
        '.tabbar [data-tab="learning"]': tab,
        ".tabbar": { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } }
      })[selector] || null
    }
  });
  vm.runInContext(shared, context);
  vm.runInContext(between(admin, "    function syncLearningNavigationSwitch()", '    document.addEventListener("change", function (event) {\n      if (event.target.matches("[data-learning-navigation-switch]"))'), context);
  vm.runInContext(between(student, "      function syncLearningNavigation()", "      function activateView()"), context);
  const guard = between(student, "      function activateView()", "        if (previousRouteHash &&");
  vm.runInContext(guard + "window.routeContinued = true; }", context);
  return { context, window, api: window.HBYXExamNavigation, stored, input, status, tab, classes, messages };
}

test("learning navigation defaults to visible for absent or invalid settings", () => {
  const f = fixture();
  for (const value of [undefined, "null", "{}", "{broken", '"false"', '{"learningVisible":"false"}']) {
    if (value === undefined) f.stored.delete(f.api.storageKey);
    else f.stored.set(f.api.storageKey, value);
    assert.equal(f.api.getLearningVisible(), true);
  }
});

test("visibility persists across reloads and can be restored", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  vm.runInContext(shared, f.context);
  assert.equal(f.window.HBYXExamNavigation.getLearningVisible(), false);
  f.window.HBYXExamNavigation.setLearningVisible(true);
  assert.equal(f.window.HBYXExamNavigation.getLearningVisible(), true);
});

test("settings do not alter course catalog, orders or unrelated storage", () => {
  const f = fixture();
  for (const key of ["hbyx_course_catalog_v1", "hbyx_course_order_status_v1", "unrelated"]) f.stored.set(key, "unchanged");
  f.api.setLearningVisible(false);
  for (const key of ["hbyx_course_catalog_v1", "hbyx_course_order_status_v1", "unrelated"]) assert.equal(f.stored.get(key), "unchanged");
  assert.throws(() => f.api.setLearningVisible("false"), { name: "TypeError" });
});

test("unavailable storage falls back to visible and reports writes as failures", () => {
  const f = fixture();
  Object.defineProperty(f.window, "localStorage", { get() { throw new Error("storage disabled"); } });
  assert.equal(f.api.getLearningVisible(), true);
  assert.throws(() => f.api.setLearningVisible(false), /storage disabled/);
});

test("platform switch saves immediately and reflects the stored state", () => {
  const f = fixture();
  f.input.checked = false;
  f.context.saveLearningNavigationSwitch(f.input);
  assert.equal(f.api.getLearningVisible(), false);
  assert.equal(f.status.textContent, "隐藏");
  assert.equal(f.input.disabled, false);
  assert.match(f.messages.at(-1), /已隐藏/);
  f.input.checked = true;
  f.context.saveLearningNavigationSwitch(f.input);
  assert.equal(f.status.textContent, "显示");
  assert.match(f.messages.at(-1), /已显示/);
});

test("organizer, training and anonymous sessions cannot change the setting", () => {
  const f = fixture();
  for (const role of ["organizer", "training", null]) {
    f.context.AUTH_SESSION = role ? { role } : null;
    f.input.checked = false;
    f.context.saveLearningNavigationSwitch(f.input);
    assert.equal(f.stored.size, 0);
    assert.equal(f.input.checked, true);
    assert.equal(f.input.disabled, true);
    assert.match(f.messages.at(-1), /仅平台/);
  }
});

test("save failure restores the persisted state without success feedback", () => {
  const f = fixture();
  f.window.localStorage.setItem = () => { throw new Error("quota exceeded"); };
  f.input.checked = false;
  f.context.saveLearningNavigationSwitch(f.input);
  assert.equal(f.input.checked, true);
  assert.equal(f.status.textContent, "显示");
  assert.match(f.messages.at(-1), /保存失败/);
});

test("student navigation hides learning and reflows to four tabs, then restores five", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  assert.equal(f.context.syncLearningNavigation(), false);
  assert.equal(f.tab.hidden, true);
  assert.ok(f.classes.has("learning-hidden"));
  f.api.setLearningVisible(true);
  assert.equal(f.context.syncLearningNavigation(), true);
  assert.equal(f.tab.hidden, false);
  assert.ok(!f.classes.has("learning-hidden"));
  assert.match(student, /\.tabbar\.learning-hidden \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
});

test("closing learning while viewing it redirects to home", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  f.context.refreshLearningNavigation();
  assert.equal(f.window.location.hash, "#home");
  assert.equal(f.window.routeContinued, undefined);
});

test("a direct learning route is redirected while navigation is disabled", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  f.window.location.hash = "#learning?category=all";
  f.context.activateView();
  assert.equal(f.window.location.hash, "#home");
  assert.equal(f.window.routeContinued, undefined);
});

test("closing the tab does not redirect home, orders, detail or purchased learning routes", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  for (const route of ["home", "course-orders", "course-order-detail", "course-detail", "course-learning", "course-video"]) {
    f.window.location.hash = "#" + route;
    f.context.activateView();
    assert.equal(f.window.location.hash, "#" + route);
    assert.equal(f.window.routeContinued, true);
  }
});

test("enabled learning remains accessible", () => {
  const f = fixture();
  f.context.activateView();
  assert.equal(f.window.location.hash, "#learning");
  assert.equal(f.window.routeContinued, true);
});

test("both apps load shared settings and register synchronization hooks", () => {
  for (const html of [admin, student]) {
    assert.ok(html.includes('<script src="../shared/hbyx-exam-navigation.js"></script>'));
    assert.ok(html.includes('event.key === window.HBYXExamNavigation.storageKey || event.key === null'));
  }
  assert.match(admin, /course-navigation-settings" data-platform-only/);
  assert.match(admin, /type="checkbox" role="switch" aria-label="显示小程序底部学习导航"/);
  assert.ok(student.includes('window.addEventListener("focus", refreshLearningNavigation)'));
  assert.ok(student.includes('if (document.visibilityState === "visible") refreshLearningNavigation()'));
  for (const tab of ["home", "learning", "applications", "training", "my"]) assert.ok(student.includes(`data-tab="${tab}"`));
});
