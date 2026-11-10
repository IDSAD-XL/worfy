# 06 — Pipeline board и Ticket Node: одна карточка, N PR, «1/2 merged», «waits for release», chip всех репозиториев

Type: task
Status: claimed 2026-11-10T01:25Z
Blocked by: 05
Source: [spec.md](../spec.md), «Что видит пользователь», п. 5; «Как работает» → «epic-status, wave-brief, Pipeline
board» («Pipeline board и Ticket Node»); «Половина влита (Q4, Q7)»; «Ticket-ы», «Волны» (Wave 4); «Решения владельца
2026-11-09», Q4, Q6; [ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункты 3, 6, 8

Платформенный Ticket: нет (renderer). Глубина ревью — `medium`.

Board показывает факты по репозиториям из Ticket-а 04 и стадию `release` из Ticket-а 05.

## Что происходит

- `src/renderer/pipeline/PipelineBoard.tsx` показывает то, что дал main: один PR на карточку.
- Места, которых нет в списке Ticket-а 80 Epic-а `worfy-polish`: `src/renderer/canvas/nodes/TicketNode.tsx` (chip
  репозитория), `src/renderer/canvas/badges/use-checks.ts` и `src/shared/ipc/checks.ts:121–149` (badge-и проверок
  запрашивают PR ветки в одном репозитории).

## Что делаем

1. Pipeline board: одна карточка на Ticket; PR по одному на строку с именем репозитория; «1/2 merged»; пока release
   нет — «waits for release <version>». Стадия карточки — по самому отстающему репозиторию.
2. Ticket Node: chip называет все репозитории Ticket-а.
3. Badge-и проверок запрашивают PR ветки в каждом репозитории.
4. Связь PR видна только здесь и в файле Ticket-а (Q6): в описаниях PR её нет.
5. Ticket с одним PR выглядит как сегодня.
6. `docs/features/projects.md` (и перевод в `docs/features/ru/projects.md`): карточка Ticket-а из нескольких
   репозиториев.

## Готово, когда

- [ ] Unit test: карточка Ticket-а с двумя PR — две строки PR с репозиториями, «1/2 merged» после merge-а одного.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pipeline-board.test.tsx` exit 0 · mac - · 3bda7855a15bb66c6b45fbd81648c2f70ff06c56
  - evidence: test-run pass · `pnpm test` exit 0 (pipeline-board, review round 1) · mac - · c4643e498a6319bef7c978a935995fdbdf86eaf3
- [ ] Unit test: стадия `release` — «waits for release <version>».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pipeline-board.test.tsx` exit 0 · mac - · 3bda7855a15bb66c6b45fbd81648c2f70ff06c56
  - evidence: test-run pass · `pnpm test` exit 0 (pipeline-board, review round 1) · mac - · c4643e498a6319bef7c978a935995fdbdf86eaf3
- [ ] Unit test: chip Ticket Node называет оба репозитория; badge-и проверок спрашивают оба репозитория.
  - evidence: test-run pass · `pnpm test` exit 0 (ticket-card, checks-badges, github-prs) · mac - · dac571a50d9a29252a701c1e1a353bcef704dd03
  - evidence: test-run pass · `pnpm test` exit 0 (ticket-card, epic-card-repos, checks-badges, canvas-actions, github-prs) · mac - · c4643e498a6319bef7c978a935995fdbdf86eaf3
- [ ] Test: Ticket с одним PR — карточка, chip и badge-и как до правки.
  - evidence: test-run pass · `pnpm test` exit 0 (pipeline-board, ticket-card, checks-badges) · mac - · dac571a50d9a29252a701c1e1a353bcef704dd03
  - evidence: test-run pass · `pnpm test` exit 0 (pipeline-board, ticket-card, checks-badges, canvas-actions) · mac - · c4643e498a6319bef7c978a935995fdbdf86eaf3
- [ ] `docs/features/projects.md` и перевод описывают карточку.
  - evidence: commit pass · One card for a Ticket over several repositories on the board and the Canvas (worfy-multi-repo-ticket 06) · - - · dac571a50d9a29252a701c1e1a353bcef704dd03
  - evidence: commit pass · Review round 1 of worfy-multi-repo-ticket 06: room, whole flags, Open PR per repository · - - · c4643e498a6319bef7c978a935995fdbdf86eaf3
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · dac571a50d9a29252a701c1e1a353bcef704dd03
  - evidence: gate pass · `gate fast` exit 0 · mac - · dac571a50d9a29252a701c1e1a353bcef704dd03
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · c4643e498a6319bef7c978a935995fdbdf86eaf3
  - evidence: gate pass · `gate fast` exit 0 · mac - · c4643e498a6319bef7c978a935995fdbdf86eaf3

## Тесты

- Unit `test/unit/pipeline-board.test.tsx`.
- Сначала падающий: на `main` карточка Ticket-а с двумя PR показывает один.

## Где в коде

- `src/renderer/pipeline/PipelineBoard.tsx`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/badges/use-checks.ts`
- `src/shared/ipc/checks.ts`
- `test/unit/pipeline-board.test.tsx`
- `docs/features/projects.md`, `docs/features/ru/projects.md`
