# 26 — Test-ы на Windows оставляют папки в `%TEMP%` и падают: `afterEach` удаляет через `rmSync`

Type: task
Status: open
Blocked by: 23
Source: замеры Session на Windows-ПК 2026-10-12, переданы Session на Mac сообщениями; все числа ниже — её

## Что происходит

- **`afterEach` чистит временную папку через `fs.rmSync` с `recursive`.** Под Node 24.21.0 из
  Electron 44.5.1 на Windows этот вызов бросает EPERM на файле «только для чтения». Такие файлы —
  объекты git: test создаёт во временной папке репозиторий. Причина та же, что в Ticket-е 23
  (общая функция удаления для `src/main` и `scripts/`). Test-ы вынесены из Ticket-а 23 сюда: его PR
  уже большой, а правка `afterEach` — механическая и проверяется отдельно.
- **Следствие первое: test падает.** Из 681 падения `pnpm test` на Windows у 153 в причинах есть
  этот EPERM, у 68 — только он. По файлам: `harness-migrate` 54, `projects` 24, `docs` 22,
  `projects-connect` 21, `clients` 10, `shell` 10, `harness-drift` 9, `build-version` 2,
  `canvas-tools` 1.
- **Следствие второе: папка остаётся.** Один полный `pnpm test` оставляет около 250 папок `worfy-*`
  в `%TEMP%`. За 2026-10-09 — 2026-10-12 на ПК владельца их набралось 9510 (`worfy-migrate` 2268,
  `worfy-canvas` 1134, `worfy-docs` 959, `worfy-projects` 946 и мельче); объём не замерен.
- **Что уже сделано в PR Ticket-а 23:** в двух файлах `afterEach` зовёт новую функцию удаления.
  `harness-migrate`: 54 падения → 25; `build-version`: 2 → 0. Папок после прогона: 253 → 248.
- **Сколько всего мест.** На main `81930f0` в `test/` — 158 вызовов `rmSync` в 57 файлах (grep).
  Какие из них удаляют папку с репозиторием git, не разбиралось.

## Что делаем

1. **Один helper удаления для test-ов** — обёртка над общей функцией Ticket-а 23 — в папке, которую
   видят и `test/unit`, и `test/contract`. Имя и место выбирает исполнитель; в «Итог» — почему.
2. **Семь файлов из списка падений** переходят на helper: `test/contract/projects.test.ts`,
   `docs.test.ts`, `projects-connect.test.ts`, `clients.test.ts`, `shell.test.ts`,
   `harness-drift.test.ts`, `canvas-tools.test.ts`.
3. **Остальные файлы с `rmSync` в `test/`:** перевести все или только те, что удаляют папку с
   репозиторием git, — решить по замеру. Замер: число папок `worfy-*` в `%TEMP%` до и после одного
   полного `pnpm test`. Цель — 0 новых папок. Решение и числа — в «Итог».
4. **Test против возврата** — по образцу запрета `rmSync` в `src/main` из Ticket-а 23: красный, если
   рекурсивный `rmSync` снова появился в `test/`. Если переведены не все файлы — со списком
   исключений в самом test-е.

## Готово, когда

- [ ] Windows-ПК: после одного полного `pnpm test` новых папок `worfy-*` в `%TEMP%` — 0. Числа до и
      после — в «Итог».
- [ ] Windows-ПК: падений с EPERM от `rmSync` в `afterEach` — 0 (сейчас 153, из них 68 только с
      ним). Общее число падений `pnpm test` до и после — в «Итог».
- [ ] Семь файлов из пункта 2 зовут helper; test из пункта 4 красный, если вернуть `rmSync`.
- [ ] macOS и Linux не меняются: `pnpm test` — exit code 0; `gate full` на Mac зелёный.

## Тесты

- Test против возврата (пункт 4). Его мутант: вернуть `rmSync` в один из семи файлов — test красный.
- Сами семь файлов: на Windows-ПК число их падений до и после — таблицей в «Итог».

## Где в коде

- `test/contract/{projects,docs,projects-connect,clients,shell,harness-drift,canvas-tools}.test.ts` —
  `afterEach` с `rmSync`.
- `test/contract/harness-migrate.test.ts`, `test/unit/build-version.test.ts` — уже переведены в PR
  Ticket-а 23; образец.
- Общая функция удаления — модуль из Ticket-а 23 (имя — в его «Итог»).

## Вне скоупа

- Удаление уже накопленных папок в `%TEMP%` на ПК владельца: решает владелец (`HANDOFF.md`, «Ждёт
  владельца»).
- Остальные причины падений `pnpm test` на Windows — Ticket 14 (gate full на Windows).
- `test/contract/trash.test.ts`, который на Windows падает целиком («untrusted frame», путь macOS в
  `INDEX_HTML`), — Ticket 14.

## Риски

- **Helper зависит от кода приложения.** Ошибка в общей функции удаления станет ошибкой чистки во
  всех test-ах сразу. Её собственные test-ы — в Ticket-е 23.
- **Часть папок может оставаться по другой причине** (процесс ещё держит файл). Тогда цель «0 новых
  папок» не достигается одной заменой; остаток — списком в «Итог».

## Итог
