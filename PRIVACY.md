# DownloadPulse browser extension: privacy policy

_Last updated: 2026-11-24. Applies to the DownloadPulse extension for Firefox and Chromium-based browsers._

The extension sends downloads you choose from your browser to **your own DownloadPulse**, a server or desktop application that you, or whoever runs it for you, operate. It has no servers of its own, no analytics and no telemetry, and sends nothing to its authors.

It contacts only two kinds of place:
- **your DownloadPulse;**
- **a website you send a file link from,** to fetch that file with the session you already have there (see below), only when you send it.

## What is sent to your DownloadPulse, and when

Nothing is sent before you agree to the disclosure shown when you first connect.

- **Connecting.** The extension first checks whether DownloadPulse is running on this computer (a request to `127.0.0.1:8095` and `localhost:8095`), or contacts the server address you enter. It asks to connect, under a name for this connection:
  - **"Browser"**, by default;
  - **this browser and system** (for example "Brave on Linux"), only if you tick that option. In Firefox, that also needs its optional technical-data consent.

  You approve the connection in DownloadPulse, which then gives the extension a **connection key**.
- **When you send something:**
  - **A link:** its address.
  - **A `.torrent`, `.nzb` or `.meta4` link, or an indexer's download link:** the extension fetches the file in your browser, using the session you already have with that website (your sign-in there), and sends **the file and its name**, not the link. The website's cookies and the link itself (which may carry a key of yours for that site) are **never** sent to DownloadPulse.
    - The fetch is made only over HTTPS, or over plain HTTP to a site on this computer or your private network.
    - It never follows a redirect: a redirecting link is refused before anything else is requested.
  - **A video:** the address of its player (for a video embedded in another page, the player's own address) and, **unless you turn it off** in Settings ("Send my sign-in on the site with videos and browser downloads"), **your sign-in on that site**: the cookies your browser would send to that address, from that tab's own cookie store (a Firefox container's), including the player's partitioned cookies under the page you are on.
    - **Why:** so DownloadPulse's video downloader can fetch what you can watch (members-only or age-restricted videos).
    - **Only:** for a video you send, and only to a DownloadPulse that says it accepts them, reached over HTTPS or on this computer (there, only once it has proved it is your DownloadPulse, below): **never over plain HTTP**, even to a server on your network. Never another site's cookies, and never for a link, file or selection. When the setting is on but a video goes without them (plain HTTP, too many cookies, or a DownloadPulse that doesn't accept them), the confirmation says so.
    - **In DownloadPulse:** they're kept only in memory, for that download, and deleted when it ends, fails or is removed, or when DownloadPulse restarts. They're never written to disk, a log, or the download's record.
- **Browser downloads, only if you turn this on** (offered once when you connect, and in Settings; off until you do): when this browser starts downloading a file, the extension sends DownloadPulse **the file's address**, **the page the download was started from**, and, **unless you turn it off** with the same Settings switch as for videos, **your sign-in on that site** (the cookies your browser would send to that address, from the download's own cookie store; for a download a page of another site started, without the site's `SameSite=Strict` cookies, which your browser would not send then either; this needs the browser to say which page started it: a page that hides that, or another site under a shared domain such as `github.io`, is treated as the file's own site), so DownloadPulse can download it as your browser would. The browser's own download is paused, and cancelled only once DownloadPulse has finished downloading the file, or when you remove that download in the extension's menu; if DownloadPulse can't take it or can't finish it, the extension can no longer tell how it went, or DownloadPulse hasn't been downloading it for 10 minutes (still waiting its turn, stuck, or not answering), the browser carries on downloading it (DownloadPulse may also still finish it, so you may get it twice). A download paused in DownloadPulse (by you, from the extension or in DownloadPulse, or by DownloadPulse itself) stays held for as long as it is paused. A download the browser can't pause is cancelled in the browser as soon as DownloadPulse accepts it; if DownloadPulse then can't finish it, download it again. If you have a sign-in on that site but it can't go with the download (the switch is off, the connection is plain HTTP, or DownloadPulse doesn't accept it), DownloadPulse may be given the site's sign-in page instead of the file, so the browser's own download is never held or cancelled for it (it resumes as soon as DownloadPulse has answered): you get the file from your browser, and DownloadPulse's copy may not be it. To know this, the extension checks whether your browser has cookies for that address; none of them is sent.
    - **Only:** to a DownloadPulse that says it accepts them; the sign-in only over HTTPS or to DownloadPulse on this computer once it has proved it is your DownloadPulse (below), **never over plain HTTP**. Never another site's cookies. Files smaller than the size you set (and, unless that size is 0, files whose size the browser doesn't know yet), the file types you list, `.torrent`/`.nzb`/`.meta4` files, and downloads made from a page's own data or by another extension always stay in the browser.
    - **In DownloadPulse:** kept only in memory, for that download, as for a video's sign-in above.
    - **Not in Firefox for Android:** it doesn't let extensions take over its downloads, so they always stay in the browser there, and the setting says so.
- **While downloads run, or the extension's menu is open,** it asks your DownloadPulse for the status of the downloads sent from this browser, and for your DownloadPulse colour theme, so its pages match it.
- **When you choose to:** pausing, resuming or removing a download sent from this browser; bringing the DownloadPulse desktop application's window forward; disconnecting.

A connection made before you agreed to this disclosure (for example, by an earlier version), or one that no longer meets the transport rules below, is held: nothing is sent with it until you agree, or choose plain HTTP for a server on your network. A connection to a server over plain HTTP across the internet is forgotten.

Every request to DownloadPulse carries the connection key. It never carries your browser's cookies, except a video's or a browser download's sign-in on its site as described above, and that only over HTTPS or to DownloadPulse on this computer.

**Checking it is your DownloadPulse (DownloadPulse 1.0.8 and later).** Before the connection key goes to DownloadPulse, and before every send with a sign-in, the extension asks DownloadPulse to prove it is the one that gave it that key, so another program listening at the same address (on a shared computer, while DownloadPulse isn't running) gets neither. That check sends a random number, the connection's ID and the server's address as the extension knows it, **without the connection key**; DownloadPulse answers with a value only it and the extension can compute from the key. If the answer is wrong, nothing else is sent. A DownloadPulse older than 1.0.8 can't answer: the extension then works as before, except that it sends no sign-in to one on this computer.

## What stays in your browser

Stored by the extension in your browser profile only:
- the connection key (in the extension's own storage, not readable by websites);
- for a DownloadPulse that proves it is yours (above): that it does, with the connection's ID and a one-way digest of the connection key (DownloadPulse keeps the same digest), in the same storage as the key;
- the server's address, your DownloadPulse account's display name (which may be your name or user name) and the connection's name;
- your settings;
- your agreement to the disclosure;
- your DownloadPulse theme's palette names;
- while a browser download is held for DownloadPulse (see above): **its full address**, when it started, which DownloadPulse it was sent to and that download's number there, and when DownloadPulse was last seen downloading it or holding it paused. It is kept across browser restarts so the browser's copy can still be cancelled or resumed, and deleted as soon as that happens: when DownloadPulse finishes or can't finish it, when DownloadPulse hasn't been downloading it for 10 minutes (unless it is paused there), when you remove it, when you resume or cancel it in the browser, when you disconnect from that DownloadPulse, when you turn sending browser downloads off, or when the downloads permission is taken back. If you take the downloads permission back in the browser's own settings, a download still held stays paused in the browser's list; resume it there.

The list of sent downloads is kept only until the browser closes. So is, for 10 minutes after each send, a fingerprint of it (a one-way digest of the server and what was sent, not the link) with its request key, so sending the same thing again doesn't queue it twice. Disconnecting deletes the key and the connection details. Removing the extension deletes everything.

## What DownloadPulse records

Your DownloadPulse records each download you send as yours, sent from this browser's connection (under its name), and keeps a journal of connections and disconnections. What it does with downloads is governed by DownloadPulse and by whoever operates it. You can see and remove this browser's connection in DownloadPulse under **My Account › Connected browsers**, and an administrator can do the same.

## Transport

- DownloadPulse on this computer is reached over plain HTTP on the loopback address.
- Any other server is reached over **HTTPS**. Plain HTTP is used only for a server on your private network, and only after you choose it on a screen explaining that the connection key and downloads would cross that network unencrypted. A video's sign-in is never sent over it.
  - Your private network: private addresses (10.x, 172.16–31.x, 192.168.x, link-local), Tailscale addresses (100.64.0.0/10) and names such as `.lan`, `.local`, `.home.arpa`, `.ts.net` or a name with no dot.
    - 100.64.0.0/10 is also used for carrier-grade NAT: a network your internet provider shares with its other customers, not a private one. When you enter a server by an address in that range, the plain-HTTP screen says so; a name that resolves to one (split DNS, below) gets no such note, as names are not looked up for it. Choose plain HTTP there only for your own Tailscale network.
  - In Firefox, also a name that resolves only to such addresses (split DNS). The lookup is your system's own name resolution; nothing extra is sent anywhere.
- Plain HTTP across the internet is refused.
- Nothing falls back from HTTPS to HTTP silently.

## Private browsing

The extension does not run in private or incognito windows.

## Permissions

- **Every web page (http and https)**, including the frames inside them:
  - to show its download buttons beside links, video players and selected links. In Firefox they appear only on the page itself, not in frames inside it (there, right-click and the address-bar icon still send), and a press on one opens a small DownloadPulse window showing what would be sent; nothing is sent until you choose Send there;
  - to fetch a `.torrent`, `.nzb` or indexer file with your sign-in on the site serving it;
  - to reach your DownloadPulse.
- **Storage:** to keep the items listed above.
- **Context menus:** the "Download with DownloadPulse" item (not in Firefox for Android, which has no such menu).
- **Notifications:** download finished, failed or needs attention, each switchable in Settings.
- **Alarms:** to keep checking downloads in progress.
- **Cookies:** to send your sign-in on a video's site with a video you send, and on a download's site with a browser download sent to DownloadPulse, as described above. Read only: the extension never sets or removes a cookie, never reads one for a link, file or selection you send by hand, and never keeps one. On by default, switchable in Settings ("Send my sign-in on the site with videos and browser downloads"), for videos and browser downloads alike.
- **Downloads (optional, asked for only when you turn on sending browser downloads):** to see the downloads this browser starts, hold one while DownloadPulse answers, and cancel the browser's copy once DownloadPulse has it. Turning the setting off resumes any download still held and gives the permission back.
- **DNS (Firefox only):** to check whether a server or file-link name resolves only to private addresses (split DNS, such as `nas.home.example.com`), so it can be treated as part of your own network. The lookup is your system's own name resolution; nothing extra is sent anywhere.

## Contact

Questions and reports: <dpsupport@xipherzero.com>, or <https://github.com/Xipher-Zero/downloadpulse-extension/issues>.
