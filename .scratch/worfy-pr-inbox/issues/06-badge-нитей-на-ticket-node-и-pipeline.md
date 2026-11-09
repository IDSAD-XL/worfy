# 06 — Badge нитей ревью на Ticket Node и строка «Waits: N answers» на карточке Pipeline

Type: task
Status: open
Blocked by: 02, 03, `worfy-multi-repo-ticket` 06
Source: [spec.md](../spec.md), «Что видит пользователь», п. 6; «Как работает» → «Связь с Ticket-ом (Ticket 06)»;
«Решено без владельца»; «Риски» («Общие файлы с `worfy-multi-repo-ticket`»); «Ticket-ы», «Волны» (Wave 3); решение
Q1; [ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункт 3; Ticket 06 Epic-а
[worfy-multi-repo-ticket](../../worfy-multi-repo-ticket/issues/06-pipeline-board-и-ticket-node-одна-карточка-несколько-pr.md)

Платформенный Ticket: нет (renderer). Глубина ревью — `medium`.

Ждёт Ticket 06 Epic-а `worfy-multi-repo-ticket` (Pipeline board и Ticket Node с несколькими PR): тот правит те же
Ticket Node и Pipeline board. Третий пункт строки `Blocked by:` — чужой Epic, поэтому `epic-status` не разбирает
строку и не считает Ticket свободным сам: Orchestrator берёт его, когда тот Ticket влит.

## Что происходит

- Badge-и Ticket Node — слот: новый badge — один файл в `src/renderer/canvas/badges/`, файлы Node-ов не меняются
  (`src/renderer/canvas/badges/index.ts:1-12`). `ChecksBadges.tsx:12-17` рисует gate, PR, CI и verdict.
- Стадия `human-review` знает только `reviewDecision === 'APPROVED'` (`src/shared/workflow/pipeline.ts:248-249`);
  стадии команды — `human-review` и `awaiting-merge` (`pipeline.ts:23`).
- PR Ticket-а — `repoFactsOf().prs` (`src/shared/workflow/types.ts:95`): пары (repo, N); до номера — (repo, branch).

## Что делаем

1. `src/renderer/canvas/badges/ReviewThreads.tsx`: на Ticket-е, чей PR есть в снимке PR inbox (`usePrInbox.ts` из
   Ticket-а 03, без правки), — «N open threads» (нерешённые нити, где последнее слово не пользователя) и/или
   «changes requested». Щелчок открывает вид Pull requests на этом PR (`openPrInboxOf` из Ticket-а 03). Нет PR в снимке — badge нет.
2. Ticket с несколькими репозиториями — сумма по его PR; связь PR живёт только в worfy (ADR-0104, пункт 3).
3. Карточка Pipeline в стадии `human-review`: строка «Waits: N answers» (`src/renderer/pipeline/board.ts`,
   `PipelineBoard.tsx`).
4. `docs/features/gate-and-github.md`, раздел «PR and CI badges», — новый badge и строка Pipeline.

## Готово, когда

- [ ] Unit test: Ticket с PR, у которого 3 нерешённые нити и `CHANGES_REQUESTED`, — «3 open threads» и «changes
      requested»; без нитей — badge нет.
- [ ] Unit test: Ticket из двух репозиториев — сумма нитей обоих PR; PR находится и по (repo, branch) до номера.
- [ ] Unit test: карточка Pipeline в `human-review` — «Waits: 2 answers»; в других стадиях строки нет.
- [ ] Test: Ticket без PR в снимке — Node и карточка как до правки.
- [ ] E2e test: щелчок по badge открывает вид Pull requests на этом PR; журнал stub-а gh без записей.
- [ ] `docs/features/gate-and-github.md` описывает badge и строку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Unit `test/unit/review-threads-badge.test.tsx` (новый), `test/unit/pipeline-board.test.tsx`; e2e — случай в
  `test/e2e/pr-inbox.spec.ts` не добавляется (файл Ticket-а 05 той же Wave): щелчок по badge — в
  `test/e2e/checks-badges.spec.ts`.
- Сначала падающий: на `main` Ticket Node с PR, у которого нерешённые нити, ничего о них не показывает.
- Ни настоящего GitHub, ни модели: снимок — fixture, gh — stub через `WORFY_GH`; выдуманные владельцы и login-ы.
- Ничего не публикуется без щелчка: badge и карточка только читают снимок; e2e проверяет пустой журнал записей stub-а.

## Где в коде

- `src/renderer/canvas/badges/ReviewThreads.tsx` (новый)
- `src/renderer/pipeline/board.ts`
- `src/renderer/pipeline/PipelineBoard.tsx`
- `test/unit/review-threads-badge.test.tsx` (новый)
- `test/unit/pipeline-board.test.tsx`
- `test/e2e/checks-badges.spec.ts`
- `docs/features/gate-and-github.md`
