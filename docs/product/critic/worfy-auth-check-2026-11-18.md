# Critic: worfy-auth-check — 2026-11-18

Plan: `.scratch/worfy-auth-check/spec.md`
Verdict: Split — ticket 01 (the spike, a short experiment) joins a local reproduction anyone can run with a SAML SSO reproduction that needs an outside tester, so the fix for the tester's own case waits on that person.

## Objections

### 1. Ticket 01 joins two independent experiments, and the SAML half holds up the whole GitHub track

Fact: `.scratch/worfy-auth-check/spec.md:260-263` gives ticket 01 two jobs: trace how `GH_TOKEN` from `launchctl setenv`/`setx` reaches gh, and reproduce an SSO 403 on a SAML organization. `:295` says "SAML SSO есть только у GitHub Enterprise Cloud (Q3)", and Q3 (`:313-314`) recommends that the tester run a script and send back its output. `:269` blocks ticket 04 (GitHub access) on 01, and `:273` blocks ticket 06 (Codex, Browser, Link) on 04 only because both edit `checks.ts`.

Judgement: The tester's actual case is a token from the environment plus an empty `github.account`, fixed by the "Use <login>" button. That case, and the 401/404 answers, can be built from the local half of the spike, on the owner's own Mac and PC. Only the SSO parsing needs the SAML answer. As planned, an outside person's reply gates tickets 04, 05 and 06 and so the acceptance ticket 08. Codex, Browser and Link have no GitHub content at all, yet they wait too.

Owner decision:

### 2. The new critical rows will open the First run window by themselves at start, and the spec does not say whether they should

Fact: `src/main/ipc/first-run.ts:215` opens First run at start when `check.status === 'fail' && check.opensFirstRun !== false` for a row that was not failing when the window was last closed. `src/shared/ipc/first-run.ts:71-75` documents `opensFirstRun: false` as the opt-out. The spec names `opensFirstRun` nowhere, and `:130` keeps the start-up check "как сейчас".

Judgement: A Project's GitHub access row (no login, no access, SSO) is critical and would be a `fail`. It would pop the First run dialog on an existing user's next start, on top of the new red dot. The start-up decision also awaits the whole report, and that report now includes one `gh api` call per repository. Ticket 02 should decide which new rows set `opensFirstRun: false` (most likely all Project rows and all rows fed by feature reports), and whether network rows are left out of the start-up report.

Owner decision:

### 3. "Use <login>" names a write path that does not exist; the project's one-field writer is `bin/profile-set --field`

Fact: The spec (`:141-143`) says the write goes "тем же путём, что в диалоге (`src/main/projects/connect.ts`)". `src/main/projects/connect.ts:39-40` says of the account choice: "The choice goes into the draft and is written with it; there is no write of its own", and `:33-35` routes every write through `bin/project-connect`. `harness/bin/profile-set:1-6` writes single Profile fields with `--field`. worfy already calls it that way in `src/main/ipc/code-stories-setting.ts:3` and for the MCP Allow button (`src/main/ipc/agent.ts:371`).

Judgement: If ticket 04 follows the spec literally, it would rerun the whole connect draft, or build a new writer, for one field of an already connected Project. Naming `bin/profile-set --field github.account` and the `code-stories-setting.ts` pattern in ticket 04 avoids both. The ticket should also say that `profile-set` commits the change in the Harness home (`harness/bin/profile-set:46`).

Owner decision:

## Alternative

Split ticket 01 into 01a, the local `GH_TOKEN` path and `gh auth token -u` on Mac and PC (Blocked by: —), and 01b, the SAML SSO answers of REST and GraphQL from the tester's script (Blocked by: —, waits on Q3). Split ticket 04 the same way. 04a covers the token source, the honest `gh-auth` row, the Project row with 401/404, and "Use <login>" through `profile-set` (Blocked by: 01a, 02). 04b covers the SSO and `partial-results` parsing and the SSO link (Blocked by: 01b, 04a). Ticket 06 waits on 04a only, or puts its Codex row in its own module and drops the 04 block. Ticket 05 waits on 04b only for the SSO text of the PR inbox. The tester's own case then ships after Wave 2 even if the SAML reply never comes. Keeping the plan as written is better only if the tester's script reply is already in hand.

## What the critic cannot know

No product analytics: how many users have a `GH_TOKEN` in their environment or use SAML organizations is unknown. Whether GitHub's GraphQL search really answers 200 with `X-GitHub-SSO: partial-results` for this tester's organization was not checked: it needs a SAML organization. Whether the tester is available to run the spike script is not known. The checkout is at `a8f1faef5`, behind `main`. The worfy-pr-follow tickets still open (04: buttons in `PrInboxView.tsx`; 05: lines in `palette/commands.ts`) edit files that this epic's tickets 03 and 05 also edit. That overlap was not weighed as an objection.
