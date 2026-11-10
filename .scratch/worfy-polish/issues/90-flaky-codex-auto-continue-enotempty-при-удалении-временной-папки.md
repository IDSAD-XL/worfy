# 90 — Flaky test: `codex-auto-continue.test.ts` падает с ENOTEMPTY, удаляя свою временную папку

Type: bug
Status: open
Blocked by: —
Source: находка Orchestrator-а 2026-11-10 в локальном gate fast на Mac (запуск 03:32Z; повтор в 03:38Z зелёный).
В CI за 2026-11-09…11-10 не найдено: в log-ах job-ов `linux-tests`, `macos-tests` и `windows … / full-suite` этот
test ни разу не упал и не дал строки FLAKY. Строки перечитаны по main `100acec94`.

## Что происходит

`test/contract/codex-auto-continue.test.ts:73` — test «serverOverloaded, then a turn that goes through: turn-retry 1
of 5, one continuation at the timer, resumed». Сам test прошёл все свои проверки; упал `afterEach` модуля
`test/contract/autopilot-faults-setup.ts`, который после каждого `faultRun` всё останавливает и удаляет временную
папку:

```
Error: ENOTEMPTY, Directory not empty: '/private/var/folders/…/T/worfy-autopilot-faults-bMcR8Z'
 ❯ removeTree src/main/storage/remove.ts:387:8
 ❯ removeTestTree test/remove.ts:17:3
 ❯ test/contract/autopilot-faults-setup.ts:277:23
 ❯ test/contract/autopilot-faults-setup.ts:191:61
```

`afterEach` (:189–192) вызывает cleanup-и в обратном порядке: `autopilot.stopAll()` (:496), `registry.closeAll()`
(:368), `SIGKILL` процессам fake Codex app-server (:336–343), stub-процессам (:319), и последним
`removeTestTree(scratch)` (:277). Вне Windows `removeTree` — это `fs.rmSync(path, { recursive: true, force: true })`
(`src/main/storage/remove.ts:387`). ENOTEMPTY от него значит: пока `rmSync` обходил папку, в неё кто-то записал
новый файл. Значит, после cleanup-ов ещё что-то пишет в `scratch`: например, journal Run-а, `LimitsTracker`
(`dataDir` в `scratch/data-root`, :279, :322), log fake app-server-а или отложенная запись, которую `stopAll` не
дождался. Кто именно — неизвестно.

## Что делаем

- Сначала найти писателя: прогнать файл много раз (например, 100) под нагрузкой полного `pnpm test`; при ENOTEMPTY
  перед повтором удаления вывести список того, что появилось в `scratch` после начала `rmSync` (имена и mtime).
  Писатель и счёт падений — в «Итог».
- Исправить источник: cleanup должен дождаться конца записи писателя (await его `stop`/`close` или flush) до
  удаления папки. Если это код приложения (запись после `stop`), исправить в нём и закрыть test-ом.
- Не прятать гонку повтором удаления (`maxRetries`) в `removeTestTree` или `removeTree` и не поднимать пределы
  времени: запись после остановки — это ошибка, её надо закрыть.

## Готово, когда

- [ ] Писатель, который пишет в `scratch` после cleanup-ов, назван в «Итог» с file:line.
- [ ] `node scripts/vitest-electron.mjs test/contract/codex-auto-continue.test.ts` под нагрузкой полного
      `pnpm test` 50 раз подряд — 0 падений; команда и счёт в «Итог»; до исправления — сколько падений.
- [ ] Остальные файлы, что импортируют `autopilot-faults-setup.ts` (`autopilot-faults-*.test.ts` и другие), —
      зелёные.
- [ ] `removeTree` и `removeTestTree` не получили повторов удаления; общие пределы времени не изменены.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `test/contract/codex-auto-continue.test.ts:73` — test; :66 — `codexRun`.
- `test/contract/autopilot-faults-setup.ts:189` — `afterEach` с cleanup-ами; :276–277 — `scratch` и его удаление;
  :279 — `data-root`; :322 — `LimitsTracker`; :336 — `SIGKILL` процессам fake Codex; :368 — `registry.closeAll()`;
  :496 — `autopilot.stopAll()`.
- `test/remove.ts:16` — `removeTestTree`; `src/main/storage/remove.ts:387` — `fs.rmSync` вне Windows.

## Вне скоупа

- Удаление на Windows (`removeTree` по шагам) и `test/unit/no-rmsync.test.ts`.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.
