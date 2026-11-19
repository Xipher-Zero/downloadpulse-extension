# Notes for store reviewers

The extension sends downloads to the user's own **DownloadPulse**, a self-hosted server or desktop application (GPL-2.0-or-later, <https://github.com/Xipher-Zero/debridpulse>). It does nothing until connected to one.

**Test instance:** `<OPERATOR: HTTPS URL>`, sign in as `<OPERATOR: username>` / `<OPERATOR: password>` (disposable). Alternatively, install the DownloadPulse desktop application for your platform (`<OPERATOR: installer links>`). It listens on `127.0.0.1:8095` and the extension finds it automatically.

**Steps:**
1. **Pair:**
   - Click the toolbar button, then **Connect to DownloadPulse**.
   - Read the disclosure and press **Agree and continue**.
   - Choose **This computer** (desktop application) or **Remote server** (enter the test instance's HTTPS address), then **Connect**.
   - A DownloadPulse tab opens. Sign in, check the code matches the one in the extension, and choose **Connect**. The extension shows **Connected**.
2. **Send a download:**
   - On any page, hover a download link (for example a `.zip`) and click the button beside it. Or right-click a link and choose **Download with DownloadPulse**.
   - It appears under **Sent Downloads**, and in DownloadPulse's Downloads list.
3. **Verify revocation:**
   - In DownloadPulse, open **My Account › Connected browsers** and disconnect this browser (or use the extension's Settings › Disconnect).
   - The extension shows **This browser was disconnected in DownloadPulse.** and sends nothing further.

**Building from source:** `BUILDING.md`.
