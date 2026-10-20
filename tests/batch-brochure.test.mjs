import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const source = [
  between("    var AUTH_ROLE_CONFIG =", "    var AUTH_DEMO_ACCOUNTS ="),
  between("    function authRouteKey(", "    function authRoleAllowsElement("),
  between("    var BROCHURE_SECTION_DEFINITIONS =", "    var BROCHURE_REVIEW_TAB ="),
  between("    function brochurePlatformTemplates(", "    function brochureTemplateSectionValue("),
  between("    function batchBrochurePickerHtml(", "    function batchFilterBrochureOptions("),
  between("    function batchSyncBrochureSummary(", "    function batchDateTimeInputValue("),
  between("    function batchFormSnapshot(", "    function saveBatchFormAction("),
  between("    function batchBrochureDetailBodyHtml(", "    function renderBatchManagementFilterOptions(")
].join("\n");
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const fields = new Map(Object.entries({
    "[data-batch-exam-mode]": { value: "offline" },
    "[data-batch-form-name]": { value: "简章验收批次" },
    "[data-batch-contact-name]": { value: "周老师" },
    "[data-batch-contact-phone]": { value: "027-87561234" }
  }));
  const checks = [{ value: "BR-2026-001", checked: true, closest: () => ({ getAttribute: () => "《2026年社会艺术水平考级简章》" }) }];
  const editors = new Map();
  const panel = {};
  const root = {
    editId: "",
    querySelector(selector) {
      if (selector === "[data-batch-brochure-check]:checked") return checks.find(input => input.checked) || null;
      if (selector === '[data-batch-page-panel="brochure"]') return panel;
      if (selector === "[data-batch-brochure-picker]") return picker;
      return fields.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-batch-brochure-check]") return checks;
      if (selector === "[data-batch-brochure-section]") return [...editors.values()];
      if (selector.includes('data-batch-picker="site"')) return [{ closest: () => ({ querySelector: () => ({ textContent: "光谷考点" }) }) }];
      if (selector.includes("data-batch-picker")) return [{}];
      return [];
    },
    getAttribute: () => root.editId
  };
  const picker = {
    querySelector: selector => selector === "[data-batch-brochure-summary]" ? summary : root.querySelector(selector),
    closest: () => root
  };
  const summary = { textContent: "" };
  const confirmations = [];
  const messages = [];
  const context = vm.createContext({
    AUTH_SESSION: { role: "platform" },
    window: { confirm: message => { confirmations.push(message); return context.confirmResult; } },
    confirmResult: true,
    authRoleConfig: role => context.AUTH_ROLE_CONFIG[role],
    escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    toast: message => messages.push(message),
    batchCreateRoot: () => root,
    batchSelectedOwnerUnit: () => ({ id: "platform", name: "湖北艺术职业学院", type: "平台" }),
    batchDateTimeFieldValues: () => ({ date: "20261020", time: "090000" }),
    batchDateTimeFieldDisplay: () => "2026-10-20 09:00:00",
    batchDateTimeRangeParts: () => ({}),
    batchInputDateValue: value => value || "",
    batchInputTimeValue: value => value || "",
    batchHydrateOwnerUnit: () => {},
    batchSyncCoverImagePreview: () => {},
    batchHydrateOrgFeeConfig: () => {},
    batchReadOrgFeeConfig: () => [],
    batchGetCoverImage: () => null,
    batchOnlineSubmitRuleText: () => "缴费后15日内提交",
    BATCH_DEMO_LIST: [],
    batchById: id => context.BATCH_DEMO_LIST.find(batch => batch.id === id)
  });
  vm.runInContext(source, context);
  Object.defineProperty(panel, "innerHTML", {
    set(value) {
      panel.markup = value;
      editors.clear();
      const draft = root.__batchBrochureDraft;
      fields.delete("[data-batch-brochure-title]");
      if (!draft) return;
      fields.set("[data-batch-brochure-title]", { value: draft.title });
      for (const [name] of context.BROCHURE_SECTION_DEFINITIONS) editors.set(name, {
        value: draft.sectionContents[name], getAttribute: () => name
      });
    }
  });
  context.batchSyncBrochureEditor(root);
  return { context, root, fields, editors, checks, panel, summary, confirmations, messages };
}

test("retired brochure menus are removed and direct access is denied for all roles", () => {
  const sidebar = between('<aside', "</aside>");
  assert.ok(sidebar.length);
  for (const route of ["info/org-brochures", "info/brochure-review"]) assert.ok(!sidebar.includes(`data-jump="${route}"`));
  const f = fixture();
  for (const role of ["platform", "organizer", "training"]) {
    f.context.AUTH_SESSION.role = role;
    for (const sub of ["org-brochures", "brochure-review"]) assert.equal(f.context.authCanAccessRoute("info", sub), false);
    assert.equal(f.context.authCanAccessRoute("info", "platform-brochures"), true);
  }
  assert.match(between("    function showPage(", "    function normalizeRegistrationOrganizationUi("), /if \(view === "info" && \["org-brochures", "brochure-review"\].*sub = "platform-brochures"/);
});

test("picker includes only published platform brochures and reflects catalog changes", () => {
  const f = fixture();
  const template = plain(f.context.BROCHURE_DATA[0]);
  f.context.BROCHURE_DATA.push({ ...template, id: "platform-draft", publishStatus: "未发布" });
  f.context.BROCHURE_DATA.push({ ...template, id: "platform-archived", publishStatus: "已归档" });
  f.context.BROCHURE_DATA.push({ ...template, id: "platform-new", title: '<新简章 "测试">' });
  let options = f.context.batchBrochurePickerHtml();
  assert.ok(options.includes('value="BR-2026-001"'));
  assert.ok(options.includes('value="platform-new"'));
  assert.ok(options.includes('&lt;新简章 &quot;测试&quot;&gt;'));
  for (const id of ["BR-2026-004", "platform-draft", "platform-archived"]) assert.ok(!options.includes(`value="${id}"`));
  f.context.BROCHURE_DATA.forEach(item => { item.publishStatus = "未发布"; });
  options = f.context.batchBrochurePickerHtml();
  assert.ok(!options.includes('type="radio"'));
  assert.ok(options.includes("未找到匹配的已发布平台简章"));
});

test("all 14 sections, title, version and attachments are copied without mutating source", () => {
  const f = fixture();
  const template = f.context.BROCHURE_DATA[0];
  template.attachments = [{ name: "平台附件.pdf" }];
  template.sectionContents["报名手续"] = "平台报名内容";
  const draft = f.context.batchBrochureDraftFromTemplate(template);
  assert.equal(Object.keys(draft.sectionContents).length, 14);
  assert.equal(draft.sectionContents["报名手续"], "平台报名内容");
  assert.equal(draft.title, template.title);
  assert.equal(draft.brochureVersionId, template.brochureVersionId);
  draft.sectionContents["考级对象"] = "批次变化";
  draft.attachments[0].name = "批次附件.pdf";
  assert.notEqual(template.sectionContents["考级对象"], "批次变化");
  assert.equal(template.attachments[0].name, "平台附件.pdf");
});

test("exactly the specified five sections are readonly for every role", () => {
  const f = fixture();
  for (const role of ["platform", "organizer", "training"]) {
    f.context.AUTH_SESSION.role = role;
    const markup = f.context.batchBrochureEditorHtml(f.root.__batchBrochureDraft);
    for (const [name] of f.context.BROCHURE_SECTION_DEFINITIONS) {
      const textarea = markup.match(new RegExp(`<textarea[^>]*data-batch-brochure-section="${name}"[^>]*>`))[0];
      assert.equal(/\sreadonly(?=[\s>])/.test(textarea), f.context.BROCHURE_TEMPLATE_LOCKED_SECTIONS.includes(name), name);
    }
    assert.equal((markup.match(/ readonly/g) || []).length, 5);
  }
});

test("editable values are captured while forged changes to readonly fields are ignored", () => {
  const f = fixture();
  const original = plain(f.context.BROCHURE_DATA[0]);
  f.fields.get("[data-batch-brochure-title]").value = "批次独立简章标题";
  f.editors.get("报名手续").value = "批次专用报名手续";
  f.editors.get("考级对象").value = "不应写入";
  const draft = f.context.batchReadBrochureDraft(f.root);
  assert.equal(draft.title, "批次独立简章标题");
  assert.equal(draft.sectionContents["报名手续"], "批次专用报名手续");
  assert.equal(draft.sectionContents["考级对象"], original.sectionContents["考级对象"]);
  assert.deepEqual(plain(f.context.BROCHURE_DATA[0]), original);
  f.context.batchSyncBrochureEditor(f.root);
  assert.equal(f.editors.get("报名手续").value, "批次专用报名手续");
});

test("switching templates confirms unsaved changes and cancel restores selected source", () => {
  const f = fixture();
  const second = { ...plain(f.context.BROCHURE_DATA[0]), id: "second", title: "另一份平台简章", brochureVersionId: "second-v1" };
  f.context.BROCHURE_DATA.push(second);
  f.checks.push({ value: second.id, checked: false });
  f.editors.get("报名手续").value = "未保存修改";
  f.checks[0].checked = false;
  f.checks[1].checked = true;
  f.context.confirmResult = false;
  f.context.batchSyncBrochureEditor(f.root);
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.checks[0].checked, true);
  assert.equal(f.editors.get("报名手续").value, "未保存修改");
  f.checks[0].checked = false;
  f.checks[1].checked = true;
  f.context.confirmResult = true;
  f.context.batchSyncBrochureEditor(f.root);
  assert.equal(f.root.__batchBrochureDraft.brochureId, "second");
  assert.equal(f.fields.get("[data-batch-brochure-title]").value, second.title);
  assert.notEqual(f.editors.get("报名手续").value, "未保存修改");
});

test("attachments are batch-local and reject invalid types or oversize files atomically", () => {
  const f = fixture();
  f.context.batchUpdateBrochureAttachments(f.root, [{ name: "批次补充.pdf", size: 100 }]);
  assert.equal(f.root.__batchBrochureDraft.attachments.length, 3);
  assert.equal(f.context.BROCHURE_DATA[0].attachments, 2);
  assert.notEqual(JSON.stringify(f.context.batchReadBrochureDraft(f.root)), f.root.__batchBrochureInitialSignature);
  for (const file of [{ name: "无效.exe", size: 1 }, { name: "超大.pdf", size: 20 * 1024 * 1024 + 1 }]) {
    f.context.batchUpdateBrochureAttachments(f.root, [{ name: "合法.pdf", size: 1 }, file]);
    assert.equal(f.root.__batchBrochureDraft.attachments.length, 3);
  }
  f.context.batchUpdateBrochureAttachments(f.root, [], 0);
  assert.equal(f.root.__batchBrochureDraft.attachments.length, 2);
  assert.equal(f.messages.length, 2);
});

test("draft, submit and publish reject unknown, unpublished and institutional sources", () => {
  const f = fixture();
  for (const id of ["missing", "BR-2026-002", "BR-2026-003", "BR-2026-004", "BR-2026-005"]) {
    f.checks[0].value = id;
    for (const action of ["draft", "submit-review", "publish"]) assert.equal(f.context.batchBrochureValidationResult(f.root, action).ok, false, id);
  }
  f.checks[0].value = "BR-2026-001";
  f.context.BROCHURE_DATA[0].publishStatus = "未发布";
  assert.equal(f.context.batchBrochureValidationResult(f.root, "publish").ok, false);
});

test("title is required and submit/publish require every section; drafts may be incomplete", () => {
  const f = fixture();
  for (const action of ["draft", "submit-review", "publish"]) assert.equal(f.context.batchBrochureValidationResult(f.root, action).ok, true);
  for (const title of ["", "   ", "字".repeat(101)]) {
    f.fields.get("[data-batch-brochure-title]").value = title;
    assert.equal(f.context.batchBrochureValidationResult(f.root, "draft").ok, false);
  }
  f.fields.get("[data-batch-brochure-title]").value = "有效简章标题";
  f.editors.get("报名手续").value = "   ";
  assert.equal(f.context.batchBrochureValidationResult(f.root, "draft").ok, true);
  for (const action of ["submit-review", "publish"]) assert.ok(f.context.batchBrochureValidationResult(f.root, action).message.includes("报名手续"));
});

test("online and offline saves persist independent snapshots and hydrate by source ID", () => {
  for (const mode of ["online", "offline"]) {
    for (const action of ["draft", "submit-review", "publish"]) {
      const f = fixture();
      f.fields.get("[data-batch-exam-mode]").value = mode;
      f.fields.get("[data-batch-brochure-title]").value = "修改后的批次简章";
      f.editors.get("报名手续").value = "独立报名规则";
      const batch = f.context.batchFormSnapshot(action);
      assert.equal(batch.brochureId, "BR-2026-001");
      assert.equal(batch.brochureName, "修改后的批次简章");
      assert.equal(batch.brochureSnapshot.sectionContents["报名手续"], "独立报名规则");
      assert.notEqual(batch.brochureSnapshot, f.root.__batchBrochureDraft);
      f.context.BROCHURE_DATA[0].sectionContents["考级对象"] = "新版平台对象";
      f.root.editId = batch.id;
      f.context.hydrateBatchCreateForm();
      assert.equal(f.fields.get("[data-batch-brochure-title]").value, "修改后的批次简章");
      assert.equal(f.editors.get("报名手续").value, "独立报名规则");
      assert.notEqual(f.editors.get("考级对象").value, "新版平台对象");
      const detail = f.context.batchBrochureDetailBodyHtml(batch);
      assert.ok(detail.includes("独立报名规则"));
      assert.ok(!detail.includes("新版平台对象"));
    }
  }
});

test("unavailable historical sources never silently switch to the default template", () => {
  const f = fixture();
  const batch = f.context.batchFormSnapshot("draft");
  f.root.editId = batch.id;
  f.context.BROCHURE_DATA[0].publishStatus = "未发布";
  f.context.BROCHURE_DATA.push({ ...plain(f.context.BROCHURE_DATA[0]), id: "another-published", publishStatus: "已发布" });
  f.checks.splice(0, 1, { value: "another-published", checked: true, closest: () => null });
  f.context.hydrateBatchCreateForm();
  assert.equal(f.checks.some(input => input.checked), false);
  assert.equal(f.context.batchBrochureValidationResult(f.root, "draft").ok, false);
  assert.equal(f.root.__batchBrochureDraft.brochureId, batch.brochureId);
});
