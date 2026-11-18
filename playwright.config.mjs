// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/smoke",
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["line"]],
});
