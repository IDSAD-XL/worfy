# Critic: worfy-pr-follow — 2026-11-14

Plan: `.scratch/worfy-pr-follow/spec.md`
Verdict: Split — the three PR actions and the pr-fix skill do not need PR watch, yet ticket 05 waits for the whole watch chain (01 → 02 → 03), so the user gets no button before Wave 5.

## Objections

### 1. Ticket 05 (the actions) is blocked by ticket 03 (PR watch in main) only for "turn on PR watch after sending"; the buttons reach the user in Wave 5

Fact: `.scratch/worfy-pr-follow/spec.md:567-569` — ticket 05 "Действия в main — action templates …, канал `actions.prFollow`, маршрут и отказы в `launch.ts`, включение PR watch, чистая функция состояния кнопок для 07 и 08 … Blocked by: 03"; `:598-599` — "Пользователь получает кнопки в Wave 5"; the route's steps 2 and 3 (`:136-139`) use only Bindings and a new Session Node, as `prReply` does today (`src/main/actions/launch.ts:241-252`).

Judgement: Fix checks, Resolve conflicts and Address comments plus the skill of ticket 06 already deliver user stories 1–4 (one click, no retelling, push only on the person's click) without any watching; only route step 1 and the "watch on click" hook need ticket 03. Cutting ticket 05 into "actions and route steps 2–3" (Blocked by: —) and "the click turns on PR watch, route step 1" (Blocked by: 03, the first part) — and ticket 07 likewise into the buttons and the "Watch until merge" switch — puts buttons in front of the owner in Wave 2, and lets him judge the pr-fix skill on live PRs before the costlier watch machinery (ticket 03 alone carries state, delivery, ceiling, Limits wait, auto-archive exception, IPC channels and a new ADR with two amendments) is built.

Owner decision:

### 2. The wake rules need reviewer ids and `authorAssociation`, which the PR inbox snapshot the spec reads them from does not have

Fact: `src/main/github/inbox.ts:60` reads a comment as `'id databaseId author { login } body createdAt url'` and `:67` reads reviews as `latestOpinionatedReviews(first: 10) { nodes { author { login } state submittedAt } }` — no `authorAssociation`, no review id, and only the latest review per reviewer; `src/main/github/inbox-groups.ts:7-15` (`InboxComment`) has no such field either; the spec takes these facts from `PrInbox.snapshot` (`.scratch/worfy-pr-follow/spec.md:326-329`) and names only one new field, `isCrossRepository` (`:330`), while the detector's facts are "id, автор и `author_association`" (`:307-308`) and the wake table filters on OWNER, MEMBER or COLLABORATOR (`:106`); the same filter already exists as `TRUSTED` in `src/shared/flight-recorder/pr-facts.mjs:100-112`.

Judgement: ticket 02 as written cannot feed the "new thread or comment from a person with write access" and "new `CHANGES_REQUESTED` review" rows: it has to change the GraphQL query, the zod schema and the types of the closed PR inbox, and a second request for changes by the same reviewer can only be told apart by `submittedAt`. Name these changes in ticket 02 (and in the "Готово, когда" list), and reuse the flight recorder's `TRUSTED` set instead of a third copy of the rule.

Owner decision:

### 3. A parallel draft, worfy-continuity, also has main send a message into a regular Session Node, with its own resume and notice line; this spec calls itself the first case and writes its own ADR

Fact: `.scratch/worfy-pr-follow/spec.md:502-504` — "Новый ADR …: Это первый случай, когда main сам шлёт сообщение Session, которая не Orchestrator"; `.scratch/worfy-continuity/spec.md:301-313` (ticket 05 of that draft, also dated 2026-11-13) — a Session Node is continued through `NodeSessions.start`, gets a `restartText(...)` message and a `notice` line "worfy: restarted at 14:05 (update), sent "continue"".

Judgement: if both drafts are accepted separately, two Epics build two paths for the same act — resume a finished Session Node, wait for the Limits, send one message, show a `notice` — and two ADRs each claiming to be the first. Decide which Epic owns the shared "main sends a message to a Session Node" part (module and ADR), and make the other Epic's ticket 03 / ticket 05 name it in `Blocked by:`.

Owner decision:

## Alternative

Same twelve tickets, cut differently. Wave 1: 01 (detector), 05a (three actions and route steps 2–3, no watch), 06 (pr-fix skill). Wave 2: 02 (reader, with the fields of objection 2), 07a and 08a (buttons in Pull requests, on the Ticket Node and in the Command palette). Then 03 (PR watch in main, sharing the delivery part with worfy-continuity), 04, 05b (click turns on watch), 09, 07b (Watch until merge, chip), 08b (Session Node badge), 10, 11, 12. The spec's own order is still defensible if the owner wants the waiting-without-the-model result (user stories 5–9) as the point of the Epic and sees the buttons as its by-product; then the first useful result is Wave 4, as the spec says.

## What the critic cannot know

- There is no product analytics: how often the owner opens the Needs a fix group, and how many of his PRs sit in it, is not known, so the weight of the buttons against the watch is a guess.
- Whether GitHub changes the ETag of `GET /repos/{o}/{r}/pulls/{n}` when only `mergeable_state` is recomputed after the base moves was not checked against GitHub's documentation; the conflict row depends on it.
- The competitor dossiers the spec cites were not re-verified.
- The brief named the review file with the date 2026-11-13; the critic writes reviews under today's date, 2026-11-14.
