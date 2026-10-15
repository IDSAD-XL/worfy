# 19 — First run: «Check again» снимает запись о неудаче действия, когда проверка строки уже проходит

Type: task
Status: claimed — 2026-10-15
Branch: worfy-week/19
Blocked by: —
Source: наблюдение владельца 2026-10-10 во время прогона Autopilot для пункта 3 приёмки E3 (`worfy-harness` 26): окно «First run» открылось само с «1 failed: qmd collections — The last attempt failed: …/.claude/bin/qmd-sync-main: No such file», хотя сама проверка проходила. Уровень — low.

## Что происходит

Окно «First run» показывает строки проверок машины и Project-ов. У строки есть действие (например,
«Set up qmd collections»). Если действие закончилось неудачей, её текст запоминается и показывается
в строке вместо результата проверки.

- `FirstRunActions.failures` (`src/main/first-run/actions.ts:95-96`) — `Map` «проверка → текст
  последней неудачи действия», живёт в памяти main-процесса.
- `report()` (`actions.ts:104-114`) берёт свежие проверки и для каждой строки, у которой есть запись
  в `failures`, заменяет статус на `fail`, а подсказку — на `The last attempt failed: <текст>`
  (`:110`). Результат самой проверки при этом не учитывается.
- Запись снимается только следующим запуском действия этой строки (`actions.ts:123`). «Check again»
  (`src/renderer/shell/FirstRun.tsx:294`) зовёт `firstRunChecks` → `report()`
  (`src/main/ipc/first-run.ts:183`) и запись не трогает.
- Поэтому причина, устранённая вне worfy, остаётся на экране как `fail` до перезапуска приложения
  или до повторного действия. Случай 2026-10-10: действие упало из-за старого пути
  `~/.claude/bin/qmd-sync-main`; после этого `~/.config/qmd/index.yml` исправлен на
  `plugin/bin/qmd-sync-main`, проверка `qmd collections` проходит (worfy: 3, auction: 3,
  `refresh.log` — update rc=0, embed rc=0), а строка всё равно красная.
- Эта же строка считается «новой неудачей» при старте окна (`first-run.ts:175-182`, `fresh`): окно
  открывается само, хотя чинить нечего.

## Что делаем

Запись о неудаче действия показывается, только пока сама проверка строки не проходит.

1. В `report()`: если свежая проверка строки имеет статус `ok`, запись из `failures` для неё
   удаляется и строка возвращается как есть. Иначе — как сейчас: `fail` и текст последней неудачи.
2. `firstRunStartup` получает уже очищенный отчёт: устранённая неудача не делает строку «новой» и
   окно само не открывается.

## Готово, когда

- [x] Действие строки упало, затем проверка этой строки стала `ok`: `report()` отдаёт строку `ok` без
      текста «The last attempt failed», и запись из `failures` снята (повторный `report()` при
      снова упавшей проверке показывает результат проверки, а не старый текст действия).
- [x] Действие строки упало, проверка по-прежнему не `ok`: строка — `fail` с текстом последней
      неудачи, как сейчас.
- [x] `firstRunStartup` не возвращает `show: true` из-за строки, чья проверка уже `ok`.
- [x] Test-ы краснеют на мутанте, который возвращает прежнее поведение `report()`.

## Где в коде

- `src/main/first-run/actions.ts` — `report()` (`:104-114`), `failures` (`:95-96`), `run()` (`:117-131`).
- `src/main/ipc/first-run.ts` — `firstRunStartup` (`:175-182`), `firstRunChecks` (`:183`).
- `test/contract/first-run-checks.test.ts` — test-ы `FirstRunActions`; текст «The last attempt
  failed» проверяется на `:569` и `:573`.
- `src/renderer/shell/FirstRun.tsx` — кнопка «Check again» (`:294`); правка renderer-а не нужна.

## Вне скоупа

- Хранение неудач между запусками приложения.
- Тексты и состав проверок; действие «Set up qmd collections» само по себе.

## Риски

- Действие может упасть, когда проверка строки уже `ok` (действие обновления, а не установки). Тогда
  неудача после правки не видна в строке. Результат действия при этом всё равно показывается сразу
  после запуска (`ActionResult` в ответе `firstRunRun`); проверить на test-е, что он не теряется.

## Итог

`FirstRunActions.report()` (`src/main/first-run/actions.ts`) снимает запись о неудаче действия у
строки, чья свежая проверка `ok`, и отдаёт строку как есть; иначе строка — `fail` с текстом
последней неудачи, как раньше. `firstRunStartup` получает отчёт из того же `report()`, поэтому
устранённая неудача окно само не открывает; код `src/main/ipc/first-run.ts` изменился только
комментарием. Renderer не тронут.

Test-ы — `test/contract/first-run-checks.test.ts`:
- «a failed action stays on its row only while the check of the row does not pass…» — неудача
  `qmd collections` видна, пока проверка `warn`; проверка стала `ok` — строка `ok` без «The last
  attempt failed»; проверка снова `warn` — строка показывает саму проверку (запись снята, а не
  спрятана).
- «an action that fails while its check already passes still answers with its error…» — риск
  тикета: `ActionResult.message` сохраняет текст неудачи, строка остаётся такой, какой её нашла
  проверка.
- «a failed action whose check passes now does not open the screen by itself» — обработчики
  `src/main/ipc/first-run.ts` (Electron и окружение подменены): при непрошедшей проверке
  `show: true`, после `ok` — `show: false`.
- Помощник `actions()` в test-ах теперь отдаёт проверкам те же Project-ы, что действию: прежний
  test «a failing script makes the row fail with its output» проходил лишь потому, что проверка
  `qmd collections` не видела Project без коллекций и была `ok`.

Мутанты: прежний `report()` — красные три новых test-а; мутант «строка `ok` возвращается, но
запись не снимается» — красный первый. `pnpm lint && pnpm typecheck && pnpm test` — код 0,
gate fast — код 0, «[gate] зелено (fast)».
