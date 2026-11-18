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
