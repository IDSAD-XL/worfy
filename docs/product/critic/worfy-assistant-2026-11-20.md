# Critic: worfy-assistant — 2026-11-20

Plan: `docs/product/proactive-runtime/drafts/worfy-assistant.md`
Verdict: Split — the attention part (core, closed action list, duties, `worfy-app`, Assistant Session, UI) answers all 28 recorded stalls on its own, while the Slack and Jira adapters rest on a path that is not decided yet and tie the close of the whole Epic to it.

## Objections

### 1. Slack and Jira adapters (tickets 09–11) ride in the same Epic, and "Done when" needs them, though their access path is still open

Fact: the draft says tickets 10 and 11 are built "по решению вопроса 12" (`docs/product/proactive-runtime/drafts/worfy-assistant.md:384-385`), its Status lists the owner's decision on question 12 as still pending (`:7-8`), and "Готово, когда" requires "Владелец … подключил Slack и Jira" (`:429`); the research behind question 12 concludes that "одно общее app worfy вне Marketplace не годится для polling каналов", leaving either a per-user internal app that the Slack API Terms may count as commercial distribution, or Marketplace with at least 10 active workspaces (`docs/product/proactive-runtime/research-внешние-источники.md:535-541`); the stall history counts only agent stops and PR or CI events, none from Slack or Jira (`docs/product/proactive-runtime/drafts/worfy-assistant.md:25`, `docs/product/proactive-runtime/research-история-простоев.md`).

Judgement: the problem the Epic exists for is fully internal to worfy, but its acceptance waits on the least-certain part, a Slack path with distribution and rate-limit questions that may change ticket 10 or drop it. Cut the Epic after ticket 08 + 12–17 without the external sources: tickets 09, 10, 11 and the source part of 14 (setting up sources in the conversation) go to a second Epic opened once question 12 is answered. "Готово, когда" of the first Epic then drops Slack and Jira.

Owner decision: rejected — «Все верно», 2026-11-20, в ответ на предложение советника отклонить: путь к Slack и Jira решён (connectors claude.ai — одна проверка источника и два рецепта), условие самого критика для одного Epic-а выполнено, а владелец просил делать всё сразу.

### 2. The wake decision in ticket 02 needs work hours (03) and the Limits check with the daily cap (04), and ticket 05 needs the duty modes of ticket 06, yet none of them is in `Blocked by:` and each pair shares a Wave

Fact: the "Решение о пробуждении" of the core sends non-urgent items "пачкой в work hours" and runs before each wake "проверка Limits … порог 5-часового окна 80 %. Плюс дневной предел пробуждений" (`docs/product/proactive-runtime/drafts/worfy-assistant.md:216-221`); the table gives that decision to ticket 02 with `Blocked by` "—", work hours to ticket 03 and the Limits check and daily cap to ticket 04, all three in Wave 1 (`:376-378`, `:398`); story 5 wakes the idle Orchestrator only "если я разрешил это режимом обязанности" (`:137`), but ticket 05 is blocked by 02 alone while the duty modes are ticket 06, both in Wave 2 (`:379-380`, `:399`).

Judgement: as written, the implementer of 02 either builds its own work-hours and Limits stubs that 03 and 04 then replace, or leaves the wake decision half-done; the implementer of 05 fires an action with no mode to consult. Move the wake decision out of 02 into a ticket blocked by 02, 03, 04 (or block 02 by 03 and 04), and block 05 by 06 — one extra Wave, no new ticket needed.

Owner decision: accepted — «Все верно», 2026-11-20, в ответ на предложение советника принять: решение о пробуждении — отдельный Ticket после ядра, work hours и проверки Limits; действия закрытого списка — после режимов обязанностей; плюс одна Wave.

### 3. Ticket 05 ("continue any Session after the Limits reset") would not have caught the 41-hour stall that story 4 cites

Fact: the stall of 2026-11-13 (`docs/product/proactive-runtime/research-история-простоев.md:54`) was three implementers that the Orchestrator ran as Subagents: "resume each with SendMessage after reset: ui-kit 07 round 2 (agent ab1d5c16a59a554a9 …), mcp-live 12 round 2 (a8645efde45bd0de3 …), ui-kit 12 (a8e9c33cd89f8c271 …)" (the Orchestrator's memory snapshot `resume-2026-11-12-stable-update.md:50`, outside the repository); Auto-continue of the Orchestrator's manual turn after a Limits refusal was already on main since 2026-11-07 (`d977b27a7`, PR #1548, `src/main/agent/orchestrator-continue.ts`); worfy-retry decided "Повтор только у Orchestrator-а. Session implementer-а — Subagent внутри Claude Code; его ошибку видит Orchestrator и решает сам" (`.scratch/worfy-retry/spec.md:225-226`).

Judgement: extending Auto-continue from the Orchestrator to "any Session" (`drafts/worfy-assistant.md:236`) reaches Canvas Sessions, not Subagents inside a Session, and the plan does not say why the Auto-continue that existed did not resume the Orchestrator that night (switch off, an Orchestrator outside worfy, or the account switch at 00:00). Before ticket 05 is sized, name the cause of that stall; if it was Subagents, the fixed wake message to the Orchestrator ("resume your stopped Subagents") is the action that helps, and "any Session" is the smaller gain. The ticket should also cite worfy-retry decision 3 and the deferred `worfy-limits-out` idea 6 (`docs/research/2026-11-13-competitors/README.md:495`, `:843`), which it takes over.

Owner decision: accepted — «Все верно», 2026-11-20, в ответ на предложение советника принять: Ticket сначала выясняет, почему Auto-continue Orchestrator-а не продолжил работу 2026-11-13; фиксированное сообщение Orchestrator-у просит продолжить остановленные Subagent-ы; продолжение Session на Canvas после сброса Limits остаётся и забирает отложенную идею 6 worfy-limits-out.

## Alternative

Two Epics. `worfy-assistant`: tickets 01–08 and 12–17 without the external sources, the wake decision split from 02 and placed after 03 and 04, ticket 05 after 06 and scoped by the cause of the 41-hour stall; done when the owner has the Assistant on with the internal duties. `worfy-assistant-sources`: Haiku 5.5 sorting (09), Slack (10), Jira (11) and their setup in the conversation, started once question 12 is answered and worfy-polish 135 (PR #2063, Haiku 5.5) is merged. The single-Epic plan is better only if question 12 is answered before Wave 3 and the answer keeps both adapters at one ticket each.

## What the critic cannot know

- How often the owner would act on Slack or Jira items: the stall history has none from them, and there is no product analytics.
- Why Auto-continue did not resume the Orchestrator on 2026-11-13: the memory snapshot does not say whether it was on or whether that Orchestrator ran inside worfy.
- The cost of one Assistant wake on the subscription; the draft does not know it either.
- The draft is not yet in `.scratch/`; there are no ticket files to read, only the table of the draft.
