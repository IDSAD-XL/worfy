# 64 — Linked machine: закрытие Project-а в одном окне снимает watcher Claude home у всех её окон

Type: bug
Status: done 2026-10-19T07:50Z
PR: #513
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

### Круг 2 (ревью PR #513)

- workflow и pipeline считаются по папке, как их hub-ы на B (path.resolve реального пути), а не по
  написанию: `\` как `/`, `.`, `..`, двойные и хвостовые разделители убраны, регистр сложен
  (`resolvedKey` в `linked.ts`). Ключ шире, чем у B: это безопасная сторона — close ждёт, пока
  отпустят все окна, и тогда уходит на B для каждого присланного написания (B помнит каждое в
  `OpenedRoots`). Сначала уходит close самого окна, потом остальные; если окно подписалось снова,
  пока close был в пути, остальные написания не закрываются. claudeHome остаётся по написанию, как на
  B (`claude-home.ts:86`).
- Окно, уничтоженное до того, как его open дошёл до handler-а, не считается, и open на B не идёт:
  ответ `{ok:false}` «the window is gone».
- Close от окна, которого нет в счёте, пока подписку держат другие окна, отвечается здесь
  `{closed:false}` и до B не идёт.
- `SUBSCRIBING` типизирован через `satisfies`: переименование канала или поля ключа ломает
  typecheck (проверено двумя правками, exit code 2).
- Test-ы: в `linked-shared-subscriptions.test.ts` добавлены два end to end — `P` и `P/` у workflow, и
  destroy окна во время open у pipeline; в `linked-ipc.test.ts` — написания одной папки, claudeHome по
  написанию, close неучтённого окна, две Linked machine с одним путём, уничтоженное окно, повторная
  подписка во время последнего close. Mutation testing: 9 мутантов, все убиты.
- Переподключение (смена epoch) test-ом не покрыто: окна на B перезагружаются
  (`useProjects.ts`), навигация снимает их счёт, close последнего уходит на новый client B и
  отвечает `closed:false`. Дефекта ревью не нашло.

`docs.open` / `docs.close` ключуются на B тем же способом (client и `projectId`), дефект
подтверждён ревью; Orchestrator заводит отдельный Ticket.

### Мерж (2026-10-19)

PR #513 влит 2026-10-19, merge commit `bfd15a32`. Head `c0c54a30` (rebase на `a280e649`): gate full на Mac —
зелёный; не платформенный PR — `check/windows` skipped; ревью круга 2 — принято.

- Долг (low, ревью круга 2): `src/main/ipc/linked.ts:232` — окно подписалось снова, пока close последнего
  окна был в пути: `after` не шлёт close остальных написаний. На B с case-sensitive ФС, где `/x/P` и `/x/p` —
  два Project-а, close второй папки не уходит, и watcher живёт до разрыва связи (события не теряются).
  Правка: переносить старые написания в новую запись.
- Вне diff-а: `src/main/workflow/watch.ts:581` — B держит одного подписчика на (client, root), и события
  несут написание последнего open; сейчас недостижимо.
- `docs.open` / `docs.close` на B — [Ticket 69](69-docs-open-и-close-на-linked-machine-по-общему-client-у.md).
