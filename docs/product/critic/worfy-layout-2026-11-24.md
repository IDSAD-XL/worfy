# Critic: worfy-layout — 2026-11-24

Plan: `.scratch/worfy-layout/spec.md`
Verdict: Keep — the code references check out and the order 01/02/03 → 04 → 05 → 06 → 07 → 08 matches what each ticket needs. Two pieces of work are given to the wrong ticket: the focus-mode `inert` of View buttons, and the new badges. Fixing that moves a line of scope between tickets and changes neither the order nor the shape.

## Objections

### 1. Ticket 03 has to prove focus-mode `inert` on View buttons that do not exist until ticket 04, and ticket 04 does not list that work

Fact: `spec.md:251-252` says "View button-ы footer и блока rail в focus mode получают `inert`". `spec.md:349-351` puts the check "focus mode — footer виден, View button-ы `inert`" into `test/e2e/footer.spec.ts`. Ticket 03 is "`Footer.tsx` пока только с chip-ом справа; … focus mode", and its Done points to `footer.spec.ts` (`spec.md:398-404`). The scope and Done list of ticket 04 (`spec.md:407-418`) never mention focus mode or `inert`, yet 04 is the ticket that first draws View buttons in the footer and the rail block.

Judgement: The implementer of 03 cannot write a red-then-green test for `inert` View buttons, because there are none in the footer or on the rail yet. Ticket 04 does not know the behaviour is its job. The likely result is that nobody builds it, or that 03 ships an untested `inert` on an empty container. The fix is one line: move "View buttons of the footer and the rail are `inert` in focus mode" into 04's scope and Done list, and keep only "the footer is visible and the chip works in focus mode" in 03.

Owner decision:

### 2. Ticket 01 and ticket 04 both claim the badges, and 01's "header looks as before" contradicts a registry that already carries the Pull requests and Pipeline badges

Fact: The registry entry has `useBadge()` (`spec.md:173`), and the badges section defines three of them: Acceptance, Pull requests (`PR_NEED_YOU`) and Pipeline (a dot) (`spec.md:177-184`). Ticket 01 builds the header "из реестра … с нынешним видом", and its Done says "Реестр задаёт … бейдж … у шести видов; … header выглядит как раньше" (`spec.md:382-387`). Ticket 04 lists "бейджи из источников видов" in its own scope (`spec.md:408`). Today only Acceptance has a count on its tab (`src/renderer/shell/Toolbar.tsx:109-113`).

Judgement: If 01 writes all three `useBadge` hooks and the header renders them, Wave 1 puts a Pull requests count and a Pipeline dot in the header. Nobody reviewed that state, and it breaks 01's own "looks as before". If 01 writes the hooks but does not render them, they are dead code until 04, and 04 may write them again. Say it outright: 01 carries only the Acceptance badge, as today; 04 adds the Pull requests and Pipeline badges together with the zones.

Owner decision:

## Alternative

Split ticket 04 now instead of only "if the PR comes out bigger than about 600 lines" (`spec.md:410-411`). 04a would build the header and footer zones, the registry-driven `VIEW_NAMES`, the badges and the width rules. 04b would build the rail block and the "sidebar hidden" fallback, which are the only parts that owner questions A and B (`spec.md:485-496`) touch. That would let 04a start before those answers come in. The plan as written is still better. The default layout puts Pull requests and Acceptance on the rail (Q1), so a 04a without the rail would have to hide two views or invent a temporary placement for them. Also, both questions come with recommendations and are due only before Wave 2, which the owner can answer while Wave 1 runs.

## What the critic cannot know

- There is no product analytics. How often the owner uses each of the six views is unknown, so whether the default zones (Q1) fit real use cannot be checked.
- Two claims were not run, only read: that Playwright `dragTo` can assert zone highlighting in the middle of a native HTML5 drag in Electron (only the end-to-end `dragTo` in `test/e2e/autopilot-start-modal.spec.ts:302` has a precedent), and that Chromium in Electron withholds `dragover` from a `-webkit-app-region: drag` area.
- Ticket 07 edits `src/renderer/guide/topics/…` (`spec.md:435-436`). That path is not in `scripts/e2e-specs.table.json`, so its PR will run every e2e spec, unlike the "Docs PR … без e2e" of `spec.md:363-364`. This costs only CI minutes on free runners, so it is not an objection.
