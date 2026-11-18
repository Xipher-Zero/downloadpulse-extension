// SPDX-License-Identifier: GPL-2.0-or-later
// The real-DownloadPulse onboarding run (test/real), outside ``npm test``.
import {defineConfig} from "@playwright/test";

export default defineConfig({testDir: "test/real", testMatch: /.*\.spec\.mjs/, workers: 1, retries: 0,
  timeout: 120_000, reporter: [["line"]]});
