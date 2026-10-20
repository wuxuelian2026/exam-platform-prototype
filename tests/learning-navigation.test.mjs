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
  const trainingInput = { checked: true, disabled: false };
  const trainingStatus = { textContent: "" };
  const trainingTab = { hidden: false };
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
        "[data-training-navigation-switch]": trainingInput,
        "[data-training-navigation-status]": trainingStatus,
        '.tabbar [data-tab="training"]': trainingTab,
        ".tabbar": { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } }
      })[selector] || null
    }
  });
  vm.runInContext(shared, context);
  vm.runInContext(between(admin, "    function syncLearningNavigationSwitch()", '    document.addEventListener("change", function (event) {\n      if (event.target.matches("[data-learning-navigation-switch]"))'), context);
  vm.runInContext(between(student, "      function syncStudentNavigation()", "      function activateView()"), context);
  const guard = between(student, "      function activateView()", "        if (previousRouteHash &&");
  vm.runInContext(guard + "window.routeContinued = true; }", context);
  return { context, window, api: window.HBYXExamNavigation, stored, input, status, tab, trainingInput, trainingStatus, trainingTab, classes, messages };
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
  assert.equal(f.context.syncStudentNavigation().learning, false);
  assert.equal(f.tab.hidden, true);
  assert.ok(f.classes.has("learning-hidden"));
  f.api.setLearningVisible(true);
  assert.equal(f.context.syncStudentNavigation().learning, true);
  assert.equal(f.tab.hidden, false);
  assert.ok(!f.classes.has("learning-hidden"));
  assert.match(student, /\.tabbar\.learning-hidden \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
});

test("closing learning while viewing it redirects to home", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  f.context.refreshStudentNavigation();
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
  assert.ok(student.includes('window.addEventListener("focus", refreshStudentNavigation)'));
  assert.ok(student.includes('if (document.visibilityState === "visible") refreshStudentNavigation()'));
  for (const tab of ["home", "learning", "applications", "training", "my"]) assert.ok(student.includes(`data-tab="${tab}"`));
});

test("training defaults to visible for legacy, missing, malformed and non-boolean settings", () => {
  const f = fixture();
  for (const value of [undefined, "null", "{}", "{broken", "[]", "false", '{"learningVisible":false}', '{"trainingVisible":"false"}']) {
    if (value === undefined) f.stored.delete(f.api.storageKey);
    else f.stored.set(f.api.storageKey, value);
    assert.equal(f.api.getTrainingVisible(), true);
  }
});

test("training persists across reload and changing either setting preserves the other", () => {
  const f = fixture();
  f.stored.set(f.api.storageKey, '{"learningVisible":false,"otherSetting":"keep"}');
  f.api.setTrainingVisible(false);
  assert.equal(f.api.getLearningVisible(), false);
  vm.runInContext(shared, f.context);
  assert.equal(f.window.HBYXExamNavigation.getTrainingVisible(), false);
  f.api.setLearningVisible(true);
  assert.equal(f.api.getTrainingVisible(), false);
  f.api.setTrainingVisible(true);
  assert.equal(f.api.getLearningVisible(), true);
  assert.equal(JSON.parse(f.stored.get(f.api.storageKey)).otherSetting, "keep");
});

test("training updates never modify activity, registration or order data", () => {
  const f = fixture();
  for (const key of ["hbyx_training_registrations_v1", "hbyx_course_catalog_v1", "hbyx_course_order_status_v1"]) f.stored.set(key, "unchanged");
  f.api.setTrainingVisible(false);
  for (const key of ["hbyx_training_registrations_v1", "hbyx_course_catalog_v1", "hbyx_course_order_status_v1"]) assert.equal(f.stored.get(key), "unchanged");
  assert.throws(() => f.api.setTrainingVisible("false"), { name: "TypeError" });
});

test("training handles inaccessible storage without claiming a successful save", () => {
  const f = fixture();
  Object.defineProperty(f.window, "localStorage", { get() { throw new Error("storage disabled"); } });
  assert.equal(f.api.getTrainingVisible(), true);
  assert.throws(() => f.api.setTrainingVisible(false), /storage disabled/);
});

test("platform training switch saves immediately without enabling hidden learning", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  f.trainingInput.checked = false;
  f.context.saveTrainingNavigationSwitch(f.trainingInput);
  assert.equal(f.api.getTrainingVisible(), false);
  assert.equal(f.api.getLearningVisible(), false);
  assert.equal(f.trainingStatus.textContent, "隐藏");
  assert.equal(f.trainingInput.disabled, false);
  assert.match(f.messages.at(-1), /培训导航已隐藏/);
  f.trainingInput.checked = true;
  f.context.saveTrainingNavigationSwitch(f.trainingInput);
  assert.equal(f.api.getTrainingVisible(), true);
  assert.equal(f.api.getLearningVisible(), false);
  assert.equal(f.trainingStatus.textContent, "显示");
  assert.match(f.messages.at(-1), /培训导航已显示/);
});

test("organizer, institution and anonymous roles cannot change training visibility", () => {
  const f = fixture();
  for (const role of ["organizer", "training", null]) {
    f.context.AUTH_SESSION = role ? { role } : null;
    f.trainingInput.checked = false;
    f.context.saveTrainingNavigationSwitch(f.trainingInput);
    assert.equal(f.stored.size, 0);
    assert.equal(f.trainingInput.checked, true);
    assert.equal(f.trainingInput.disabled, true);
    assert.match(f.messages.at(-1), /仅平台/);
  }
});

test("failed training save restores persisted visibility and leaves learning unchanged", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  f.api.setTrainingVisible(false);
  f.window.localStorage.setItem = () => { throw new Error("quota exceeded"); };
  f.trainingInput.checked = true;
  f.context.saveTrainingNavigationSwitch(f.trainingInput);
  assert.equal(f.trainingInput.checked, false);
  assert.equal(f.trainingStatus.textContent, "隐藏");
  assert.equal(f.api.getLearningVisible(), false);
  assert.match(f.messages.at(-1), /保存失败/);
});

test("all four learning/training combinations hide only intended tabs and reflow correctly", () => {
  const f = fixture();
  for (const [learning, training] of [[true, true], [true, false], [false, true], [false, false]]) {
    f.api.setLearningVisible(learning);
    f.api.setTrainingVisible(training);
    f.context.syncStudentNavigation();
    assert.equal(f.tab.hidden, !learning);
    assert.equal(f.trainingTab.hidden, !training);
    assert.equal(f.classes.has("learning-hidden"), !learning);
    assert.equal(f.classes.has("training-hidden"), !training);
  }
  assert.match(student, /\.tabbar\.training-hidden \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  assert.match(student, /\.tabbar\.learning-hidden\.training-hidden \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
});

test("closing training while it is being viewed returns home", () => {
  const f = fixture();
  f.window.location.hash = "#training";
  f.api.setTrainingVisible(false);
  f.context.refreshStudentNavigation();
  assert.equal(f.window.location.hash, "#home");
  assert.equal(f.window.routeContinued, undefined);
});

test("disabled training redirects direct navigation but preserves registration history and details", () => {
  const f = fixture();
  f.api.setTrainingVisible(false);
  f.window.location.hash = "#training?direction=all";
  f.context.activateView();
  assert.equal(f.window.location.hash, "#home");
  for (const route of ["my-training", "training-registration-detail", "training-activity-detail", "training-activity-list", "my", "home"]) {
    f.window.location.hash = "#" + route;
    f.context.activateView();
    assert.equal(f.window.location.hash, "#" + route);
    assert.equal(f.window.routeContinued, true);
  }
});

test("enabled training remains accessible even when learning is hidden", () => {
  const f = fixture();
  f.api.setLearningVisible(false);
  f.window.location.hash = "#training";
  f.context.activateView();
  assert.equal(f.window.location.hash, "#training");
  assert.equal(f.window.routeContinued, true);
});

test("training switch belongs to the publish panel, has platform scope and synchronization hooks", () => {
  const page = between(admin, '<section class="page" data-page="training">', '<div class="subview" data-subview="enrollments">');
  assert.match(page, /training-navigation-settings" data-platform-only/);
  assert.match(page, /type="checkbox" role="switch" aria-label="显示考生小程序底部培训导航"/);
  assert.match(admin, /if \(event.target.matches\("\[data-training-navigation-switch\]"\)\) saveTrainingNavigationSwitch\(event.target\)/);
  assert.ok(between(admin, 'window.addEventListener("storage", function (event) {\n      if (event.key === window.HBYXExamNavigation.storageKey', "    function courseDefaultLessons").includes("syncTrainingNavigationSwitch()"));
});
