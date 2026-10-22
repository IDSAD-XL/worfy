# 69 — Linked machine: `docs.close` одного окна снимает документы Project-а у всех окон той же Machine

Type: bug
Status: done 2026-10-22T03:24Z
PR: #726
Branch: worfy-windows/69
Blocked by: —
Source: ревью PR #513 ([Ticket 64](64-закрытие-project-а-в-одном-окне-linked-machine-снимает-watcher-claude-home.md)),
2026-10-19: «Итог» Ticket-а 64, абзац про `docs.open` / `docs.close` перед подразделом «Мерж (2026-10-19)». Ревью нашло это чтением кода; запуском не проверено.
Строки — на main `77c473cb`.

Приоритет — low.

## Что происходит (гипотеза)

- Linked machine B обслуживает все окна Machine A одним client-ом соединения (`LinkPeer`,
  `src/main/link/ipc-adapter.ts`), поэтому окна A для B неразличимы.
- `docs.open` и `docs.close` на B ключуются по client-у и `projectId`: handler-ы — `src/main/ipc/docs.ts:152-159`,
  `docsHub.close(projectId, client.id)`; `DocsHub.close` снимает watcher, когда у Project-а не осталось
  подписчиков (`src/main/docs/watch.ts:499-507`).
- Окна A1 и A2 открыли документы Project-а на B, A1 закрывает — подписка общего client-а снята, и A2
  перестаёт получать `docs.changed`. Тот же дефект Ticket 64 исправил для `claudeHome`, `workflow` и
  `pipeline`: окна считаются на стороне A, в таблице `SUBSCRIBING` (`src/main/ipc/linked.ts:120-124`).
  `docs.open` / `docs.close` в ней нет.

## Что делаем

1. Test: два окна одной Machine на Project-е Linked machine (как в
   `test/contract/linked-shared-subscriptions.test.ts`), оба открыли документы, одно закрыло — второе всё
   ещё получает `docs.changed`. Красный — гипотеза верна; зелёный — записать в «Итог», почему, и закрыть.
2. Если верна: добавить `docs.open` → `docs.close` с ключом `projectId` в `SUBSCRIBING`. Написание ключа —
   как у B (`projectId` — id, не путь: сравнение по строке).

## Готово, когда

- [x] Test пункта 1 красный до правки и зелёный после; мутант без строки `docs.open` в `SUBSCRIBING` —
      красный.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full на Mac.

## Тесты

- `test/contract/linked-shared-subscriptions.test.ts` — случай документов.
- `test/contract/linked-ipc.test.ts` — счёт окон для `docs.open`.

## Где в коде

- `src/main/ipc/linked.ts` — `SUBSCRIBING` (`:120-124`), тип `Spelling` (`:105`).
- `src/main/ipc/docs.ts:152-159` — handler-ы `docs.open` / `docs.close`.
- `test/contract/linked-shared-subscriptions.test.ts`, `test/contract/linked-ipc.test.ts`.

## Итог

Гипотеза верна. Test `docs: one window closes, the other still gets docs.changed` в
`test/contract/linked-shared-subscriptions.test.ts` на main красный: после `docs.close` первого окна
у Project-а на Linked machine B не осталось подписчика (`expected +0 to be 1`). Docs-handler-ы B идут
настоящие (`src/main/ipc/docs.ts`), DocsHub и список Project-ов B — stand-in-ы.

Правка — строка `'docs.open': { close: 'docs.close', key: 'projectId', spelling: 'as-sent' }` в
`SUBSCRIBING` (`src/main/ipc/linked.ts`): окна считаются на Machine A, close уходит на B только от
последнего окна. Ключ сравнивается как прислан: `projectId` — id, не путь.

Mutation testing (оба test-файла): без строки `docs.open` — 2 test-а красные; `spelling: 'resolved'`
— красный test о регистре id в `test/contract/linked-ipc.test.ts`; `close: 'docs.read'` — 2 красных.
`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast green.

### Мерж (2026-10-22)

PR #726 влит 2026-10-22, merge commit `a72c76e6`. Gate full на Mac (дерево head `8666561c` с main, `fcac461a`)
— зелёный: lint, typecheck, test, e2e, package — exit 0. Linux CI — batch CI на main.

- На Windows новый test `docs: …` в `test/contract/linked-shared-subscriptions.test.ts` зелёный. Красные в
  том же файле три test-а `workflow` и `pipeline` — красные и до PR (Windows runner на main `54c1c59a`, run
  39710383134), на Mac зелёные:
  [Ticket 87](87-linked-shared-subscriptions-3-test-а-workflow-pipeline-красные-на-windows.md).
- Вопрос для worfy-link, не найденный дефект: после переподключения link счётчики окон в
  `src/main/ipc/linked.ts:159` не сбрасываются, и окна не шлют `docs.open` заново. Это общее для всех строк
  `SUBSCRIBING`; записано в долг [worfy-polish 36](../../worfy-polish/issues/36-долг-после-review-pr-530.md).
