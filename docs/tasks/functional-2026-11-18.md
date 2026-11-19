# Functional corrections from the operator's real-browser use (2026-11-18)

Worked one by one, as the operator reports them.

## 1. The hover icon's placement

**Seen:** on a GitHub release's asset list the icon appeared far off to the side, over the row's "1 download" text. Elsewhere it sat against the link with no space.

**Cause:** the icon was placed at the right edge of the link's box. Many pages (GitHub's asset rows among them) stretch a link's box across the row, so the box's edge isn't where the text ends. Where the box hugs the text, the gap was 4 px.

**Fix:**
- The icon is placed by the link's rendered text: the union of its visible glyph boxes on the line under the pointer (a wrapped link has several lines). It sits a constant 8 px after the text (before it in right-to-left text), centred on that line.
- A link with no text (an image) uses its image's box; failing that, the link's box.
- Hovering anywhere on the link, including a stretched box's empty end, still offers it, and the icon is by the text.

## 2. The in-page surfaces follow the theme

**Seen:** the icon was a generic blue circle with a white arrow, whatever the theme.

**Fix:**
- The background's answer to a frame (`dp-state`, which a content script already asks) now carries the person's appearance by palette ID. That isn't a secret; content scripts still read no storage.
- The page's colours are resolved in `src/shared/page-theme.ts` from the same truths as the dropdown.
- **The send button** (hover icon and video button) is DownloadPulse's primary button material:
  - DebridPulse's own gradient and border for the native palettes;
  - for an alternative palette, its accents, as DebridPulse derives them;
  - the arrow in the accent contrast.
- **A toast** is DownloadPulse's surface with the state colour (success or error) along its edge.
- A page learns a theme change within its 5 s answer cache, after the extension has read it.

## Proof

- **Placement**, against a stretched flex link, an inline link and a wrapped link's second line: the icon's left edge is within 1 px of the text's end plus 8, and its centre within 1.5 px of the line's middle. On the stretched link it's by the text. With the old box-based placement put back, the test fails.
- **Theme:** the icon is DownloadPulse Dark's primary material, then Nord Light's accents once that's chosen in DownloadPulse.
- **Full suite:** 40 e2e and smoke cases, unit tests, the Firefox smoke install, `web-ext lint` (its one warning predates this) and the locale check all pass.

## 3. The toolbar icon fills its slot

**Seen:** still smaller than the toolbar's native icons.

**Fix:** the icons are cropped inside the logo's gradient border. The dark square with its arrow and pulse fills the slot edge to edge as a rounded square, its corners filled with the logo's own surface. It stays legible at 16 px.

## 4. The dropdown, modelled on a browser's own download list

- The connection status and its chevron are centred on their row.
- **A footer** (with a divider, as Chromium's download panel has) holds **Open DownloadPulse** at its start and **Clear** at its end. Clear is DownloadPulse's danger glyph button with the Lucide trash.
- **Clear** removes the *finished* downloads (done, failed, removed) from this browser's list only, as a browser's own Clear does:
  - active downloads stay, and DownloadPulse keeps everything;
  - an entry DownloadPulse changes afterwards (its change cursor moves) is listed again;
  - it's disabled while nothing finished is listed;
  - the cleared set is per session and is forgotten on disconnect.
- **New string `listClear`**, "Clear finished downloads": translated into 18 locales, then independently reviewed. The reviewer corrected 10 translations, mostly where "finished" had been rendered with the row's success word for Done, which would read as "clear successful downloads".

- A finished download's terminal status (Done, Failed, Removed) stands alone on its line, centred in the row.

**Proof:** a terminal status is centred within 1.5 px (Done and Failed); the status group is centred within 1.5 px; the footer's two controls sit at its two ends; Clear starts disabled, removes a finished entry while an active one stays, leaves DownloadPulse's job untouched, lists the entry again after DownloadPulse changes it, and then is disabled. The full suite (42 cases) passes.

## 5. The "Sent to DownloadPulse" toast stayed on screen

**Seen:** the lower-right toast never went away (on a real site, in Brave).

**Not reproduced:** on the test page it is hidden after 3.5 s, so something on the operator's page or browser stopped its layer from being hidden.

**Fix (it no longer depends on the hide call):**
- the toast's own stylesheet fades it out and makes it non-interactive after 3.5 s;
- clicking it dismisses it at once;
- a failed hide is caught.

## 6. The activity mark breathes

The pie-slice wedge didn't read: a faded dark quarter on a dark toolbar is barely visible at 16 px. The whole logo now breathes, fading to 30 % and back every 2 s (`breath()` in `monitor.ts`). It's still drawn from the logo, and it's the plain logo when nothing is active.

## 7. The hover icon stayed where a link had been

**Cause:** the icon is fixed to the window and follows the pointer. When the page scrolled, the pointer left the page or entered a frame, or the window lost focus, nothing hid it.

**Fix:**
- it's hidden on scroll, when the pointer leaves the page, on window blur, and when the tab is hidden;
- text the page hides (a screen-reader-only label, for instance) no longer counts as where a link is drawn.

## 8. Selected links: a batch send button

**Seen:** on a link-protector page (KeepLinks), selecting all the links gave no way to send them. The site blocks right-click, so the "selection" context-menu item never appears.

**Fix:**
- Text the person selects that holds links (in the page, or in a text box) gets a send button 8 px after the selection's end, showing the link count.
- One click sends them as one batch, the same path as the right-click selection item (`sendSelection`, through a new page message `dp-send-selection`).
- **When it's offered:** for two or more links, or for one that is a download or a magnet. An ordinary selected web link gets nothing.
- **It follows the in-page buttons setting** and the sites without download buttons.
- Pressing it doesn't take the page's selection away.
- **New string `selectionSend`** ("Download the selected links with DownloadPulse"): count-free, translated into 18 locales, reviewed with no corrections.

**Proof:**
- scroll and pointer-leave hide the icon;
- a selection of three page links and one of two text-box links each give a correctly placed button that sends exactly those links as one batch;
- one ordinary link gives nothing;
- a toast leaves on its own and at once when clicked.

The full suite (45 cases), the unit tests, the Firefox smoke install, lint and locales pass.

## 9. The icons stayed behind on KeepLinks after scrolling

**Seen (after round 2):** on KeepLinks both the single icon and the batch button (11 links) stayed where they'd been placed when the page scrolled.

**Cause:**
- **Both icons belonged to the last link line**, `…GF161126-HITC-RN.rar`: a download by its name, so the single icon too, at 8 px past its end. They were left where that line had been. In the operator's two screenshots the line moved from y 581 upwards and both icons stayed at 581.
- **The extension never heard the page scroll.** KeepLinks scrolls its content in a way that sends no scroll event the extension sees (its live page sits behind a captcha, so its scroller couldn't be inspected).

**Fix:** no reliance on any event. While an icon is shown, each frame compares where its link (or the selection's end) is drawn now with where it was when the icon was placed.
- **Moved by any means** (scroll, a page's own scroller or smooth-scroll script, a transform): the hover icon goes at once. The batch button goes and comes back where the selection's end settles, 200 ms later.
- **The batch button only stands where the selection's end is drawn and in view.** A page's hidden copy field, or an end scrolled out of view, offers nothing.
- On a scroll event the batch button also goes at once.
- **Cost:** the check runs only while an icon is shown.

**Proof:**
- content moved by a transform, with no scroll event and no pointer move, loses the hover icon within a second;
- a selection's button leaves and comes back exactly at its new end;
- a window scroll hides the batch button within the frame that handles it, brings it back at the selection's new end, and offers nothing while that end is out of view;
- with the per-frame check disabled, the transform test fails.

The full suite (46 cases), the Firefox smoke install, lint and locales pass.

## 10. The batch button parked below the links (from the operator's screencast)

**Seen:** after selecting KeepLinks' list, the batch button moved as the page scrolled to a spot below the list (not at the selection's end), and stayed there after the selection was cleared.

**Cause:** the selection's end was taken as the last of the range's own boxes. Those include the border boxes of whole elements the selection spans, such as a container or a trailing block, so the "end" could be an element below the text.

**Fix:**
- the end is the last box of the selection's last *visible text* (`selectionEnd`: each text node the range touches, clipped to the range, in a visible holder);
- with no visible text left in the selection, nothing is offered.

**Proof:** rows of links followed by an empty block, all selected: the button sits 8 px after the last link's text, and goes when the selection is cleared. With the old measurement put back, it fails. Full suite: 46 cases pass.

## 11. "Hover a link, move away, the button remains", on any link (Brave and Firefox)

**Seen:** on a Forgejo releases page (`git.notrexed.dev/Hookshot/Hookshot/releases`), the icon stayed after the pointer moved away from the link. Reproduced by the operator in Brave and Firefox.

**Cause:**
- At the operator's window width, Forgejo's asset links stretch across their row: a link's box ran x 686–1374 while its text ended at about 941.
- The extension offered the icon anywhere over the link's box, an earlier rule ("a stretched box's empty end still offers it").
- So moving along the row towards the size or date never left the link.
- The test browser's 1400 px window lays the row out narrower, which is why it didn't show here before.

**Fix:**
- **Offered only over what the link draws:** its text and its images or icons (Forgejo's file glyph counts), with 4 px slack, plus the way across to the icon.
- **Withdrawn entirely (operator):** every layer (the hover icon, the video button, the batch button and the toast) is put into the page when shown and taken out when withdrawn. Nothing of the extension's stays in a page hidden.
- **Its own record of whether a layer is shown:** the extension never reads the browser's popover state back to decide.
- **The build is visible in Chromium's extensions page:** `version_name`, for example `0.1.0 (955856b)`, with `+` when built from uncommitted changes. Firefox has no such field.

**Proof:**
- **Fixture:** a link stretched across its row offers nothing at the box's empty end. It offers on its text, stays while crossing to the icon, and goes once the pointer moves along the row off the text.
- **Moving off a link** leaves no extension element in the page.
- **On the real Forgejo page at 1936 px:** on the glyph and on the name it's shown; along the row, and after a jump away, no element is left in the page.
- **Full suite** (48 cases), the Firefox smoke install, lint and locales pass.

## 12. The video button covered the picture

**Seen:** on YouTube the button sat inside the video's top-right corner and covered part of it while not fullscreen.

**Fix:**
- **Outside the frame:** the button stands a GAP (8 px) to the right of the frame's top corner.
- **Not drawn fullscreen:** if a video goes fullscreen while it's shown, it's withdrawn at once.
- **Not drawn without room** to the right of the frame (a frame spanning the window), where it could only cover the video.
- **Reachable:** the pointer crossing the gap to the button counts as still on the video.
- **Follows the frame:** like the other in-page buttons it's withdrawn if the frame moves under it.

**Proof:**
- the button sits 8 px right of the frame's top corner and stays while the pointer crosses to it;
- fullscreen, no extension element is in the page;
- with a frame spanning the window, none either.

Full suite passes.

## 13. Two buttons at once: a selection's batch button and a link's

**Seen:** with links selected (the batch button up), hovering one of them added the single-link button beside it.

**Fix:**
- while the batch button is shown it's the only offer: no single-link button is created or put into the page;
- when it appears, any single-link or video button is withdrawn;
- once the selection is gone, hovering offers links again.

**Proof:** rows of `.rar` links selected; hovering one of them leaves exactly the batch button, where it was. Without the suppression, this fails.
- The content script's `hide` is renamed `withdraw` (and `hidePointerSurfaces` to `withdrawPointerSurfaces`): it takes a layer out of the page, and the old name invited the "hidden but present" misreading (operator). The test asserts the batch button is the only extension element in the page.

## 14. Video previews were offered as downloads

**Seen:** on YouTube's home page the video button appeared on a thumbnail's inline preview. Sending would have sent the home page's address, which is no video.

**Fix:**
- **A video is a preview, and gets no video button,** when it sits inside a link, or when the pointer over it is on a link to another page. YouTube's previews lie under their thumbnail's link.
- **Firefox's URL-bar icon** (shown when a page has a video) now counts only a video that is shown, player-sized (at least 320×180) and not inside a link.

**Proof:** a video inside a link, and a video under a link's overlay, put no extension element in the page; the page's own video still gets its button. Without the rule, this fails. Full suite passes.

## 15. An indexer's download link (NZBGeek): captured as the NZB

**Seen:** NZBGeek's download icon links to its newznab API (`api.nzbgeek.info/cdn?t=get&id=…&apikey=…`). Fetching it returns the `.nzb`. The extension didn't recognize it (no `.nzb` in the path), so it would have sent the URL itself. That's a plain web link to DownloadPulse, and it carries the person's indexer key.

**Fix:**
- **Recognized:** a newznab download link (`?t=get&id=…`, whatever the path: the standard `/api`, NZBGeek's `/cdn`) is a download candidate (hover icon, right-click) and is captured as an NZB, as a `.torrent` behind a sign-in is. The browser fetches it, and DownloadPulse receives only the NZB's contents and name, **never the URL or the key**.
- **Validated:** the answer must be an NZB document (an `<nzb>` root). A newznab indexer answers a refusal (bad key, limit reached) with an `<error>` document and 200. That's refused, and nothing is sent.
- **Named** by the indexer's `Content-Disposition`, else by the NZB's own `<meta type="name">`, never "cdn.nzb".
- **Also fixed:** adding a captured file's suffix stripped a dotted name's last part (`The.Odyssey.2026.2160p` became `The.Odyssey.2026.nzb`). Only a letters-only extension is replaced now; anything else is kept.

**Proof:**
- **Unit:** newznab get links are candidates and NZB captures; a search, or a get without an id, is neither.
- **e2e (fake indexer):**
  - named by the indexer;
  - unnamed, named by the NZB itself;
  - a limit `<error>` sends nothing;
  - the key appears nowhere in what DownloadPulse received.

## 16. Onboarding: choosing what to connect to, as DownloadPulse's wizard chooses a deployment type

**Seen:** with DownloadPulse found on this computer, the choice was two stacked text buttons.

**Fix:**
- **Two choice cards side by side**, as the first-run wizard's Deployment Type step draws them: a title, a Lucide glyph (`monitor`, `server`, DownloadPulse's geometry) and a hint each. They are:
  - **This computer**, "Connect to the DownloadPulse installed and running here.", chosen by default;
  - **Remote server**, "A DownloadPulse server elsewhere on your network or the internet. You'll enter its address.".
- **One primary Connect.** Choosing Remote server shows the address field, and Enter in it connects too.
- **A radio group, as the wizard's:** the arrow keys move the choice, and the chosen card has the accent edge.
- **Strings:** six new; the two old button strings are retired everywhere.

**Proof:**
- local chosen by default, each card with its glyph, side by side;
- the arrows move the choice and its focus;
- the address field shows only for Remote server;
- connecting to a named server through the cards pairs with that server, and the local one is never asked.
- **Translated** into 18 locales and independently reviewed. Two corrected: ru and uk "Connect" take the reflexive form, as the catalog's other connect buttons do, and so no longer clash with DownloadPulse's own pairing button.
