// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {forgetTab, PAGE_SENDS, PAGE_SINGLES, pageSend, pageSingles} from "../../src/background/page-sends";

test("a tab's pages send at most PAGE_SENDS times a minute; other tabs and the next minute are their own", () => {
  const start = 1_000_000;
  for (let index = 0; index < PAGE_SENDS; index += 1) assert.equal(pageSend(1, start + index), true);
  assert.equal(pageSend(1, start + 100), false);
  assert.equal(pageSend(2, start + 100), true);
  assert.equal(pageSend(1, start + 60_000), true);   // the first sends have left the minute
  forgetTab(1);
  forgetTab(2);
});

test("separate jobs from a tab's pages share one allowance a minute, however many sends ask for them", () => {
  const start = 2_000_000;
  assert.equal(pageSingles(3, PAGE_SINGLES - 20, start), PAGE_SINGLES - 20);
  assert.equal(pageSingles(3, 80, start + 1), 20);   // what is left, not another 80
  assert.equal(pageSingles(3, 1, start + 2), 0);
  // Separate jobs taken are not presses: the sends still have their own count.
  assert.equal(pageSend(3, start + 3), true);
  assert.equal(pageSingles(3, 5, start + 60_001), 5);
  forgetTab(3);
});
