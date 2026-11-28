# Critic: worfy-schedules — 2026-11-28

Plan: `.scratch/worfy-schedules/spec.md`
Verdict: Reorder — the tickets are mostly right, but Ticket 08's own e2e test needs the scheduler and the run of Tickets 05 and 06, the Run now button of Ticket 07 needs Ticket 06, and the repository writes the plan rests on are not covered by the ADR work of Ticket 01.

## Objections

### 1. worfy main creating worktrees and branches in the Project's repository breaks ADR-0005, and Ticket 01 does not amend it

Fact: `docs/adr/0005-worfy-own-state-inventory.md:7` says "worfy ничего не пишет в репозитории Project-ов … для остальных участников репозитория worfy невидим"; every earlier exception was recorded as its own Amendment (`docs/adr/0101-product-session-folder-and-mind-map.md:63`, "ADR-0005 … получает одно исключение … это записано в раздел `## Amendments` ADR-0005"); `src/main/changes/git.ts:16` refuses `worktree add` for the Changes screen; yet the spec has main run `git fetch` and `git worktree add -b schedule/<slug>/… <Project>/.claude/worktrees/…` (`spec.md:256-258`) and delete clean worktrees with their branches (`spec.md:264`), while it says "В репозиторий Project-а ничего не попадает" (`spec.md:193`) and lists for ADR-0005 only "запись в инвентарь … два файла папки данных" (`spec.md:353`, Ticket 01 at `spec.md:437-439`).

Judgement: This is the first time worfy's own code, not an agent, writes refs, `.git/worktrees` and a folder inside the Project's working copy, and deletes branches. That is a change to a rule in the project's "decisions that must not be broken" list, and the spec records it as an inventory line. Ticket 01 should carry an explicit ADR-0005 exception, a text the owner accepts, and the spec should drop the claim that nothing reaches the repository; otherwise the reviewer of Ticket 06 has to block it against ADR-0005, or pass it silently.

Owner decision: 2026-11-28: accepted (owner «все да»)

### 2. Ticket 08 and Ticket 07 need Tickets 05 and 06, but their Blocked by lines and the waves table do not say so

Fact: Ticket 08 is "Blocked by: 02, 07" and is done when `schedules.spec.ts` is green (`spec.md:458-460`); that e2e test checks "`WORFY_NOW` за 30 с до даты → Node Session с принятым текстом и строка Done" (`spec.md:423-424`), which only the scheduler (Ticket 05) and the run (Ticket 06) produce; the waves table puts 08 in Wave 4 beside 05 (`spec.md:485`); Ticket 07 is "Blocked by: 03" in Wave 3 beside 06 (`spec.md:455-457`, `spec.md:484`), yet it ships the **Run now** button, which starts a run of `run.ts` from Ticket 06.

Judgement: As written, the implementer of Ticket 08 cannot make its done-when test green until 05 lands, and the implementer of Ticket 07 must either stub Run now or write part of `run.ts` in parallel with Ticket 06. Add 05 to Ticket 08's Blocked by line, moving 08 and then 09 one wave later. Either add 06 to Ticket 07's Blocked by line, or move Run now into Ticket 08.

Owner decision: 2026-11-28: accepted (owner «все да»)

### 3. Ticket 06 carries a change to the Approval policy roots that is independent of the run, and does not wait for the ADR that allows it

Fact: Ticket 06 bundles worktree and branch, Claude Code and Codex starts, "корни Approval policy, исходы, Attention item-ы источника `schedule`, уведомления, ADR-0108", with four test files in its done-when, "Blocked by: 03" (`spec.md:452-454`); the roots are set by ADR-0098 point 3 (`docs/adr/0098-approval-policy.md:29`, "worktree-ы Ticket-ов текущей Wave, `.scratch` Project-а …") and coded in `src/main/agent/auto-approve/roots.ts:6-10`; the spec says the new roots are "Amendment ADR-0098, пункт 3 (Ticket 01)" (`spec.md:271`), and Ticket 01 is done only when "ADR принят владельцем" (`spec.md:439`), but no ticket names 01 in its Blocked by line.

Judgement: The roots change is a security change in the auto-approval module of another epic, with its own test (`schedule-approval-roots.test.ts`) and its own ADR. Inside Ticket 06 it gets a review spread over five other concerns, and it can merge before the owner has accepted the Amendment that allows it. Cut it into its own ticket blocked by 01 and 03, and make Ticket 06 blocked by it. Ticket 06 stays the run itself.

Owner decision: 2026-11-28: accepted (owner «все да»)

## Alternative

Keep the 13 tickets, but make Ticket 01 also write the ADR-0005 exception for worfy-made worktrees and branches. Split the roots out of Ticket 06 into a new ticket blocked by 01 and 03, with 06 blocked by it. Add 05 to Ticket 08's Blocked by line. Move Run now from Ticket 07 into Ticket 08. The waves become 01, 02 → 03 → 04, roots, 07 → 06, 10 → 05 → 08, 11 → 09 → 12 → 13. That is one wave longer, but every ticket's done-when test can turn green when the ticket starts. The plan as written is shorter only because two of its done-when tests cannot pass on time.

## What the critic cannot know

There is no product analytics, so how often the owner would really use hourly Schedules, and how many worktrees would pile up, is not known. Whether the attention core can hold an item without a Project (`spec.md:283-285`) was not checked: the spec leaves that to Ticket 06. The Windows behaviour of `setLoginItemSettings` and of a background worfy without a tray was not checked on a Windows machine.
