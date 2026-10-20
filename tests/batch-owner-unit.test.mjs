import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const source = [
  between("    var AUTH_ROLE_CONFIG =", "    var AUTH_DEMO_ACCOUNTS ="),
  between("    function roleOrganizationDataScope(", "    function organizerAllowedOrgNames("),
  between("    function batchOwnerUnits(", "    function batchCreateBasicHtml("),
  between("    function batchValidationResult(", "    function batchGetCoverImage("),
  between("    function batchFormSnapshot(", "    function hydrateBatchCreateForm(")
].join("\n");

function fixture(role = "platform") {
  const units = [
    { id: "platform", name: "湖北艺术职业学院", type: "平台" },
    { id: "org-wh", parent: "platform", name: "武汉承办中心", type: "承办单位" },
    { id: "inst-guanggu", parent: "org-wh", name: "光谷少儿艺术中心", type: "培训机构" },
    { id: "org-yc", parent: "platform", name: "宜昌承办中心", type: "承办单位" },
    { id: "inst-yc", parent: "org-yc", name: "宜昌青少年美育中心", type: "培训机构" },
    { id: "inst-direct", parent: "platform", name: "省直属培训点", type: "培训机构" }
  ];
  const fields = new Map();
  for (const [name, value] of Object.entries({ name: "归属验证批次", org: "platform", remark: "" })) {
    fields.set(`[data-batch-form-${name}]`, { value });
  }
  fields.set("[data-batch-exam-mode]", { value: "offline" });
  fields.set("[data-batch-online-submit-days]", { value: "15" });
  fields.set("[data-batch-contact-name]", { value: "周老师" });
  fields.set("[data-batch-contact-phone]", { value: "027-87561234" });
  const brochure = {
    disabled: false,
    closest: () => ({ textContent: "原型简章 已发布", getAttribute: () => "原型简章" })
  };
  const root = {
    editId: "",
    querySelector: (selector) => selector === "[data-batch-brochure-check]:checked" ? brochure : fields.get(selector) || null,
    querySelectorAll(selector) {
      if (selector === "[data-batch-brochure-check]:checked") return [brochure];
      if (selector.includes('data-batch-picker="site"')) return [{ closest: () => ({ querySelector: () => ({ textContent: "光谷考点" }) }) }];
      if (selector.includes("data-batch-picker")) return [{}];
      return [];
    },
    getAttribute: () => root.editId
  };
  const context = vm.createContext({
    AUTH_SESSION: { role },
    document: { querySelectorAll: () => units.map((unit) => ({ getAttribute: (name) => unit[name.replace("data-unit-", "")] || "" })) },
    authRoleConfig: (name) => context.AUTH_ROLE_CONFIG[name] || context.AUTH_ROLE_CONFIG.platform,
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    batchCreateRoot: () => root,
    batchDateTimeFieldValues: (_root, prefix) => ({ date: prefix.startsWith("enroll") ? "20261020" : "20261021", time: "090000" }),
    batchDateTimeFieldDisplay: () => "2026-10-20 09:00:00",
    batchReadOrgFeeConfig: () => [],
    batchGetCoverImage: () => null,
    batchOnlineSubmitRuleText: (days) => `缴费后${days}日内提交`,
    BATCH_DEMO_LIST: [],
    batchById: (id) => context.BATCH_DEMO_LIST.find((batch) => batch.id === id)
  });
  vm.runInContext(source, context);
  context.AUTH_SESSION.orgId = context.AUTH_ROLE_CONFIG[role].orgId;
  fields.get("[data-batch-form-org]").value = context.AUTH_SESSION.orgId;
  return { context, units, root, fields, owner: fields.get("[data-batch-form-org]") };
}

const ownerIds = (f) => Array.from(f.context.batchOwnerUnits(), (unit) => unit.id);

test("platform may select itself, organizers and training organizations", () => {
  const f = fixture();
  assert.deepEqual(ownerIds(f), f.units.map((unit) => unit.id));
  const options = f.context.batchOwnerOptionsHtml();
  for (const type of ["平台", "承办单位", "培训机构"]) assert.ok(options.includes(`<optgroup label="${type}">`));
  assert.ok(options.includes('<option value="platform" selected>湖北艺术职业学院</option>'));
});

test("organizer cannot select its parent, peers or unrelated training organizations", () => {
  const f = fixture("organizer");
  assert.deepEqual(ownerIds(f), ["org-wh", "inst-guanggu"]);
  const options = f.context.batchOwnerOptionsHtml();
  assert.ok(!options.includes('value="platform"'));
  assert.ok(!options.includes('value="org-yc"'));
  assert.ok(!options.includes('value="inst-direct"'));
  assert.ok(options.includes('<option value="org-wh" selected>'));
});

test("training organization can select only itself and actual descendants", () => {
  const f = fixture("training");
  assert.deepEqual(ownerIds(f), ["inst-guanggu"]);
  f.units.push({ id: "branch", parent: "inst-guanggu", name: "下级培训点", type: "培训机构" });
  assert.deepEqual(ownerIds(f), ["inst-guanggu", "branch"]);
  assert.ok(!f.context.AUTH_ROLE_CONFIG.training.routes.includes("plans/batch-create"));
});

test("scope uses the session organization ID and follows the full hierarchy", () => {
  const f = fixture("organizer");
  f.context.AUTH_SESSION.orgId = "org-yc";
  assert.deepEqual(ownerIds(f), ["org-yc", "inst-yc"]);
  f.units.push({ id: "dept", parent: "inst-yc", name: "教务部", type: "部门" });
  f.units.push({ id: "branch", parent: "dept", name: "下级培训点", type: "培训机构" });
  assert.deepEqual(ownerIds(f), ["org-yc", "inst-yc", "branch"]);
});

test("missing organization fails closed and options escape organization names", () => {
  const f = fixture();
  f.context.AUTH_SESSION.orgId = "missing";
  assert.deepEqual(ownerIds(f), []);
  f.context.AUTH_SESSION.orgId = "platform";
  f.units[0].name = '<平台 "A"> &';
  assert.ok(f.context.batchOwnerOptionsHtml().includes('&lt;平台 &quot;A&quot;&gt; &amp;'));
});

test("selected owner is resolved by ID and rejects blank, unknown and out-of-scope units", () => {
  const f = fixture("organizer");
  for (const value of ["", "missing", "platform", "org-yc", "inst-yc", "inst-direct", "武汉承办中心"]) {
    f.owner.value = value;
    assert.equal(f.context.batchSelectedOwnerUnit(f.root), null);
  }
  f.owner.value = "inst-guanggu";
  assert.equal(f.context.batchSelectedOwnerUnit(f.root).name, "光谷少儿艺术中心");
});

test("editing restores IDs and legacy names without silently changing an invalid owner", () => {
  const f = fixture("organizer");
  for (const [batch, expected] of [
    [{ ownerOrgId: "inst-guanggu", org: "旧名称" }, "inst-guanggu"],
    [{ org: "武汉承办中心" }, "org-wh"],
    [{ org: "光谷少儿艺术中心" }, "inst-guanggu"],
    [{ ownerOrgId: "org-yc", org: "武汉承办中心" }, ""],
    [{ org: "湖北艺术职业学院" }, ""],
    [{ org: "已移除单位" }, ""]
  ]) {
    f.context.batchHydrateOwnerUnit(f.root, batch);
    assert.equal(f.owner.value, expected);
  }
});

test("all save actions validate owner scope for online and offline plans", () => {
  const f = fixture("organizer");
  for (const mode of ["offline", "online"]) {
    f.fields.get("[data-batch-exam-mode]").value = mode;
    for (const action of ["draft", "submit-review", "publish"]) {
      for (const owner of ["", "platform", "org-yc", "inst-direct", "unknown"]) {
        f.owner.value = owner;
        const result = f.context.batchValidationResult(f.root, action);
        assert.equal(result.ok, false);
        assert.ok(result.message.includes("本单位或下级单位"));
      }
      for (const owner of ["org-wh", "inst-guanggu"]) {
        f.owner.value = owner;
        assert.equal(f.context.batchValidationResult(f.root, action).ok, true);
      }
    }
  }
});

test("saving persists selected identity and type while retaining the legacy org name", () => {
  const f = fixture();
  for (const mode of ["offline", "online"]) {
    f.fields.get("[data-batch-exam-mode]").value = mode;
    for (const unit of f.units) {
      f.owner.value = unit.id;
      const batch = f.context.batchFormSnapshot("draft");
      assert.equal(batch.org, unit.name);
      assert.equal(batch.ownerOrgId, unit.id);
      assert.equal(batch.ownerOrgType, unit.type);
      assert.equal(batch.examMode, mode === "online" ? "线上考试" : "线下考试");
    }
  }
});

test("invalid owner cannot create or modify a batch snapshot", () => {
  const f = fixture("organizer");
  const batch = { id: "existing", org: "武汉承办中心", name: "原批次" };
  f.context.BATCH_DEMO_LIST.push(batch);
  f.root.editId = batch.id;
  f.owner.value = "platform";
  assert.equal(f.context.batchFormSnapshot("draft"), null);
  assert.equal(batch.name, "原批次");
  assert.equal(f.context.BATCH_DEMO_LIST.length, 1);
  f.owner.value = "inst-guanggu";
  f.context.batchFormSnapshot("draft");
  assert.equal(batch.ownerOrgId, "inst-guanggu");
  assert.equal(f.context.BATCH_DEMO_LIST.length, 1);
});

test("contact fields have associated labels, required semantics and existing limits", () => {
  const basicHtml = between("    function batchCreateBasicHtml(", "    function batchCreatePageBodyHtml(");
  for (const [key, label, limit] of [["name", "联系人", 20], ["phone", "联系方式", 30]]) {
    assert.ok(basicHtml.includes(`<label for="batch-contact-${key}">${label} *</label>`));
    const input = basicHtml.match(new RegExp(`<input[^>]*id="batch-contact-${key}"[^>]*>`))[0];
    assert.match(input, /\srequired(?=[\s>])/);
    assert.ok(input.includes(`maxlength="${limit}"`));
  }
});

test("all save actions require both contacts for online and offline plans", () => {
  for (const mode of ["offline", "online"]) {
    for (const action of ["draft", "submit-review", "publish"]) {
      for (const [key, label] of [["name", "联系人"], ["phone", "联系方式"]]) {
        for (const value of ["", "   ", "\t\n", null]) {
          const f = fixture();
          f.fields.get("[data-batch-exam-mode]").value = mode;
          const selector = `[data-batch-contact-${key}]`;
          if (value === null) f.fields.delete(selector);
          else f.fields.get(selector).value = value;
          const result = f.context.batchValidationResult(f.root, action);
          assert.equal(result.ok, false, `${mode}/${action}/${key}/${JSON.stringify(value)}`);
          assert.equal(result.message, `请填写${label}`);
        }
      }
    }
  }
});

test("valid contacts accept mobile and landline numbers without changing length limits", () => {
  const f = fixture();
  const name = f.fields.get("[data-batch-contact-name]");
  const phone = f.fields.get("[data-batch-contact-phone]");
  name.value = "联".repeat(20);
  for (const mode of ["offline", "online"]) {
    f.fields.get("[data-batch-exam-mode]").value = mode;
    for (const action of ["draft", "submit-review", "publish"]) {
      for (const number of ["13800000000", "027-87561234", "1".repeat(30)]) {
        phone.value = number;
        assert.equal(f.context.batchValidationResult(f.root, action).ok, true);
      }
    }
  }
  name.value += "人";
  assert.equal(f.context.batchValidationResult(f.root, "draft").message, "联系人最多20个字符");
  name.value = "周老师";
  phone.value = "1".repeat(31);
  assert.equal(f.context.batchValidationResult(f.root, "draft").message, "联系方式最多30个字符");
});
