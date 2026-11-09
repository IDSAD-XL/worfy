# Critic: worfy-pr-inbox — 2026-11-09

Plan: `.scratch/worfy-pr-inbox/spec.md`
Verdict: Reorder — the seven tickets are the right ones, but two `Blocked by:` lines leave out what the Waves table depends on, so `epic-status` will offer ticket 07 and ticket 04 before the work they need has merged.

## Objections

### 1. Ticket 07 (OS notifications and the morning digest) needs the view from ticket 03, and ticket 04 (the `/worfy:pr-reply` skill) shares a file with ticket 02, but neither `Blocked by:` line says so

Fact: `.scratch/worfy-pr-inbox/issues/07-уведомления-и-утренняя-сводка.md:5` is `Blocked by: 02`, while :27 says the click "открывает вид Pull requests на этом PR" and :44 says "Open открывает вид"; ticket 03 creates that view (`issues/03-…md:176`, `ShellView` gets `'pull-requests'`). `issues/04-…md:5` is `Blocked by: 01`, while spec.md:245 says "04 правит `action-templates.ts`, как 02, поэтому не в Wave 1". `harness/bin/TICKETS.md:177-180` defines Unblocked purely from the parsed `Blocked by:` blockers.

Judgement: The waves table (Wave 4 for 07, Wave 2 for 04) exists only in the spec; `epic-status` and anyone picking from its list of ready tickets will see 07 as ready once 02 merges, beside 03, and 04 as ready once 01 merges while 02 may still be editing `projectSettingsSchema` in the same file. The cost is a ticket 07 that cannot pass its e2e "Open opens the view" check without 03, or a merge conflict in `src/shared/projects/action-templates.ts`. The fix is to change two lines: 07 → `Blocked by: 02, 03`; 04 → `Blocked by: 01, 02`. Also, ticket 03 only opens the view on a group (`issues/03-…md:31`). Tickets 06 and 07 both open it on one PR, so 03 should own that entry point too.

Owner decision:

### 2. The notifications trigger counts on a "free 304", but `gh api` exits non-zero on a 304, and the plan's runner and back-off treat a non-zero exit as a failure

Fact: In gh's `pkg/cmd/api/api.go` (https://raw.githubusercontent.com/cli/cli/trunk/pkg/cmd/api/api.go), `if serverError == "" && resp.StatusCode > 299 { serverError = fmt.Sprintf("HTTP %d", …) }` prints `gh: HTTP 304` and returns `cmdutil.SilentError`; `src/main/github/prs.ts:53` says of `ghRunner`: "a non-zero exit rejects with a short reason"; spec.md:89 says "Ошибка — интервал удваивается до 30 минут".

Judgement: When nothing has changed, the trigger's normal answer is 304. Through `ghRunner` as written, that answer looks like a failure. A reader built on it either backs off to 30 minutes in a quiet hour or logs an error on every poll. Ticket 02's contract test "304 уведомлений не вызывает деталей" runs against the gh stub, so it stays green if the stub exits 0 on a 304. Ticket 02 should say how the reader reads a 304: `-i` for the status line and the `Last-Modified`/`X-Poll-Interval` headers, and the `all` output mode so a "gh: HTTP 304" exit counts as "unchanged". The stub should copy gh's exit 1.

Owner decision:

### 3. Ticket 02 also carries the notifications trigger, which the spec itself treats as optional

Fact: spec.md:86-87 defines a working mode without the trigger: a token without the `notifications` scope gets 403 "тогда только поиск", and the view says "checking every 5 minutes"; `issues/02-чтение-pr-inbox-в-main.md:27-28` puts that trigger in the same ticket as search, details, cadence, cache by account, groups, seen-state and the Project switch, with ten contract and unit checks under "Готово, когда".

Judgement: The first useful result of the epic is the read-only view after ticket 03. It waits on the largest ticket, and that ticket includes the part with the gh premise from objection 2. If the trigger moves to its own ticket after 02, the view (02 + 03) can land on search alone, which the spec already accepts as a mode. The trigger then gets a ticket and a review aimed at its 304, header and rate-limit handling. This is a smaller change than the order fix and could be dropped if the owner wants fewer tickets.

Owner decision:

## Alternative

The same seven tickets with two `Blocked by:` lines corrected: 07 → `02, 03`; 04 → `01, 02`. Ticket 03 also gets "open the view on one PR", which 06 and 07 use. The notifications trigger moves out of 02 into a new ticket 08 (`Blocked by: 02`), with the 304 handling of gh written into it. It can run in Wave 2 beside 03 and 04. Wave 2 then gives a working read-only view on 5-minute search, and the trigger only makes it faster. The plan as written is close to this. The reorder is two lines; the split is optional.

## What the critic cannot know

- There is no product analytics, so how many open PRs, threads and review requests the team project has is unknown. The rate-limit estimate in the spec ("меньше 1 % часового бюджета") could not be checked.
- gh's 304 behaviour was read from the `trunk` source of cli/cli, not from the gh version installed on the owner's machines.
- `epic-status` in this worktree shows `worfy-multi-repo-ticket` at 0/8, while `main` already has its tickets 01–03 merged (#1746, #1745, #1748). The ticket statuses here lag behind `main`, so when ticket 06 of that epic (which pr-inbox 06 waits for) will merge could not be judged from them.
- No tests were run. The review reads the spec, the seven tickets, ADR-0105, ADR-0002 and the cited code lines at `cedb3b59b`.
