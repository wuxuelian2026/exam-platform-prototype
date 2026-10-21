import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cockpit = fs.readFileSync(path.join(root, "current/admin/exam-dashboard-cockpit.html"), "utf8");

test("exam cockpit exposes a top-right year selector", () => {
  assert.match(cockpit, /data-year-picker/);
  assert.match(cockpit, /统计年度/);
  assert.match(cockpit, /YEAR_SEEDS\.map/);
});

test("exam cockpit refreshes selected-year data and resets map drilldown", () => {
  assert.match(cockpit, /selectedYear=year/);
  assert.match(cockpit, /current=facts\.filter\(function\(r\)\{return r\.year===selectedYear;\}\)/);
  assert.match(cockpit, /heatState\.path=\[\]/);
  assert.match(cockpit, /selectedYear===SNAPSHOT_YEAR\s*\?\s*SNAPSHOT_MONTH\s*:\s*12/);
  assert.match(cockpit, /data-month-title/);
});

test("exam cockpit renders top ten rankings with automatic scrolling viewports", () => {
  assert.match(cockpit, /slice\(0,10\)/);
  assert.match(cockpit, /data-major-scroll/);
  assert.match(cockpit, /data-organizer-scroll/);
  assert.match(cockpit, /data-training-scroll/);
  assert.match(cockpit, /setInterval\(tick,70\)/);
  assert.match(cockpit, /mouseenter.*paused=true/);
});
