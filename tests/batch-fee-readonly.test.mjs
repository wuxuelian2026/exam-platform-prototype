import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const admin = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const student = fs.readFileSync(new URL("../current/student/index.html", import.meta.url), "utf8");

test("batch fee rows render amounts without editors or save paths", () => {
  const start = admin.indexOf("    function batchOrgFeeConfigRowsHtml(");
  const end = admin.indexOf("    function syncBatchOrgFeeConfig(", start);
  const root = { matches: () => true };
  const fee = { enroll: 200, exam: 80, cert: 40, total: 320 };
  const context = vm.createContext({
    window: { __activeBatchFeeOrg: "测试机构" },
    escapeHtml: String,
    batchCreateRoot: () => root,
    batchEnsureOrgFeeConfig: () => [],
    batchFeeConfigKey: () => "key",
    batchFeePreset: () => fee,
    batchOrgFeeConfigEntries: () => ({ orgs: [{ name: "测试机构" }], executions: [{ category: "舞蹈类", group: "舞蹈类 / 中国舞", name: "中国舞", level: "3级", levelCode: "LEVEL_03" }] }),
    levelCodeFromName: () => "LEVEL_03"
  });
  vm.runInContext(admin.slice(start, end), context);
  const html = context.batchOrgFeeConfigDrawerHtml();
  assert.match(html, /¥320/);
  assert.match(html, /只读/);
  assert.match(html, /线下结算/);
  assert.doesNotMatch(html, /<input|<select|<textarea/);
  assert.doesNotMatch(admin, /data-batch-org-fee-save|data-batch-org-fee-input|function batchSaveOrgFeeConfig/);
});

test("exam student displays do not expose fee amounts on key surfaces", () => {
  assert.doesNotMatch(student, /报名费用：\d|data-level-price>|data-application-fee>¥|金额 ¥320/);
  assert.doesNotMatch(student, /rows.push\(\{ label: "考试费用"/);
  assert.match(student, /if \(feeEl\) feeEl.remove\(\)/);
  assert.match(student, /if \(fee\) fee.textContent = "线下办理"/);
});

test("single and batch settlement confirmation explain offline transfer prerequisite", () => {
  for (const name of ["paymentConfirmBodyHtml", "paymentBatchConfirmBodyHtml"]) {
    const start = admin.indexOf("    function " + name + "()");
    const end = admin.indexOf("\n    function ", start + 10);
    assert.match(admin.slice(start, end), /线下转账至平台后，再确认缴费/);
  }
});
