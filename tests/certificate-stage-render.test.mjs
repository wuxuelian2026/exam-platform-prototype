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

test("certificate stage resets filters when the selected batch changes", () => {
  const source = implementation("enhanceCertificatesWorkbenchPanel");
  assert.match(source, /data-cert-rendered-batch/);
  assert.match(source, /filterCertificateBatchRows\(workbench, batchChanged, false\)/);
});

test("certificate stage rebuilds an empty embedded panel even when the batch id is cached", () => {
  const calls = [];
  const panel = {
    dataset: { embeddedSource: "certificates:batch-demo-16" },
    classList: { contains: () => true },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    currentBatchContext: () => ({ id: "batch-demo-16" }),
    embedBatchWorkbenchPanel: (target) => calls.push(target.dataset.embeddedSource),
    switchEmbeddedCertificatesTab: () => {},
    enhanceCertificatesWorkbenchPanel: () => {},
    ensureCertificatesWorkbenchVisible: () => calls.push("visible")
  });
  vm.runInContext(implementation("embedCertificatesWorkbenchPanel"), context);
  context.embedCertificatesWorkbenchPanel(panel);
  assert.deepEqual(calls, ["", "visible"]);
});

test("certificate stage restores list visibility after rendering", () => {
  const source = implementation("ensureCertificatesWorkbenchVisible");
  assert.match(source, /listView\.hidden = false/);
  assert.match(source, /workbench\.hidden = false/);
  assert.match(implementation("embedCertificatesWorkbenchPanel"), /ensureCertificatesWorkbenchVisible\(panel\)/);
});
