# 87 — linked-shared-subscriptions: 3 test-а workflow/pipeline красные на Windows

Type: task
Status: open
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

- [ ] Причина найдена и записана в «Итог»: test или продукт.
- [ ] Три test-а выше зелёные на Windows runner-е (`windows-tests.yml` с этим файлом), без skip.
- [ ] На Mac файл по-прежнему зелёный; `pnpm lint`, `pnpm typecheck` — exit 0.

## Где в коде

- `test/contract/linked-shared-subscriptions.test.ts:30` (папка test-а), `:99` (`PROJECT`), `:130` (`standInHub`),
  `:283`, `:298`, `:338` (три test-а).
- `src/main/ipc/linked.ts:121` (`SUBSCRIBING`), `:162` (`subscriptionOf`).
- `src/main/ipc/workflow.ts:48`, `src/main/ipc/pipeline.ts:141`.

## Итог
