# Chrome Web Store: listing and Privacy practices (draft for the operator)

## Single purpose
Send the downloads the person chooses in their browser (links, files, video pages, selected links) to **their own DownloadPulse** instance, and show and manage those downloads there (status, pause, resume, remove).

## Permission justifications
- **Host permissions (http/https):** the download buttons shown beside links and video players on the pages the user browses. Fetching a `.torrent`, `.nzb` or indexer file with the user's existing session on the site serving it, to send that file to their DownloadPulse. Reaching the user's own DownloadPulse server or desktop application.
- **storage:** connection details, settings and consent, kept in the browser.
- **contextMenus:** the "Download with DownloadPulse" item.
- **notifications:** download finished, failed or needs attention (user-switchable).
- **alarms:** keeps checking downloads in progress.
- **cookies:** when the user sends a video (and hasn't turned this off), the cookies their browser would send to that video's own address go with it, so their own DownloadPulse can download what they can watch. Only for that send, only that address's cookies, and only over HTTPS or to DownloadPulse on the same computer. The same applies to a browser download sent to DownloadPulse (opt-in), under the same Settings switch (1.0.4).
- **Remote code:** none.

## Data usage (form answers)
- **Web history:** yes. The address of a link or video page the user explicitly sends. Only on the user's action, to their own DownloadPulse.
- **Website content:** yes. A `.torrent`, `.nzb` or `.meta4` file fetched from a page on the user's action.
- **Authentication information:** yes.
  - The DownloadPulse connection key, issued by the user's DownloadPulse and sent back only to it.
  - When the user sends a video (unless they've turned it off), their sign-in cookies for that video's address, sent only to their own DownloadPulse, over HTTPS or on the same computer (never plain HTTP). DownloadPulse holds them in memory until that download ends. The same for a browser download sent to DownloadPulse, if the user turned that on, under the same switch.
- **Personally identifiable information:** yes. The user's DownloadPulse account display name, which may be a real name or user name, is received from their DownloadPulse, stored in the browser and shown in the extension. It's never sent anywhere.
- **Health, financial, personal communications, location, user activity:** no.
- **Certifications:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- **Privacy policy URL:** https://github.com/Xipher-Zero/downloadpulse-extension/blob/main/PRIVACY.md
- **Support email / homepage:** `dpsupport@xipherzero.com` (the same address as the Firefox listing and PRIVACY.md); homepage <https://github.com/Xipher-Zero/downloadpulse-extension> until downloadpulse.net has a site.

## Prominent disclosure
Before anything is sent, the extension shows its disclosure page (what is sent, what stays, the policy link), and the user presses **Agree and continue**. The listing description must say the same: links, files and video pages the user chooses go to the user's own DownloadPulse; nothing goes anywhere else.
