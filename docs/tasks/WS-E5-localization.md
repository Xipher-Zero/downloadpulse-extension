# WS-E5 — The extension in DownloadPulse's 19 languages

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9).

**Repository:** `Xipher-Zero/downloadpulse-extension`, base `37dcf4d`.

**Authority:**
- PLAN.md §8, and decisions L21 and D5;
- *Prompt Authoring and Gates* §4.7;
- DebridPulse `docs/LOCALIZATION.md` (its discipline, mirrored here).

## 1. Decisions

- **D5 (resolved at this task, per the plan's recommendation, under the operator's "Proceed"):** the extension owns its catalogs in the browsers' native format (`_locales/<folder>/messages.json`). They are held to DebridPulse's discipline, and where the extension names DownloadPulse's own interface it uses DownloadPulse's own translation:
  - Quick Add (`quick_add.title`);
  - Local Network Connections (`settings.downloads.lan`);
  - My Account (`account.title`);
  - Connected browsers (`account.browsers.title`);
  - the Connected-browsers feature's words (`browser.pairing.*`, `account.browsers.*`);
  - and each language's termbase.
- **Locales:** `ar de es fr hi id it ja ko nl pl pt_BR pt_PT ru tr uk zh_CN zh_TW` (DebridPulse tags in `i18n/locales.json`; `zh_CN` = zh-Hans, `zh_TW` = zh-Hant).
- **The validator** (`scripts/check-locales.mjs`, part of `npm run check`) fails on any of:
  - a missing key;
  - differing placeholders;
  - a translation left in English (unless recorded);
  - a translation not made from the current English (`i18n/sources`, sha256[:16]);
  - no current review (`i18n/review`);
  - a critical key without a back-translation.
- **Critical keys:**
  - the code-match warning (`popupCodeHint`);
  - the certificate advice (`failureCertificate`);
  - both Disconnect consequences (`optionsDisconnectHint`, `optionsDisconnectedLocally`).

## 2. Process

Translation, then an independent review by different agents, then a blind back-translation of the critical keys (target text only, under neutral IDs), compared with the English by this task's author. The provenance (`ai-generated`, `ai-review`, `ai-back-translation`) is recorded in `i18n/review`. **No human review is claimed.**

## 3. Gate record

**English corrected during review** (the reviewers found where the English didn't name DownloadPulse's real buttons):
- `popupWaiting` / `popupCodeHint`: "approve" → **"choose Connect"** (DebridPulse `browser.pairing.approve`);
- `optionsDisconnectedLocally`: "Remove this browser" → **"Disconnect this browser"** (`account.browsers.disconnect`).

Those three keys were then retranslated in all 18 locales with each catalog's exact labels, and independently reviewed (18/18 OK).

**Process results:**

| Step | Result |
|---|---|
| Translation (3 agents, 6 locales each) | 18 × 95 keys |
| Independent review (3 other agents) | 21 fixes (de 1, es 1, fr 3, hi 3, id 3, it 1, ja 1, nl 2, pt_BR 1, ru 2, uk 2, plus the Disconnect wording in ru/uk); one word kept identical to English and recorded (`fr` `optionsNotifications` = "Notifications", DownloadPulse's own) |
| Reworded labels kept (identical to English otherwise) | de "Bestätigungscode:", "Serveradresse", "Browsername"; it/nl "Server connesso"/"Verbonden server", "Account utente"/"Gebruikersaccount", "Nome del browser"/"Browsernaam"; nl "Koppelcode:"; id "Alamat server" (several are DownloadPulse's own `browser.pairing.field.*`) |
| Blind back-translation of the 4 critical keys × 18 (target text only) | compared by the task author: **all 72 match** the English in meaning: the code warning unmistakable everywhere; the certificate steps in order; both Disconnect messages naming the real button and path |

**Defect found and fixed:** under Arabic, Chromium reported `@@ui_locale` = `en_US` and `@@bidi_dir` = `ltr` (the application locale) while showing the Arabic catalog. `localize()` now takes the language and direction from `chrome.i18n.getUILanguage()`, the language the messages are in.

**Gate 7:**

| Check | Result |
|---|---|
| `node scripts/check-locales.mjs` (in `npm run check`) | **18 locales × 95 keys: complete, current, reviewed** |
| Locale smoke: the popup in de, ar (right to left), zh-CN, pt-BR reads its own catalog | 4 passed (ar failed `dir` before the fix) |
| Whole suite | 30 Chromium + 7 unit passed; Firefox smoke passed |

**Not run:**
- every surface in every language (the toasts, notifications and options page are the same catalog mechanism);
- Firefox in another language;
- a human or native review, which is **not claimed**.
