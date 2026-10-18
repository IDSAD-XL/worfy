# 64 — Linked machine: закрытие Project-а в одном окне снимает watcher Claude home у всех её окон

Type: bug
Status: claimed 2026-10-18T23:20Z
Branch: worfy-windows/64
Blocked by: —
Source: ревью корректности Ticket-а 57 (ПК владельца, 2026-10-18): находка вне diff-а 57, дефект был и
до него. Не проверено.

Приоритет — low.

## Что происходит (гипотеза)

- Все окна одной Linked machine ходят через один `project` client соединения (`LinkPeer`,
  `src/main/link/ipc-adapter.ts:137`).
- Watcher Claude home ключуется по client-у (`src/main/ipc/claude-home.ts`, снятие — около `:108-111`).
- Окно A и окно B на одной Linked machine открыли Project; A закрывает его — watcher снимается для
  общего client-а, и окно B перестаёт получать `claudeHome.changed`.

## Что делаем

1. test: два окна одной Linked machine (один `LinkPeer`), оба открыли Project, одно закрыло —
   второе всё ещё получает `claudeHome.changed`. Красный — гипотеза верна.
2. Считать подписки окон внутри соединения (счётчик или id окна в запросе), снимать watcher, когда
   закрыло последнее. Проверить, нет ли того же у других подписок через `project` client
   (`workflow`, `pipeline`).

## Критерии готовности

- [x] test красный до правки и зелёный после.

## Итог

Гипотеза верна, и не только для Claude home. Test `test/contract/linked-shared-subscriptions.test.ts`
(два окна Machine A на одном Project-е Linked machine B, настоящее link-соединение `LinkBench`,
настоящие handler-ы B над stand-in hub-ами) до правки красный во всех трёх случаях:
`claudeHome.changed`, `workflow.changed` и `pipeline.changed` после close одного окна не доходят до
второго (сначала test проверяет, что событие до close доходит до обоих окон).

Правка — на стороне вызывающей Machine, в `src/main/ipc/linked.ts`, а не на Linked machine: B видит
один `project` client на соединение и окна различить не может, а `linked.invoke` знает окно
(`event.sender`). Таблица `SUBSCRIBING` называет вызовы подписки (`claudeHome.sessions`,
`workflow.open`, `pipeline.get`), их close и поле ключа (`projectRoot` / `root`). Окно считается в
подписку по (Machine, close, ключ как его написало окно) до отправки вызова; close окна, пока
подписку держит другое окно, отвечается здесь `{closed: true}` и до B не идёт; close последнего окна
уходит на B как раньше. Окно, которое закрылось или грузит другую страницу, отпускает свои подписки,
и за последнее окно main сам шлёт close на B. Протокол link и handler-ы B не менялись; root as sent
(PR #511) идёт до B без изменений, поэтому `OpenedRoots` на B работает как раньше.

Test-ы: `test/contract/linked-shared-subscriptions.test.ts` (3, end to end) и новый `describe` в
`test/contract/linked-ipc.test.ts` (4: close не последнего окна, одно окно — один счёт и разные
написания root-а отдельно, закрытие и навигация окна, close без подписки идёт как раньше).
Mutation testing: 5 мутантов в `linked.ts`, 4 убиты, выжил один — удаление пустой записи из карты
(только память, поведение не меняется).

`docs.open` / `docs.close` ключуются на B тем же способом (client и `projectId`) — не проверено и
не правлено, отдельный Ticket при необходимости.
