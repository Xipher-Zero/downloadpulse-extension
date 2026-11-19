# Permissions: what each is for (store review, 2026-11-18)

| Permission | Why | Narrowed to |
|---|---|---|
| `host_permissions: http://*/*, https://*/*` | (1) The in-page buttons run on the pages the person browses, in their frames too. (2) A `.torrent`, `.nzb`, `.meta4` or newznab indexer link is captured by a background fetch with the person's existing session on the site serving it (spike S1); that site is any site. (3) The DownloadPulse on this computer (`127.0.0.1`/`localhost:8095`), or the server the person names, is reached from the background. | Web pages only (`<all_urls>` dropped): no `file:`, `ftp:` or other schemes. |
| `content_scripts` on `http://*/*`, `https://*/*`, `all_frames: true` | The hover, video and selection buttons. Frames: video players and download links are often in embedded frames (YouTube embeds; spike S3). The script reads no storage and holds no secret; it asks the background what it may offer. It can be switched off globally or per site. | Web pages only. |
| `storage` | The connection's details, settings, the disclosure agreement and the theme (see PRIVACY.md). The connection key itself is in the extension origin's IndexedDB. | — |
| `contextMenus` | "Download with DownloadPulse" on links and selected text, shown only while connected. | — |
| `notifications` | Finished, failed and needs-attention notices, each switchable. | — |
| `alarms` | Wakes the monitor of unsettled downloads (MV3 background lifetime). | — |
| `incognito: not_allowed` | Never in private windows: a private session's downloads would enter DownloadPulse's lasting queue. | — |

**Why not request site access at use:** the in-page buttons must be present on a page before the person acts there, which makes runtime grants impractical for that feature. Capture needs the serving site's origin at the moment of the click, from the background (a context-menu click or an in-page button), where Chromium cannot always show a permission prompt.

**Code:** all executable code ships in the package. It's bundled with esbuild, with no remote code, `eval` or remote fonts (Outfit is bundled under OFL-1.1).
