# 104 — `memory` и `linked` сбрасывают состояние на старте навигации, а не на её коммите

Type: task
Status: open
Blocked by: —
Source: пункт 3 [Ticket-а 103](103-остатки-ревью-pr-753-подписчики-меню-и-сброс-на-навигации.md) (ревью Session
на Mac PR #753), выделен Session на Mac 2026-10-22. Строки — по main `26b926f4`. Замеры — Session на Mac,
Electron 44.5.1.

## Что происходит

Тот же дефект, который ревью нашло и исправило в Ticket-е 96 (C1), остался в двух других местах main.

- `src/main/ipc/memory.ts:50-52`: на `did-start-navigation` главного frame вызывается `drop(client)`, и подписка
  страницы на память перестаёт обновляться.
- `src/main/ipc/linked.ts:248-252`: на том же событии вызываются `release(screen)` и `unsubscribe(screen)`. Окно
  Linked machine теряет свои события, и Machine-у сообщается, что окно отпустило Project.

Замер Session на Mac, Electron 44.5.1: отказанная навигация (`will-frame-navigate`, `src/main/window.ts:368`),
ответ 204 и навигация-загрузка файла дают `did-start-navigation` без `did-navigate`. Страница остаётся прежней,
а её состояние в main уже сброшено. Для человека это значит: счётчик памяти замирает, а окно Linked machine
перестаёт получать события, пока страницу не перезагрузят.

Тип клиента с подпиской на навигацию написан трижды: `Navigating` (`memory.ts:17-19`), `Screen.on`
(`linked.ts:80`), `MenuTarget` (`src/main/ipc/menu.ts:36`).

## Что делаем

Один общий помощник сброса по коммиту нового документа главного frame (`did-navigate`, не same-document),
рядом с `src/main/clients.ts`, вместе с общим типом клиента. Им пользуются `menu`, `memory` и `linked`.
У `memory` и `linked` сброс переходит со старта навигации на коммит.

## Готово, когда

- [x] Contract test-ы `memory` и `linked`: навигация без коммита (старт без `did-navigate`) не сбрасывает
      подписку и не отпускает Project; коммит нового документа — сбрасывает. На main первые — красные.
- [x] `menu`, `memory` и `linked` пользуются одним помощником; отдельных копий типа клиента нет.
- [x] `pnpm lint`, `pnpm typecheck` — exit 0; test-ы меню из Ticket-а 96 зелёные.

## Где в коде

- `src/main/ipc/menu.ts:36`, `:61-62` — `MenuTarget` и сброс на `did-navigate` (Ticket 96).
- `src/main/ipc/memory.ts:17-19`, `:50-52` — `Navigating` и сброс на старте навигации.
- `src/main/ipc/linked.ts:80`, `:248-252` — `Screen.on` и сброс на старте навигации.
- `src/main/clients.ts` — место для общего помощника.
- `src/main/window.ts:368` — `will-frame-navigate`, отказ навигации главного frame.

## Итог

Ветка `worfy-windows/104` от main `2eac77ec`, только коммит (без push и PR); текст PR —
`C:/Users/Alexey/worfy-wt/pr104-body.md`.

- `src/main/clients.ts`: общий тип `NavigatingClient` (Client, у которого может быть
  `on('did-navigate')`) и помощник `onNewDocument(client, reset)` — сброс на коммите нового документа
  главного frame. Electron не шлёт `did-navigate` для навигации внутри документа и для вложенных
  frame. Модуль по-прежнему не трогает Electron во время работы.
- `src/main/ipc/menu.ts`: `MenuTarget` убран, вместо него `NavigatingClient` и `onNewDocument`;
  поведение Ticket-а 96 не изменилось.
- `src/main/ipc/memory.ts`: тип `Navigating` убран; подписка на память сбрасывается на коммите, а не на
  `did-start-navigation`.
- `src/main/ipc/linked.ts`: `Screen` собран из `NavigatingClient`; `release` и `unsubscribe` окна —
  на коммите. Навигация без коммита (отказ в `will-frame-navigate`, 204, загрузка файла) больше не
  отпускает Project и не закрывает подписки окна на Linked machine.
- Test-ы: `test/contract/memory.test.ts` — новый «a navigation that starts but never commits keeps
  the figure of the page that stays», тест перезагрузки переведён на `did-navigate` и проверяет, что
  `did-navigate-in-page` и навигация вложенного frame подписку не сбрасывают.
  `test/contract/linked-ipc.test.ts` — два новых (Project остаётся у окна; окно остаётся в счёте
  подписки, close на Linked machine не уходит), два прежних переведены на `did-navigate`.
- Красные на исходном коде: 5 test-ов (2 в memory, 3 в linked). Мутанты: memory назад на
  `did-start-navigation` — 2 красных; linked назад — 3 красных; помощник со сбросом и на
  `did-navigate-in-page` — 4 красных (memory, linked и test меню Ticket-а 96).
- Проверки: новые test-ы 3 прогона — exit 0; contract и unit test-ы memory, linked, menu, clients,
  `no-rmsync`, `check-cyrillic` — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — в отчёте.
- Ревью, второй коммит: страница ошибки. Если загрузка главного frame падает (View ▸ Reload при
  остановленном dev server, ERR_CONNECTION_REFUSED), Electron показывает страницу ошибки и шлёт
  `did-fail-load` без `did-navigate`; старый код сбрасывал здесь на старте навигации. `onNewDocument`
  теперь сбрасывает и на `did-fail-load` главного frame с кодом, отличным от -3 (ERR_ABORTED): отказ,
  204 и загрузка файла дают -3 или не дают `did-fail-load`. Сигнатура — по `electron.d.ts` Electron
  44.5.1; `NavigatingClient.on` типизирован для обоих событий; параметр помощника сужен до
  `Pick<NavigatingClient, 'on'>` (id не нужен), а memory берёт клиента как `NavigatingClient`.
  Test-ы: по одному в memory и view-menu, два в linked (Project и подписка). Красные до правки — 3
  (memory, linked); мутанты: без ветки `did-fail-load` — 4 красных, без проверки -3 — 7, без
  проверки главного frame — 4.
- e2e не запускался: ни один spec не проверяет сброс memory или linked при навигации
  (`test/e2e/memory.spec.ts` не перезагружает окно). Не проверено в живом Electron, что IPC новой
  страницы приходит после `did-navigate`; на этом же порядке уже стоит меню Ticket-а 96.
