# 04 — Стадии в main: факты по каждому репозиторию, стадия до PR по head-ам веток, `merged`

Type: task
Status: done 2026-11-10T02:10Z
PR: #1752
Branch: worfy-multi-repo-ticket/04
Blocked by: 03
Source: [spec.md](../spec.md), «Как работает» → «epic-status, wave-brief, Pipeline board» («Стадии в main»), «Работа
implementer-а и ревью», «Половина влита (Q4, Q7)»; «Ticket-ы», «Волны» (Wave 2); «Ответ на критику», п. 2; «Решения
владельца 2026-11-09», Q4, Q5, Q7; [ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункты 4, 5, 8, 9;
места из [Ticket 80 Epic-а worfy-polish](../../worfy-polish/issues/80-один-ticket-на-несколько-репозиториев.md)

Платформенный Ticket: нет (вычисление стадий в main). Глубина ревью — `high`: стадия решает, что Pipeline board
показывает и когда Ticket считается готовым.

Ждёт модель Ticket-а `repos` / `prs` из Ticket-а 03.

## Что происходит

- `src/main/workflow/stages.ts:82` — `branchOfTicket`: одна ветка (не меняется: ключ — пара (repo, branch)).
- `stages.ts:152` — `repoOf(ticket)`: один репозиторий из `ticket.repo`; :180 — `prs.read(repo, branches)` по
  репозиторию; :205–206 — `pullOf(...)`: один PR Ticket-а.
- `src/shared/workflow/pipeline.ts:149–152` — у фактов один `headSha` и один `pr` («The Ticket's PR»); стадия
  считается по нему.

## Что делаем

1. Факты Ticket-а — по каждому репозиторию из `repos`.
2. **До PR** стадия берётся по head-ам веток всех `Repo:` (критика, возражение 2): один verdict ревью на набор head-ов
   (Q5); отметка `review` нужна на head каждой ветки; новый head любой ветки снимает verdict всего Ticket-а.
3. **После PR** — по паре (repo, PR). CI — у каждого PR свой; факт CI Ticket-а — сумма: красный любой PR — красный
   Ticket (ADR-0104, пункт 5; исключение для CI потребителя до release — Ticket 05).
4. Стадия Ticket-а — самая ранняя из стадий его репозиториев. `merged` — число влитых PR («1/2 merged»).
5. Частично влитый Ticket остаётся в работе (`claimed`): нового статуса нет (Q4, Q7).
6. Ticket с одним репозиторием — стадии как сегодня.

## Готово, когда

- [ ] Contract test: Ticket из двух репозиториев, ревью отмечено на head одной ветки — стадия не дальше
      `agent-review`; на head-ах обеих — дальше.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-stages.test.ts test/unit/pipeline.test.ts test/contract/workflow-reader.test.ts` exit 0 · mac - · 1ef7646ad3b2d85968134b76143b6b98fba2a9ce
- [ ] Contract test: новый head одной ветки после ревью — Ticket снова на ревью.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-stages.test.ts test/unit/pipeline.test.ts test/contract/workflow-reader.test.ts` exit 0 · mac - · 1ef7646ad3b2d85968134b76143b6b98fba2a9ce
- [ ] Contract test: красный CI любого PR — красный Ticket.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-stages.test.ts test/unit/pipeline.test.ts test/contract/workflow-reader.test.ts` exit 0 · mac - · 1ef7646ad3b2d85968134b76143b6b98fba2a9ce
- [ ] Contract test: один PR влит, второй открыт — стадия по второму, `merged` = 1 из 2, статус `claimed`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-stages.test.ts test/unit/pipeline.test.ts test/contract/workflow-reader.test.ts` exit 0 · mac - · 1ef7646ad3b2d85968134b76143b6b98fba2a9ce
- [ ] Test: Ticket с одним репозиторием — стадии прежние.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-stages.test.ts test/unit/pipeline.test.ts test/contract/workflow-reader.test.ts` exit 0 · mac - · 1ef7646ad3b2d85968134b76143b6b98fba2a9ce
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 1ef7646ad3b2d85968134b76143b6b98fba2a9ce

## Тесты

- Contract `test/contract/workflow-stages.test.ts`; unit `test/unit/pipeline.test.ts`.
- Сначала падающий: на `main` Ticket с двумя `Repo:` получает стадию по одному репозиторию.

## Где в коде

- `src/main/workflow/stages.ts`
- `src/shared/workflow/pipeline.ts`
- `test/contract/workflow-stages.test.ts`
- `test/unit/pipeline.test.ts`
