import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("    var TRAINING_ACTIVITY_STORAGE_KEY"), html.indexOf("    function prepareTrainingActivityRows"));
const valid = () => ({
  name: "教师能力培训", direction: "钢琴教学", location: "武汉培训中心",
  start: "2026-11-10", end: "2026-11-12", registrationStart: "2026-10-01", registrationEnd: "2026-11-09",
  capacity: "50", fee: "1280.50", description: "培训介绍\n第二行"
});

function fixture() {
  const stored = new Map();
  const messages = [];
  const rows = [];
  const tbody = {
    firstChild: null,
    querySelectorAll: () => rows,
    insertBefore: row => rows.unshift(row)
  };
  const context = vm.createContext({
    AUTH_SESSION: { role: "platform" },
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } },
    document: {
      querySelector: () => tbody,
      createElement: () => { const row = { dataset: {}, setAttribute() {}, innerHTML: "", remove() { rows.splice(rows.indexOf(row), 1); } }; return row; }
    },
    escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
    trainingStatusTag: value => `<span>${value}</span>`,
    toast: message => messages.push(message),
    closeDrawer: () => { context.closed = true; },
    filterTrainingActivities: reset => { context.filtersReset = reset; }
  });
  vm.runInContext(source, context);
  const form = (data = valid(), nativeValid = true) => ({
    dataset: {}, reportValidity: () => nativeValid,
    querySelectorAll: selector => selector === '[name]' ? Object.entries(data).map(([name, value]) => ({ name, value })) : []
  });
  return { context, stored, messages, rows, form };
}

test("create button opens a registered drawer instead of showing a toast", () => {
  assert.match(html, /data-drawer="training-create">新增培训活动/);
  assert.doesNotMatch(html, /data-toast="培训活动新增表单已打开"/);
  assert.match(html, /DRAWER\["training-create"\] = .*body: trainingActivityFormHtml/);
  assert.match(html, /type="submit" form="training-create-form"/);
  assert.match(html, /saveTrainingActivity\(trainingForm,.*data-training-save-draft/);
});

test("form matches screenshot fields, fixed offline mode and optional media", () => {
  const f = fixture();
  const form = f.context.trainingActivityFormHtml();
  for (const field of Object.keys(valid())) {
    assert.ok(form.includes(`name="${field}"`), field);
    assert.ok(form.includes(`for="training-create-${field}"`), field);
  }
  assert.match(form, /value="线下培训" readonly/);
  assert.doesNotMatch(form, /name="description" required/);
  assert.doesNotMatch(form, /name="(?:target|contactName|contactPhone)"/);
  assert.match(form, /系统自动生成/);
  assert.match(form, /data-training-media="video"/);
  assert.match(form, /data-training-media="cover"/);
  assert.match(html, /DRAWER\["training-create"\].*data-close-drawer>关闭/);
  assert.match(html, /formnovalidate data-training-save-draft/);
});

test("valid activity, free activity and same-day dates are accepted", () => {
  const { context } = fixture();
  for (const overrides of [{}, { fee: "0" }, { start: "2026-11-10", end: "2026-11-10", registrationStart: "2026-11-10", registrationEnd: "2026-11-10" }]) {
    assert.equal(context.trainingActivityValidation({ ...valid(), ...overrides }), "");
  }
});

test("missing, whitespace and overlength text cannot be published", () => {
  const { context } = fixture();
  for (const field of ["name", "direction", "location"]) {
    for (const value of [undefined, "", "   ", "x".repeat(5001)]) {
      assert.notEqual(context.trainingActivityValidation({ ...valid(), [field]: value }), "", field);
    }
  }
});

test("invalid dates and reversed or overlapping periods are rejected", () => {
  const { context } = fixture();
  for (const overrides of [{ start: "2026-02-30" }, { start: "invalid" }, { start: "2026-11-13" }, { registrationStart: "2026-11-10" }, { registrationEnd: "2026-11-11" }]) {
    assert.notEqual(context.trainingActivityValidation({ ...valid(), ...overrides }), "");
  }
});

test("capacity, amount and description limits are enforced", () => {
  const { context } = fixture();
  for (const field of ["capacity", "fee"]) {
    for (const value of ["", "-1", "Infinity", "NaN", "1.111", "1000001"]) {
      assert.notEqual(context.trainingActivityValidation({ ...valid(), [field]: value }), "", `${field}: ${value}`);
    }
  }
  assert.notEqual(context.trainingActivityValidation({ ...valid(), capacity: "0" }), "");
  assert.notEqual(context.trainingActivityValidation({ ...valid(), description: "x".repeat(5001) }), "");
});

test("publishing persists all fields, adds exactly one row and resets filters", () => {
  const f = fixture();
  f.context.saveTrainingActivity(f.form({ ...valid(), name: "  教师能力培训  " }));
  assert.equal(f.rows.length, 1);
  const record = JSON.parse(f.stored.get(f.context.TRAINING_ACTIVITY_STORAGE_KEY))[0];
  assert.equal(record.name, "教师能力培训");
  assert.match(record.id, /^TA\d+$/);
  for (const field of Object.keys(valid())) assert.equal(record[field], valid()[field]);
  assert.equal(f.rows[0].dataset.trainingActivityPublishStatus, "已发布");
  assert.equal(f.context.closed, true);
  assert.equal(f.context.filtersReset, true);
  assert.match(f.messages.at(-1), /已创建并发布/);
});

test("organizer, institution and anonymous sessions cannot open or save", () => {
  const f = fixture();
  const guard = html.slice(html.indexOf("    function openDrawer(key)"), html.indexOf('      if (["result-confirm"'));
  vm.runInContext(guard + "window.opened = true; }", f.context);
  for (const role of ["organizer", "training", null]) {
    f.context.AUTH_SESSION = role ? { role } : null;
    f.context.openDrawer("training-create");
    f.context.saveTrainingActivity(f.form());
    assert.equal(f.context.window.opened, undefined);
    assert.equal(f.rows.length, 0);
    assert.equal(f.stored.size, 0);
  }
});

test("invalid form or business validation keeps the form open without saving", () => {
  const f = fixture();
  f.context.saveTrainingActivity(f.form(valid(), false));
  f.context.saveTrainingActivity(f.form({ ...valid(), registrationEnd: "2026-11-13" }));
  assert.equal(f.rows.length, 0);
  assert.equal(f.stored.size, 0);
  assert.equal(f.context.closed, undefined);
});

test("storage failures do not add a row, close the drawer or report success", () => {
  const f = fixture();
  f.context.window.localStorage.setItem = () => { throw new Error("quota"); };
  f.context.saveTrainingActivity(f.form());
  assert.equal(f.rows.length, 0);
  assert.equal(f.context.closed, undefined);
  assert.match(f.messages.at(-1), /保存失败/);
});

test("reload data tolerates malformed storage and retains valid records only", () => {
  const f = fixture();
  for (const value of ["broken", "null", "{}", '[{"id":"TA1"}]']) {
    f.stored.set(f.context.TRAINING_ACTIVITY_STORAGE_KEY, value);
    assert.equal(f.context.readCreatedTrainingActivities().length, 0);
  }
  f.context.saveTrainingActivity(f.form());
  assert.equal(f.context.readCreatedTrainingActivities().length, 1);
  assert.match(html, /if \(tbody && !tbody.dataset.trainingRestored\)/);
});

test("IDs remain unique when two activities are created in the same millisecond", () => {
  const f = fixture();
  vm.runInContext("Date.now = function () { return 123456; };", f.context);
  f.context.saveTrainingActivity(f.form());
  f.context.saveTrainingActivity(f.form());
  assert.equal(new Set(f.rows.map(row => row.dataset.trainingActivityId)).size, 2);
  assert.equal(f.context.readCreatedTrainingActivities().length, 2);
});

test("registration status uses date boundaries including the final registration day", () => {
  const f = fixture();
  vm.runInContext('var NativeDate = Date; Date = class extends NativeDate { constructor(value) { super(value === undefined ? "2026-11-09T12:00:00" : value); } };', f.context);
  assert.equal(f.context.trainingActivityRegistrationStatus(valid()), "报名中");
  assert.equal(f.context.trainingActivityRegistrationStatus({ ...valid(), registrationStart: "2026-11-10" }), "未开始");
  assert.equal(f.context.trainingActivityRegistrationStatus({ ...valid(), registrationEnd: "2026-11-08" }), "已截止");
  assert.equal(f.context.trainingActivityRegistrationStatus({ ...valid(), end: "2026-11-08" }), "已结束");
});

test("created row and read-only detail escape user content", () => {
  const f = fixture();
  const record = { ...valid(), name: '<img src=x onerror="alert(1)">', description: "<script>alert(1)</script>" };
  f.context.saveTrainingActivity(f.form(record));
  assert.doesNotMatch(f.rows[0].innerHTML, /<img/);
  assert.match(f.rows[0].innerHTML, /&lt;img/);
  f.context.window.__activeTrainingActivity = JSON.parse(f.rows[0].dataset.trainingActivityRecord);
  assert.doesNotMatch(f.context.createdTrainingActivityDetailHtml(), /<script>/);
  assert.match(f.context.createdTrainingActivityDetailHtml(), /&lt;script&gt;/);
});

test("draft accepts only a name, survives reload and can be completed without duplicating", async () => {
  const f = fixture();
  await f.context.saveTrainingActivity(f.form({ name: "培训草稿" }, false), true);
  assert.equal(f.rows.length, 1);
  const draft = f.context.readCreatedTrainingActivities()[0];
  assert.equal(draft.publishStatus, "草稿");
  assert.equal(f.context.trainingActivityRegistrationStatus(draft), "未开始");
  assert.match(f.rows[0].innerHTML, /data-training-edit/);
  const form = f.form(valid());
  form.dataset.recordId = draft.id;
  await f.context.saveTrainingActivity(form);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].dataset.trainingActivityId, draft.id);
  assert.equal(f.context.readCreatedTrainingActivities()[0].publishStatus, "已发布");
});

test("draft validates entered values and publishing accepts optional description", () => {
  const f = fixture();
  assert.notEqual(f.context.trainingActivityValidation({ name: "" }, true), "");
  assert.notEqual(f.context.trainingActivityValidation({ name: "草稿", fee: "-1" }, true), "");
  assert.equal(f.context.trainingActivityValidation({ name: "草稿", start: "2026-11-10", end: "" }, true), "");
  assert.equal(f.context.trainingActivityValidation({ ...valid(), description: "" }), "");
});

test("cover and video enforce exact types, size limits and nonempty files", () => {
  const f = fixture();
  const validate = f.context.trainingMediaValidation;
  assert.equal(validate({ name: "封面.PNG", type: "image/png", size: 2 * 1024 ** 2 }, "cover"), "");
  assert.equal(validate({ name: "视频.mp4", type: "video/mp4", size: 100 * 1024 ** 2 }, "video"), "");
  for (const file of [{ name: "x.png", type: "image/png", size: 0 }, { name: "x.jpg", type: "image/jpeg", size: 2 * 1024 ** 2 + 1 }, { name: "x.svg", type: "image/svg+xml", size: 10 }, { name: "x.png", type: "text/html", size: 10 }]) assert.notEqual(validate(file, "cover"), "");
  for (const file of [{ name: "x.mov", type: "video/quicktime", size: 1 }, { name: "x.mp4", type: "video/mp4", size: 100 * 1024 ** 2 + 1 }]) assert.notEqual(validate(file, "video"), "");
});

test("media is persisted before activity metadata, restores with draft, and failure never reports success", async () => {
  const f = fixture();
  const file = { name: "演示.mp4", type: "video/mp4", size: 20 };
  const form = f.form();
  const original = form.querySelectorAll;
  form.querySelectorAll = selector => selector === "[data-training-media]" ? [{ dataset: { trainingMedia: "video" }, querySelector: () => ({ files: [file] }) }] : original(selector);
  const files = new Map();
  f.context.trainingMediaStore = async (mode, action) => action({ put: (value, key) => files.set(key, value) });
  await f.context.saveTrainingActivity(form, true);
  const record = f.context.readCreatedTrainingActivities()[0];
  assert.equal(files.get(record.video.key), file);
  assert.equal(record.video.name, "演示.mp4");
  assert.doesNotMatch(JSON.stringify(record), /blob:|data:video/);
  assert.equal(form.dataset.saving, undefined);
  const other = fixture();
  other.context.trainingMediaStore = async () => { throw new Error("quota"); };
  await other.context.saveTrainingActivity(form);
  assert.equal(other.rows.length, 0);
  assert.equal(other.closed, undefined);
  assert.match(other.messages.at(-1), /保存失败/);
});
