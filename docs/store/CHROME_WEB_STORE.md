# Chrome Web Store: listing and Privacy practices (draft for the operator)

## Single purpose
Send the downloads the person chooses in their browser (links, files, video pages, selected links) to **their own DownloadPulse** instance, and show and manage those downloads there (status, pause, resume, remove).

## Permission justifications
- **Host permissions (http/https):** the download buttons shown beside links and video players on the pages the user browses. Fetching a `.torrent`, `.nzb` or indexer file with the user's existing session on the site serving it, to send that file to their DownloadPulse. Reaching the user's own DownloadPulse server or desktop application.
- **storage:** connection details, settings and consent, kept in the browser.
- **contextMenus:** the "Download with DownloadPulse" item.
- **notifications:** download finished, failed or needs attention (user-switchable).
- **alarms:** keeps checking downloads in progress.
- **Remote code:** none.

## Data usage (form answers)
- **Web history:** yes. The address of a link or video page the user explicitly sends. Only on the user's action, to their own DownloadPulse.
- **Website content:** yes. A `.torrent`, `.nzb` or `.meta4` file fetched from a page on the user's action.
- **Authentication information:** yes. The DownloadPulse connection key, issued by the user's DownloadPulse and sent back only to it.
- **Personally identifiable information, health, financial, personal communications, location, user activity:** no.
- **Certifications:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- **Privacy policy URL:** https://github.com/Xipher-Zero/downloadpulse-extension/blob/main/PRIVACY.md

## Prominent disclosure
Before anything is sent, the extension shows its disclosure page (what is sent, what stays, the policy link), and the user presses **Agree and continue**. The listing description must say the same: links, files and video pages the user chooses go to the user's own DownloadPulse; nothing goes anywhere else.
