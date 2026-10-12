# Accessibility

Daily Briefing targets **WCAG 2.2 Level AAA** on desktop, tablet and mobile. This page records how each applicable criterion is met, how that was checked, and what still needs a person to verify.

## How it was checked

| Check | Tool or method | Result |
|---|---|---|
| Automated rules: WCAG 2.0, 2.1 and 2.2 A, AA and AAA, plus best practice | axe-core 4.10 in Chrome, at 1440px and 390px, dark and light themes, morning and evening views | 0 violations |
| Text contrast over the decorative header scene (axe cannot measure text over SVG) | Calculated against every scene colour | 7.6:1 minimum (light), 9.4:1 minimum (dark) |
| Colour token pairs | Script over every text and surface token | 7:1 or better for all text; 3:1 or better for control borders and focus rings |
| Keyboard | Scripted Tab walk through the whole page | 76 stops in reading order; every stop shows a 3px focus ring; no traps |
| Dialog | Scripted: open Preferences, Tab 60 times, Escape | Focus moves in, stays in, Escape closes, focus returns to the Preferences button |
| Target size | Script over every button, link, input and switch | None under 44×44 CSS px |
| Reflow (equivalent to 400% zoom) | 320px viewport | No horizontal scrolling; timeline becomes a vertical agenda |
| Text spacing (1.4.12) | Line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em, at 320px | No overflow, no clipped text |
| Functionality | Scripted run through ticking, pinning, snoozing and undo, dismissing and undo, hiding scores, expanding lists, help, timeline selection, form validation, theme, day paging and view modes | All pass, no console errors |

Not yet done, and needed before calling the AAA target fully verified:

- **NVDA** (Windows, with Firefox and Chrome) and **VoiceOver** (iOS Safari and macOS Safari) passes over every card, the dialog, the sign-in screen, status messages and the update banner. These need a person; they were not run while building this.
- **Windows High Contrast / forced colours**: styles are in place (`@media (forced-colors: active)`), but not checked by eye.
- **Browser zoom at 200% and 400%** by eye in Safari and Firefox; the 320px reflow test covers the layout logic, not every browser.

## Criterion by criterion

The table covers the AAA criteria, and the AA criteria the design affects most. "Met" means met by the design and confirmed by the checks above, apart from the screen-reader passes still to do.

| Criterion | Level | Status | How |
|---|---|---|---|
| 1.1.1 Non-text content | A | Met, with a content limit | Icons are hidden from assistive technology; meaning is always in text. The photo's alternative text uses its caption from Photos, or else names the album and date taken. The site cannot see what is in a photo, so captioning photos in Photos is how to get descriptive alternative text. |
| 1.2.x Time-based media | A–AAA | Not applicable | No audio or video. |
| 1.3.1 Info and relationships | A | Met | Landmarks (banner, main, navigation), one h1, an h2 per card, h3 per group, real lists, labelled form fields, fieldsets for radio groups. |
| 1.3.6 Identify purpose | AAA | Met | Landmarks; consistent icon-plus-text pattern for every control; `autocomplete="current-password"` on sign-in. |
| 1.4.1 Use of colour | A | Met | Status always has text: "Overdue", "Final", "Suggestion", "New", "Up 3 places since yesterday", "Hold". |
| 1.4.6 Contrast (enhanced) | AAA | Met | 7:1 or better for all text in both themes, including badges, links and the header scene. |
| 1.4.8 Visual presentation | AAA | Met | Dark, light and match-device themes (colours are selectable); prose limited to 70 characters per line; text never justified; line height 1.5; text resizes to 200% without horizontal scrolling. Help and summary text is one paragraph, so paragraph spacing does not arise. |
| 1.4.9 Images of text | AAA | Met | None, apart from the app icon (a logo). |
| 1.4.10 Reflow | AA | Met | Single column below 48em; timeline becomes an agenda; em-based breakpoints so zoom triggers them. |
| 1.4.11 Non-text contrast | AA | Met | Control borders 4.2:1 or better; focus ring 6:1 or better. |
| 1.4.12 Text spacing | AA | Met | Verified with overrides; no fixed heights on text. |
| 2.1.3 Keyboard (no exception) | AAA | Met | Every function, including the timeline, help, undo and dialogs, works from the keyboard. |
| 2.2.3 No timing | AAA | Met | Status messages stay until dismissed or replaced; nothing expires. |
| 2.2.4 Interruptions | AAA | Met | The update banner and messages are non-modal and can be dismissed; "Update automatically" can be turned off. |
| 2.2.5 Re-authenticating | AAA | Met | Ticks, pins, snoozes and priorities are saved on the device, so signing in again loses nothing. |
| 2.2.6 Timeouts | AAA | Met | No timeouts cause data loss. Closing the tab or app signs you out; nothing typed is lost. |
| 2.3.3 Animation from interactions | AAA | Met | Device reduced-motion setting is respected, and Preferences has its own "Reduce motion" switch. |
| 2.4.1 Bypass blocks | A | Met | "Skip to the briefing" link first. |
| 2.4.8 Location | AAA | Met | The heading names the day and its relation to today ("Today", "Tomorrow", "3 days ago"). |
| 2.4.9 Link purpose (link only) | AAA | Met | Every link names its destination and says when it opens a new tab, e.g. "Open Rebirth on BoardGameGeek (opens in a new tab)". |
| 2.4.10 Section headings | AAA | Met | Every card and list group has a heading. |
| 2.4.12 Focus not obscured (enhanced) | AAA | Met | Scroll padding keeps focus clear of the update banner and status messages. |
| 2.4.13 Focus appearance | AAA | Met | 3px solid ring, offset 3px with a background-coloured gap; yellow in dark, blue in light. |
| 2.5.3 Label in name | A | Met | Visible text starts each accessible name. |
| 2.5.5 Target size (enhanced) | AAA | Met | 44×44 CSS px or larger; verified by script. |
| 3.1.3 Unusual words | AAA | Met for the interface | Each card's help explains its terms. Calendar, reminder and news text is your own or the publishers' and is shown as written. |
| 3.1.4 Abbreviations | AAA | Met for the interface | League names (NBA, NHL, NFL, MLB, MLS) are expanded for screen readers and on hover; "BoardGameGeek" and "The Movie Database" are written out. Abbreviations inside third-party headlines are not expanded. |
| 3.1.5 Reading level | AAA | Met for the interface; see below | Interface text is short and plain. Headlines are the publishers' own; each comes with a one-sentence plain-language summary, which is the supplemental content this criterion allows. |
| 3.1.6 Pronunciation | AAA | Not applicable | No words whose meaning depends on pronunciation. |
| 3.2.5 Change on request | AAA | Met | Reloading on return can be turned off ("Update automatically"); links that open new tabs say so. Weather for your location updates content in place without changing context. |
| 3.3.3 Error suggestion | AA | Met | Sign-in and "Add priority" errors say what to do next. |
| 3.3.5 Help | AAA | Met | Each card with non-obvious behaviour has an "About this card" button. |
| 3.3.6 Error prevention (all) | AAA | Met | Snoozing, dismissing, removing a priority and marking done all offer Undo; ticks and gift marks toggle back; "Reset this device" asks for confirmation. |
| 3.3.9 Accessible authentication (enhanced) | AAA | Met | Passkeys (Face ID, Touch ID, PIN) need no memorisation; the password field allows paste and password managers. |
| 4.1.3 Status messages | AA | Met | Messages, the update banner and sign-in status use `role="status"`; errors use `role="alert"`. |

## Known limitations

- **Screen-reader verification is outstanding** (see above). The markup follows established patterns, but AAA should not be claimed in full until NVDA and VoiceOver passes are done.
- **Third-party content.** Headlines, calendar titles and reminder text appear as their authors wrote them. Their reading level, abbreviations and unusual words are outside the site's control; the one-sentence news summaries and card help are the mitigation.
- **Photo descriptions.** Alternative text can only be as descriptive as the captions in the shared album. Remediation: add captions in Photos.
