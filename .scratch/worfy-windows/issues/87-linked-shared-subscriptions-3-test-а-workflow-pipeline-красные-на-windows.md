# 87 — linked-shared-subscriptions: 3 test-а workflow/pipeline красные на Windows

Type: task
Status: done 2026-10-22T04:16Z
PR: #732
Blocked by: —
Source: Windows runner на main `54c1c59a` (`windows-tests.yml`, run 39710383134), 2026-10-22; замечено при
мерже PR #726 ([Ticket 69](69-docs-open-и-close-на-linked-machine-по-общему-client-у.md)). Строки — по main `b1700b18`.

## Что происходит

В `test/contract/linked-shared-subscriptions.test.ts` (два окна Machine A на одном Project-е Linked machine B,
настоящий link, настоящие handler-ы B над stand-in-ами hub-ов) на Windows красные три test-а:

- «workflow: one window closes, the other still gets workflow.changed; the last close lets go on B» — `:287`,
  `bothHear('workflow.changed', fire, 1)`: `expected [ 0, 0 ] to deeply equal [ 1, 1 ]`. Ни одно окно не получило
  `workflow.changed`, хотя оба `workflow.open` ответили `ok: true`.
- «pipeline: one window closes, the other still gets pipeline.changed; the last close lets go on B» — `:302`, то же
  `expected [ 0, 0 ] to deeply equal [ 1, 1 ]`.
- «workflow: windows that spell the root apart (`P` and `P/`) share one subscription on B; the last close ends it» —
  `:342`, `expect(workflow.subscribed()).toBe(1)`: `expected 0 to be 1`.

В run-е строки другие (`:244`, `:259`, `:274`): файл с тех пор вырос — PR #726 добавил test `docs: …`. Этот новый
test на Windows зелёный, `claudeHome: …` и `pipeline: a window destroyed …` — тоже. На Mac все test-ы файла
зелёные. PR #726 эти три test-а не трогал: они красные и до него.

Предположение, не проверено: на Windows корень Project-а пишется в ключе подписки по-разному. В пользу этого:
stand-in hub (`standInHub`, `:130`) считает подписчиков и шлёт изменения по `resolve(PROJECT)`, а после двух
успешных `workflow.open` у него 0 подписчиков под этим ключом. Значит, hub получил корень в другом написании.
Где оно расходится — не проверено. Кандидаты:

- `workflow.open` B для Linked machine отдаёт hub-у настоящий путь, который ответила проверка
  (`src/main/ipc/workflow.ts:52`, `insideProjects`), у `pipeline.get` — `resolve(insideProjects(…))`
  (`src/main/ipc/pipeline.ts:141`).
- Папка test-а — `fs.realpathSync(fs.mkdtempSync(…os.tmpdir()…))` (`:30`). На Windows `fs.realpathSync` (не
  `.native`) не раскрывает короткое имя 8.3, а `%TEMP%` runner-а может быть записан коротким именем.

Если причина в stand-in-е test-а, это дефект test-а; если в ключе подписки `src/main/ipc/linked.ts`
(`subscriptionOf`, `:162`, `spelling: 'resolved'`) или в handler-ах B — дефект продукта на Windows.

## Что делаем

1. На Windows (ПК или runner) напечатать корень, который получает `hub.open` stand-in-а, и `resolve(PROJECT)`.
2. По итогу — правка в test-е (stand-in считает по тому же написанию, что и настоящий hub) или в продукте (один
   ключ для всех написаний корня), с test-ом, красным до правки на Windows.
3. Записать причину в «Итог».

## Готово, когда

- [x] Причина найдена и записана в «Итог»: test или продукт.
- [x] Три test-а выше зелёные на Windows runner-е (`windows-tests.yml` с этим файлом), без skip.
- [x] На Mac файл по-прежнему зелёный; `pnpm lint`, `pnpm typecheck` — exit 0.

## Где в коде

- `test/contract/linked-shared-subscriptions.test.ts:30` (папка test-а), `:99` (`PROJECT`), `:130` (`standInHub`),
  `:283`, `:298`, `:338` (три test-а).
- `src/main/ipc/linked.ts:121` (`SUBSCRIBING`), `:162` (`subscriptionOf`).
- `src/main/ipc/workflow.ts:48`, `src/main/ipc/pipeline.ts:141`.

## Итог

Причина — дефект test-а, не продукта.

- B для вызова Linked machine отдаёт hub-у настоящий путь, который ответил `insideProjects`
  (`src/main/link/caller.ts`, `realpathSync.native`): длинные имена и регистр, как на диске. Stand-in
  hub test-а считал подписчиков и слал изменения по `resolve(PROJECT)`, а `PROJECT` собран из
  `fs.realpathSync` (не `.native`) папки в `os.tmpdir()`. JS-версия `realpathSync` оставляет короткое
  имя 8.3 (`C:\Users\RUNNER~1\…` на GitHub runner-е) и регистр, каким путь написан. Под этим ключом у
  stand-in-а 0 подписчиков, отсюда `[0, 0]` и `expected 0 to be 1`.
- На ПК владельца короткого имени у `%TEMP%` нет (`C:\Users\Alexey\AppData\Local\Temp`, `realpathSync`
  и `.native` совпадают), поэтому файл здесь зелёный. Тот же механизм воспроизводится другим
  написанием `%TEMP%` — регистром: `TEMP=TMP=C:\USERS\ALEXEY\WORFY-WT\TMP87-LONGFOLDERNAME`. Напечатано
  из `hub.open` stand-in-а: `asked=C:\Users\Alexey\worfy-wt\tmp87-longfoldername\worfy-64-yL5fb6\project`,
  `resolve(PROJECT)=C:\USERS\ALEXEY\WORFY-WT\TMP87-LONGFOLDERNAME\worfy-64-yL5fb6\project`; красные
  ровно три test-а тикета (3 failed | 3 passed).
- Продукт ключует корень одинаково для всех написаний: оба окна A приходят через одного client-а
  link-а, и `insideProjects` сводит `P`, `P/`, короткое имя и другой регистр к одному настоящему пути.
  Настоящий hub шлёт изменения подписчикам того ключа, который смотрит, так что окна получают
  `…changed` при любом написании.
- Правка: stand-in считает подписчиков и шлёт изменения по `resolve(realpathSync.native(PROJECT))` —
  корню, который handler-ы B отдают hub-у. `PROJECT` остался в написании `os.tmpdir()`, так что на
  runner-е окна по-прежнему шлют корень с коротким именем. После правки файл зелёный 3 раза подряд и
  с обычным `%TEMP%`, и с `%TEMP%` в другом регистре (6 passed каждый раз).

### Мерж (2026-10-22)

- PR #732 влит как `206b8aea`.
- Windows runner, run 39718973337 (head `315bb0eb`): `linked-shared-subscriptions.test.ts` зелёный.
  Run в целом красный: в нём же шёл `link-access.test.ts`, его три test-а, которые ждут echo от
  PowerShell, красные на runner-е и до PR #729.
- На Mac, на дереве мержа с main: `pnpm lint`, `pnpm typecheck` и этот файл (6/6) — EXIT=0.
- Gate full не запускался: из кода PR меняет один файл test-а, 17 строк (плюс текст этого тикета).
