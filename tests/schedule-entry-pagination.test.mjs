import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../current/admin/index.html", import.meta.url), "utf8");
const start = html.indexOf("    var PAGINATION_DEFAULT_SIZE =");
const source = html.slice(start, html.indexOf("    function refreshAllPagination()", start));

function fixture(grouping = true, total = 31) {
  const rows = Array.from({ length: total }, () => {
    const classes = new Set();
    return { tagName: "TR", hidden: false, checked: false, classes,
      hasAttribute: () => false, querySelector: () => null,
      classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name), remove: name => classes.delete(name) }
    };
  });
  const pager = { matches: () => true, outerHTML: "", getAttribute: () => (pager.outerHTML.match(/data-pagination-render-key="([^"]+)"/) || [])[1] || null };
  const table = { parentElement: { matches: () => true, nextElementSibling: pager }, tBodies: [{ children: rows }], closest: () => grouping ? {} : null };
  const c = vm.createContext({});
  vm.runInContext(source, c);
  const visible = () => rows.filter(row => !row.classes.has("pagination-page-hidden"));
  return { c, table, rows, pager, visible };
}

test("entry grouping lists default to ten rows and four pages for 31 candidates", () => {
  const f = fixture(); f.c.paginationTable(f.table);
  assert.equal(f.visible().length, 10);
  assert.equal(f.c.paginationStates.get(f.table).pageSize, 10);
  assert.match(f.pager.outerHTML, /value="10" selected/);
  assert.match(f.pager.outerHTML, /data-pagination-page="4"/);
});

test("turning pages preserves checked candidates and leaves one candidate on the last page", () => {
  const f = fixture(); f.c.paginationTable(f.table); f.rows[0].checked = true;
  f.c.paginationStates.get(f.table).page = 2; f.c.paginationTable(f.table);
  assert.equal(f.visible().length, 10); assert.equal(f.visible()[0], f.rows[10]);
  f.rows[10].checked = true;
  f.c.paginationStates.get(f.table).page = 4; f.c.paginationTable(f.table);
  assert.equal(f.visible().length, 1);
  assert.equal(f.rows.filter(row => row.checked).length, 2);
});

test("chosen page size survives pagination refresh and empty lists retain one page", () => {
  const f = fixture(); f.c.paginationTable(f.table);
  f.c.paginationStates.get(f.table).pageSize = 20; f.c.paginationTable(f.table);
  assert.equal(f.visible().length, 20);
  const empty = fixture(true, 0); empty.c.paginationTable(empty.table);
  assert.equal(empty.c.paginationStates.get(empty.table).page, 1);
});

test("other admin tables keep their twenty-row default", () => {
  const f = fixture(false); f.c.paginationTable(f.table);
  assert.equal(f.visible().length, 20);
  assert.match(f.pager.outerHTML, /value="20" selected/);
});

test("unchanged pagination does not repeatedly replace controls after DOM normalization", () => {
  const f = fixture(); f.c.paginationTable(f.table);
  f.pager.outerHTML += " ";
  const rendered = f.pager.outerHTML;
  f.c.paginationTable(f.table);
  assert.equal(f.pager.outerHTML, rendered);
  f.c.paginationStates.get(f.table).page = 2;
  f.c.paginationTable(f.table);
  assert.match(f.pager.outerHTML, /data-pagination-render-key="4:2:10"/);
});
