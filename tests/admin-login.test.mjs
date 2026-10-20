import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("    var AUTH_DEMO_ACCOUNTS ="), html.indexOf("    function authRouteKey("));

function fixture() {
  const fields = {};
  function element() {
    return { value: "", disabled: false, textContent: "", hidden: false, focus() {}, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } };
  }
  for (const name of ["account", "password", "phone", "code", "send-code", "tip", "role-value", "form"]) {
    fields[`[data-login-${name}]`] = element();
  }
  for (const name of ["phone", "code", "send-code", "verified-phone", "password", "confirm", "error", "form", "back", "submit"]) {
    fields[`[data-reset-${name}]`] = element();
  }
  for (const selector of ["#auth-title", ".auth-description", ".auth-context", "[data-forgot-password]"]) {
    fields[selector] = element();
  }
  const panels = ["password", "sms"].map((method) => ({
    hidden: method === "sms",
    getAttribute: () => method,
    querySelectorAll: () => (method === "sms" ? [fields["[data-login-phone]"], fields["[data-login-code]"], fields["[data-login-send-code]"]] : [fields["[data-login-account]"], fields["[data-login-password]"]])
  }));
  const tabs = ["password", "sms"].map((method) => ({
    getAttribute: () => method,
    setAttribute(name, value) { this[name] = value; }
  }));
  const recoveryPanels = ["verify", "password"].map((step) => ({
    hidden: step === "password",
    getAttribute: () => step,
    querySelectorAll: () => (step === "verify" ? ["phone", "code", "send-code"] : ["verified-phone", "password", "confirm"]).map((name) => fields[`[data-reset-${name}]`])
  }));
  const recoveryProgress = ["verify", "password"].map((step) => ({ ...element(), getAttribute: () => step }));
  const intervals = new Map();
  let now = 1000000;
  let timer = 0;
  const context = vm.createContext({
    Date: { now: () => now },
    document: {
      querySelector: (selector) => fields[selector] || null,
      querySelectorAll: (selector) => ({ "[data-login-panel]": panels, "[data-login-method]": tabs, "[data-reset-step]": recoveryPanels, "[data-reset-progress]": recoveryProgress })[selector] || []
    },
    setInterval: (callback) => { intervals.set(++timer, callback); return timer; },
    clearInterval: (id) => intervals.delete(id),
    authSetError: (message) => { context.error = message; },
    toast: (message) => { context.message = message; },
    authLogin: (role, account) => { context.authResetSms(); context.login = { role, account }; }
  });
  vm.runInContext(source, context);
  return {
    context, panels, tabs, intervals, recoveryPanels,
    form: { querySelector: (selector) => fields[selector] },
    field: (name) => fields[`[data-login-${name}]`],
    resetField: (name) => fields[`[data-reset-${name}]`],
    advance(ms) { now += ms; for (const callback of intervals.values()) callback(); }
  };
}

test("all inline scripts parse", () => {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!match[1].includes("src=")) new vm.Script(match[2]);
  }
});

test("password login accepts account or linked phone and preserves canonical identity for all roles", () => {
  const f = fixture();
  for (const user of Object.values(f.context.AUTH_DEMO_ACCOUNTS)) {
    for (const identifier of [user.account.toUpperCase(), user.phone]) {
      f.field("account").value = ` ${identifier} `;
      f.field("password").value = "123456";
      f.context.authSubmitLogin(f.form);
      assert.equal(f.context.login.role, user.role);
      assert.equal(f.context.login.account, user.account);
    }
  }
});

test("password login rejects empty fields, unknown identifiers and wrong passwords", () => {
  const f = fixture();
  for (const [identifier, password, error] of [["", "", "请输入"], ["missing", "123456", "不存在"], ["13800000001", "bad", "密码错误"]]) {
    f.field("account").value = identifier;
    f.field("password").value = password;
    f.context.authSubmitLogin(f.form);
    assert.ok(f.context.error.includes(error));
    assert.equal(f.context.login, undefined);
  }
});

test("method tabs disable inactive inputs without resetting the resend limit", () => {
  const f = fixture();
  f.context.authSelectMethod("sms");
  assert.equal(f.panels[0].hidden, true);
  assert.equal(f.field("password").disabled, true);
  assert.equal(f.field("phone").disabled, false);
  assert.equal(f.tabs[1]["aria-selected"], "true");
  f.field("phone").value = "13800000001";
  f.context.authSendCode();
  f.context.authSelectMethod("password");
  f.context.authSelectMethod("sms");
  assert.equal(f.field("send-code").disabled, true);
});

test("SMS requests reject malformed and unbound phone numbers", () => {
  const f = fixture();
  f.context.authSelectMethod("sms");
  for (const [phone, error] of [["123", "11位"], ["13800000009", "未绑定"]]) {
    f.field("phone").value = phone;
    f.context.authSendCode();
    assert.ok(f.context.error.includes(error));
    assert.equal(f.context.AUTH_SMS_CHALLENGE, null);
    assert.equal(f.intervals.size, 0);
  }
});

test("SMS requests use a 60-second cooldown and a five-minute validity period", () => {
  const f = fixture();
  f.context.authSelectMethod("sms");
  f.field("phone").value = "13800000001";
  f.context.authSendCode();
  const first = f.context.AUTH_SMS_CHALLENGE;
  assert.equal(first.expiresAt - first.resendAt, 240000);
  assert.equal(f.field("send-code").textContent, "60秒后重新获取");
  f.context.authSendCode();
  assert.equal(f.context.AUTH_SMS_CHALLENGE, first);
  f.advance(60000);
  assert.equal(f.field("send-code").disabled, false);
  assert.equal(f.intervals.size, 0);
  f.context.authSendCode();
  assert.notEqual(f.context.AUTH_SMS_CHALLENGE, first);
  assert.equal(f.intervals.size, 1);
});

test("SMS login requires a requested matching code and rejects expired codes", () => {
  const f = fixture();
  f.context.authSelectMethod("sms");
  f.field("phone").value = "13800000001";
  f.field("code").value = "12";
  f.context.authSubmitLogin(f.form);
  assert.ok(f.context.error.includes("6位"));
  f.field("code").value = "123456";
  f.context.authSubmitLogin(f.form);
  assert.ok(f.context.error.includes("请先获取"));
  f.context.authSendCode();
  f.field("code").value = "000000";
  f.context.authSubmitLogin(f.form);
  assert.ok(f.context.error.includes("验证码错误"));
  f.field("phone").value = "13800000002";
  f.field("code").value = "123456";
  f.context.authSubmitLogin(f.form);
  assert.ok(f.context.error.includes("当前手机号"));
  f.field("phone").value = "13800000001";
  f.advance(300000);
  f.context.authSubmitLogin(f.form);
  assert.ok(f.context.error.includes("已过期"));
  assert.equal(f.context.login, undefined);
});

test("SMS login resolves all three roles from their bound phone and clears the challenge", () => {
  for (const phone of ["13800000001", "13800000002", "13800000003"]) {
    const f = fixture();
    const user = f.context.authDemoAccount(phone);
    f.context.authSelectMethod("sms");
    f.field("phone").value = phone;
    f.context.authSendCode();
    f.field("code").value = "123456";
    f.context.authSubmitLogin(f.form);
    assert.equal(f.context.login.role, user.role);
    assert.equal(f.context.login.account, user.account);
    assert.equal(f.context.AUTH_SMS_CHALLENGE, null);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.field("code").value, "");
  }
});

test("role selection prefills the same identity for both login methods", () => {
  const f = fixture();
  for (const user of Object.values(f.context.AUTH_DEMO_ACCOUNTS)) {
    f.context.authSelectRole(user.role, true);
    assert.equal(f.field("account").value, user.account);
    assert.equal(f.field("phone").value, user.phone);
    assert.equal(f.field("password").value, user.password);
  }
});

function verifyRecovery(f, phone = "13800000001") {
  f.field("account").value = phone;
  f.context.authRecoveryShow(true);
  assert.equal(f.resetField("phone").value, phone);
  f.context.authRecoverySendCode();
  f.resetField("code").value = "123456";
  f.context.authSubmitRecovery(f.form);
  assert.equal(f.context.AUTH_RECOVERY.step, "password");
}

test("recovery validates phone, requested code, matching phone and expired code", () => {
  const f = fixture();
  f.context.authRecoveryShow(true);
  for (const [phone, error] of [["123", "11位"], ["13800000009", "未绑定"]]) {
    f.resetField("phone").value = phone;
    f.context.authRecoverySendCode();
    assert.ok(f.resetField("error").textContent.includes(error));
    assert.equal(f.context.AUTH_RECOVERY.challenge, null);
  }
  f.resetField("phone").value = "13800000001";
  f.resetField("code").value = "123456";
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("请先获取"));
  f.context.authRecoverySendCode();
  f.resetField("code").value = "000000";
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("验证码错误"));
  f.resetField("phone").value = "13800000002";
  f.resetField("code").value = "123456";
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("当前手机号"));
  f.resetField("phone").value = "13800000001";
  f.advance(300000);
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("已过期"));
  assert.equal(f.context.AUTH_RECOVERY.step, "verify");
});

test("recovery resend cooldown lasts 60 seconds and cancellation clears challenge and fields", () => {
  const f = fixture();
  f.field("account").value = "admin";
  f.context.authRecoveryShow(true);
  f.context.authRecoverySendCode();
  const first = f.context.AUTH_RECOVERY.challenge;
  assert.equal(f.resetField("send-code").textContent, "60秒后重新获取");
  f.context.authRecoverySendCode();
  assert.equal(f.context.AUTH_RECOVERY.challenge, first);
  f.advance(60000);
  assert.equal(f.resetField("send-code").disabled, false);
  f.context.authRecoverySendCode();
  assert.notEqual(f.context.AUTH_RECOVERY.challenge, first);
  assert.equal(f.intervals.size, 1);
  f.context.authRecoveryShow(false);
  assert.equal(f.context.AUTH_RECOVERY.challenge, null);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.resetField("form").hidden, true);
  assert.equal(f.field("form").hidden, false);
  assert.equal(f.resetField("phone").value, "");
  assert.equal(f.context.AUTH_DEMO_ACCOUNTS.admin.password, "123456");
});

test("login and recovery codes cannot be substituted across purposes", () => {
  const f = fixture();
  f.context.authSelectMethod("sms");
  f.field("phone").value = "13800000001";
  f.context.authSendCode();
  f.context.authRecoveryShow(true);
  assert.equal(f.context.AUTH_SMS_CHALLENGE, null);
  f.resetField("code").value = "123456";
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("请先获取"));
  f.context.authRecoverySendCode();
  f.context.authRecoveryShow(false);
  f.context.authSelectMethod("sms");
  f.field("code").value = "123456";
  f.context.authSubmitLogin(f.form);
  assert.ok(f.context.error.includes("请先获取"));
});

test("verified recovery consumes the SMS code and checks password strength and confirmation", () => {
  const f = fixture();
  verifyRecovery(f);
  assert.equal(f.context.AUTH_RECOVERY.challenge, null);
  assert.equal(f.resetField("phone").disabled, true);
  assert.equal(f.resetField("password").disabled, false);
  for (const password of ["", "12345678", "abcdefgh", "Abc123", "Abcd 1234", "Abc12345678901234567890"]) {
    f.resetField("password").value = password;
    f.resetField("confirm").value = password;
    f.context.authSubmitRecovery(f.form);
    assert.ok(f.resetField("error").textContent.includes("8-20位"));
  }
  f.resetField("password").value = "DemoPass2026";
  f.resetField("confirm").value = "OtherPass2026";
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("不一致"));
  assert.equal(f.context.AUTH_DEMO_ACCOUNTS.admin.password, "123456");
});

test("expired identity verification cannot reset a password", () => {
  const f = fixture();
  verifyRecovery(f);
  f.advance(300000);
  f.resetField("password").value = "DemoPass2026";
  f.resetField("confirm").value = "DemoPass2026";
  f.context.authSubmitRecovery(f.form);
  assert.ok(f.resetField("error").textContent.includes("身份验证已过期"));
  assert.equal(f.context.AUTH_RECOVERY.step, "verify");
  assert.equal(f.context.AUTH_RECOVERY.account, "");
  assert.equal(f.resetField("password").value, "");
  assert.equal(f.context.AUTH_DEMO_ACCOUNTS.admin.password, "123456");
});

test("all roles can reset their in-memory demo password and log in only with the new password", () => {
  for (const name of ["admin", "cbdw", "pxjg"]) {
    const f = fixture();
    const user = f.context.AUTH_DEMO_ACCOUNTS[name];
    verifyRecovery(f, user.phone);
    f.resetField("password").value = "DemoPass2026";
    f.resetField("confirm").value = "DemoPass2026";
    f.context.authSubmitRecovery(f.form);
    assert.equal(user.password, "DemoPass2026");
    assert.equal(f.context.AUTH_RECOVERY.open, false);
    assert.equal(f.context.AUTH_RECOVERY.account, "");
    assert.equal(f.context.login, undefined);
    assert.equal(f.field("password").value, "");
    assert.equal(f.resetField("password").value, "");
    assert.ok(!f.field("tip").textContent.includes("DemoPass2026"));
    f.field("password").value = "123456";
    f.context.authSubmitLogin(f.form);
    assert.ok(f.context.error.includes("重置后的新密码"));
    assert.equal(f.context.login, undefined);
    f.field("password").value = "DemoPass2026";
    f.context.authSubmitLogin(f.form);
    assert.equal(f.context.login.account, name);
    assert.equal(f.context.login.role, user.role);
    for (const other of Object.values(f.context.AUTH_DEMO_ACCOUNTS)) {
      if (other.account !== name) assert.equal(other.password, "123456");
    }
    assert.equal(fixture().context.AUTH_DEMO_ACCOUNTS[name].password, "123456");
  }
});
