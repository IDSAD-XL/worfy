# 90 — Flaky test: `codex-auto-continue.test.ts` падает с ENOTEMPTY, удаляя свою временную папку

Type: bug
Status: claimed 2026-11-10T07:27Z
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
  - evidence: commit pass · Wait for the run's PR reads before removing the faults test folder (worfy-polish 90) · - - · 270bf4f7e
- [ ] `node scripts/vitest-electron.mjs test/contract/codex-auto-continue.test.ts` под нагрузкой полного
      `pnpm test` 50 раз подряд — 0 падений; команда и счёт в «Итог»; до исправления — сколько падений.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/codex-auto-continue.test.ts` 50 times alongside a looping full `pnpm test`: 0 of 50 failed (before the fix 1 of 50, ENOTEMPTY) exit 0 · mac - · 270bf4f7e
- [ ] Остальные файлы, что импортируют `autopilot-faults-setup.ts` (`autopilot-faults-*.test.ts` и другие), —
      зелёные.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/codex-auto-continue.test.ts test/contract/autopilot-faults-{api,codex,github,process,retry}.test.ts` exit 0 · mac - · 270bf4f7e
- [ ] `removeTree` и `removeTestTree` не получили повторов удаления; общие пределы времени не изменены.
  - evidence: commit pass · Wait for the run's PR reads before removing the faults test folder (worfy-polish 90) · - - · 270bf4f7e
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 4f013bf926b3dff6544ddd1b7789f8ce9f7fad1b

## Где в коде

- `test/contract/codex-auto-continue.test.ts:73` — test; :66 — `codexRun`.
- `test/contract/autopilot-faults-setup.ts:189` — `afterEach` с cleanup-ами; :276–277 — `scratch` и его удаление;
  :279 — `data-root`; :322 — `LimitsTracker`; :336 — `SIGKILL` процессам fake Codex; :368 — `registry.closeAll()`;
  :496 — `autopilot.stopAll()`.
- `test/remove.ts:16` — `removeTestTree`; `src/main/storage/remove.ts:387` — `fs.rmSync` вне Windows.

## Вне скоупа

- Удаление на Windows (`removeTree` по шагам) и `test/unit/no-rmsync.test.ts`.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.

## Итог

Код приложения не менялся: исправлен общий cleanup test-ов, `test/contract/autopilot-faults-setup.ts`.

**Писатель.** gh stand-in (`test/fixtures/gh/gh-stub.mjs:83`): первым делом при старте он дописывает строку
вызова в `GH_STUB_LOG` — `scratch/gh/calls.jsonl` (`test/contract/gh-world.ts:96–98`). Процесс запускает
`PrTracker` run-а через `ghRunner`. Force stop и quit не ждут чтения PR: `endRead`
(`src/main/autopilot/run.ts:3324`) после `rush()` отдаёт `none` и бросает ответ, а `pollPrs`
(`src/main/autopilot/run.ts:3299`) запускает чтение через `void`. Так после всех cleanup-ов gh stand-in ещё
стартовал и создавал `calls.jsonl` заново, пока `rmSync` обходил папку. Диагностика (временная, не в commit):
при ENOTEMPTY cleanup выводил, что лежит в `scratch`. Запись при падении в test-е «willRetry: true» (:94 до
правки): `gh` (birth = старт удаления − 212 ms) и `gh/calls.jsonl`, birth через 4 ms после начала `rmSync`.

Поведение приложения оставлено как есть: ответ после Force stop по замыслу не нужен (комментарий `endRead`), и
приложение после остановки ничего не пишет — пишет только stand-in test-а.

**Исправление.** `faultRun` отдаёт Autopilot-у не сам `PrTracker`, а обёртку `read`, которая держит каждое
чтение в наборе `prReads` до его конца (`autopilot-faults-setup.ts:437–462`). Последний cleanup сначала ждёт,
пока набор опустеет, потом удаляет папку (:283–287). Чтение `PrTracker` кончается только после выхода всех его
gh-процессов: `ghRunner` отвечает по `close` процесса. Повторов удаления в `removeTree`/`removeTestTree` нет,
пределы времени не менялись.

**Test.** «a PR read the Force stop left running: the folder goes only after its gh has exited»
(`test/contract/codex-auto-continue.test.ts:152`): каждый gh-вызов run-а висит 3 s (режим `hang` stand-in-а),
test делает Force stop, пока вызов висит, и в `onTestFinished` (после всех `afterEach`) проверяет, что процесс
gh уже вышел и папки нет. Mutant-ы в отдельной копии: без ожидания в cleanup и с `prs: prs!` вместо обёртки —
оба красные (`expected true to be false`, :166), без mutant-а — зелёный.

**Счёт под нагрузкой.** Команда: `node scripts/vitest-electron.mjs test/contract/codex-auto-continue.test.ts`
50 раз подряд, параллельно в том же worktree в цикле полный `pnpm test`, HOME временный; load average
30–150 (на машине шли и test-ы других агентов).

- До исправления: 1 падение из 50 (ENOTEMPTY в `afterEach`, test «willRetry: true»).
- После исправления: 0 из 50. За тот же прогон cleanup 107 раз застал незаконченное чтение PR и дождался его
  (50 из них — новый test, остальные — обычные test-ы цикла и полного `pnpm test`).
