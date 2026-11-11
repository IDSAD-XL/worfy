# Critic: worfy-ui-kit — 2026-11-11

Plan: `docs/product/ui-overhaul/drafts/worfy-ui-kit.md`
Verdict: Split — the tickets cover the right ground. But ticket 02 locks spike-independent fixes behind the spike, and ticket 06 carries an unrelated redesign of four inline confirms. The spike also misses the one combination that ticket 03 hits first: the app's own `Select` inside a kit Dialog.

## Objections

### 1. The spike does not test the app's own `Select` inside a modal kit Dialog, and Settings has eleven of them

Fact: `src/renderer/theme/Select.tsx:17` says "The list is drawn into document.body with `position: fixed`, above every dialog"; `<Select` is used in eight files of `src/renderer/settings/` and in `shell/ProjectSettings.tsx`, `projects/ProfileFields.tsx`, `harness/MigrationForm.tsx`; the draft keeps `Select` its own (`drafts/worfy-ui-kit.md:167`), moves those windows to Dialog kit (rows 03, 04, 06, :234-238), and the spike row (:232) lists no Select-in-Dialog check; the Base UI Dialog reference (https://base-ui.com/react/components/dialog) says that with `modal: true` "pointer interactions on outside elements are disabled".

Judgement: The Select list is a sibling of the Dialog popup in `document.body`, not its child, so after ticket 03 a click on an option in Settings can be blocked or read as an outside press that closes Settings, and a screen reader can lose the list. The draft makes this exact exception for the toast area (:155-156) but not for `Select`, so the failure would first show up in ticket 03, not in the spike. Add "own Select inside a kit Dialog: pick an option with the mouse, Esc on an open list, the list stays visible to a screen reader" to spike 01, and name the fix before Settings moves: the Select portals into the open Dialog, or the kit treats the Select listbox as inside.

Owner decision: accepted — ок

### 2. Ticket 02 bundles seven changes and makes the three that need no Base UI wait for the spike

Fact: Row 02 (`drafts/worfy-ui-kit.md:233`) holds the ADR, the package, the import lint, the z-index scale, the open-layers helper, `defaultPrevented` in the chat input, and closing on window blur and view switch, with `Blocked by: 01` and Wave 2 "только после «да» spike-а" (:256); the fallback for a "no" is "свои правки без библиотеки: focus trap в 13 окнах, стрелки, переворот у края" (:269); `src/renderer/session/MessageInput.tsx:344` interrupts the turn on any `Escape` while `busy`, without reading `defaultPrevented`.

Judgement: The z-index tokens, one helper in place of the six role checks, and the Esc fix in the chat input use no Base UI. Both spike answers need them. Yet they wait a full wave and land in one PR with the library adoption. Cut 02 in two. 02a: z-index tokens, the helper, the chat-input Esc fix; no blocker; Wave 1 beside 01. 02b: the ADR, the package, the import lint, and in the wrappers the blur and view-switch close plus the helper's "closing but still in the DOM" case for Base UI; blocked by 01 and 02a. User story 4 then ships even if the spike says no, and the critical path loses most of a wave.

Owner decision: accepted — ок

### 3. Ticket 06 turns four inline confirms into modal windows, a redesign the epic says it does not make, and edits the same file as ticket 09 in the same wave

Fact: The four confirms are `<div role="alertdialog">` blocks inside a panel at `src/renderer/canvas/nodes/SessionNode.tsx:651`, `src/renderer/session/HistoryPopover.tsx:259`, `src/renderer/settings/PipelineSection.tsx:399` and `src/renderer/browser/BrowserProfiles.tsx:242`, and `notes/inventory-overlays.md:74` says "Это не модальные окна, а блок с вопросом внутри панели"; Base UI describes AlertDialog as "A dialog that requires a user response to proceed", and its Root has no `modal` prop (https://base-ui.com/react/components/alert-dialog); row 06 (:238) moves them to AlertDialog kit, while story 31 (:122) and :179 say the look does not change; row 09 (:240, the remaining popovers, sidebar History among them) is in the same Wave 4 (:258), and neither 06 nor 09 names the other in `Blocked by:`.

Judgement: As AlertDialogs, a question inside a Session Node on the Canvas and one inside Settings → Pipeline become windows with a backdrop over everything. That is a new design and a change unrelated to the windows of ticket 06. And 06 and 09 both editing `HistoryPopover.tsx` at once means a merge conflict. Take the inline confirms out of 06. Either leave them inline (no user story names a problem with them), or give them a ticket of their own, blocked by 03 and 09, that carries an owner decision on modal versus inline.

Owner decision: accepted — «да»; о доводе «вид не меняется»: «насчет того что вид не поменяется это не так критично, изменения внешнего вида допустимы если они улучшают UX»

## Alternative

The closest other plan is the one the draft keeps as its fallback (:269): no library, 4–6 tickets. A shared modal hook built from `focusablesOf` (`settings/settings-window.ts:69`) goes into the 13 windows without a focus trap. Arrow keys go into the groups. Flip at the edge goes into the popovers and menus. It is cheaper and carries no spike risk. This draft is still better on its own terms: the fallback leaves the positioning of 11 popovers, 6 menus and 5 context menus as hand-written code. That is the code where 17 of 147 commits fixed behaviour. So the next new dialog or menu would still be a copy of a neighbouring one, which is the problem in user story 25.

## What the critic cannot know

- There is no product analytics. How many users work from the keyboard or with a screen reader, and so how much stories 1–12 are worth against the 18 tickets, is not known.
- The Base UI behaviour above comes from its documentation pages. Its source was not read, and nothing was run. Two things are unchecked: whether an outside press on a body-portaled list closes the Dialog or is only swallowed, and how Base UI's Esc handling meets the `stopPropagation` in `Select`. The spike can answer both.
- Windows behaviour was not checked beyond the fact that `.github/workflows/ci.yml:513` runs `windows-e2e` whenever `macos-e2e` runs.
