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

- [ ] Contract test-ы `memory` и `linked`: навигация без коммита (старт без `did-navigate`) не сбрасывает
      подписку и не отпускает Project; коммит нового документа — сбрасывает. На main первые — красные.
- [ ] `menu`, `memory` и `linked` пользуются одним помощником; отдельных копий типа клиента нет.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; test-ы меню из Ticket-а 96 зелёные.

## Где в коде

- `src/main/ipc/menu.ts:36`, `:61-62` — `MenuTarget` и сброс на `did-navigate` (Ticket 96).
- `src/main/ipc/memory.ts:17-19`, `:50-52` — `Navigating` и сброс на старте навигации.
- `src/main/ipc/linked.ts:80`, `:248-252` — `Screen.on` и сброс на старте навигации.
- `src/main/clients.ts` — место для общего помощника.
- `src/main/window.ts:368` — `will-frame-navigate`, отказ навигации главного frame.
