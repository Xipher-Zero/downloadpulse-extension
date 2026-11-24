# Notes for store reviewers

The extension sends downloads to the user's own **DownloadPulse**, a self-hosted server or desktop application (GPL-2.0-or-later, <https://github.com/Xipher-Zero/downloadpulse>). It does nothing until connected to one.

**Test instance:** its HTTPS address and a disposable sign-in are in the **Notes to reviewer** field of this submission (they are never kept in this public repository). The instance has no real download-service accounts and limited storage; the account is deleted after review.
Alternatively, install the DownloadPulse desktop application for your platform (links in the same field). It listens on `127.0.0.1:8095` and the extension finds it automatically.

**Steps:**
1. **Pair:**
   - Click the toolbar button, then **Connect to DownloadPulse**.
   - Read the disclosure and press **Agree and continue**.
   - With the desktop application running: the extension says **DownloadPulse found on this computer**. Choose **This computer**, then **Connect**.
   - With the test instance: choose **Remote server**, enter the test instance's HTTPS address in **Server address**, then **Connect**. (When no DownloadPulse is found on this computer, the extension shows the **Server address** field directly; enter the address there and choose **Connect to this server**.)
   - A DownloadPulse tab opens on **Connect a browser**. Sign in (test instance only), check the code matches the one the extension shows, and choose **Connect**.
   - The extension asks once **Send downloads to DownloadPulse?** (1.0.2). **Send them to DownloadPulse** asks the browser for the optional `downloads` permission; **Not now** leaves downloads in the browser (it can be turned on later from the popup's switch or Settings). The extension then shows **Connected** and the account's name.
2. **Send a download:**
   - On any page, hover a download link (for example a `.zip` or `.iso`) and click the button beside it. Or right-click a link and choose **Download with DownloadPulse**.
   - It appears under **Sent Downloads:**, and in DownloadPulse's Downloads list.
   - **A video:** hover a video player (for example on YouTube) and click the button beside it. With **Send my sign-in on the site with videos and browser downloads** on (Settings; on by default), the video's sign-in cookies for that address go with it, so DownloadPulse can download what the user can watch; they are sent only over HTTPS or to DownloadPulse on the same computer. Why each permission is requested: `docs/store/PERMISSIONS.md`.
   - **A browser download (if turned on):** click any download link that the browser itself would download (for example a `.zip` over 10 MB). The browser's download is held, sent to DownloadPulse with the page it came from and the user's sign-in on that site, stays paused in the browser's list while DownloadPulse downloads it, and is removed from that list once DownloadPulse has finished it; if DownloadPulse refuses it, fails to finish it, or has not been downloading it for 10 minutes (a download paused in DownloadPulse stays held while it is paused), the browser download simply continues. A download the browser cannot pause is cancelled in the browser as soon as DownloadPulse accepts it. Files under the size set in Settings (and, unless it is 0, files whose size the browser does not know yet), the file types listed there and `.torrent`/`.nzb`/`.meta4` files stay in the browser.
3. **Verify revocation:**
   - In DownloadPulse, open **My Account › Connected browsers** and disconnect this browser (or use the extension's Settings › **Disconnect**).
   - The extension shows **This browser was disconnected in DownloadPulse.** and sends nothing further.

**Building from source:** `BUILDING.md`.
