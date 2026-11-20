# 129 — Flaky test «gh hangs the whole Run» на Windows: вторая гонка последнего чтения PR после 124

Type: bug
Status: claimed 2026-11-20T12:41Z
PR: #2094
Branch: worfy-polish/129
Blocked by: none
Source: красный push run 44471611202 на `main` eb669a653 (#2030, worfy-auth-check 08 — Autopilot не трогает), job
`windows (2/3) / full-suite`. Тот же файл зелёный в `windows (2/3)` на том же коде в run-ах 44550103039 (job
135651372486), 44547578992, 44535810835, 44535483050 — flaky test, не ошибка #2030; revert не делался.

Кто: агент.

## Что происходит

- `test/contract/autopilot-faults-github.test.ts:162` («gh hangs the whole Run: the Waves go on, no narrow-round, the
  stop waits END_READ_MS at most, and no hung gh is left») снова падает на Windows с
  `Error: timed out waiting for the last read of the PRs` — ожидание `until` перед `h.clock.advance(END_READ_MS)`:
  ждёт, пока `END_READ_MS`-timer останется один и зависший вызов gh последнего чтения запишет второй pid в `hang.pids`.
- Первую гонку того же ожидания (`ghRunner` убивал stand-in gh раньше, чем тот записывал pid, за 1,5 с реального
  времени) починил worfy-polish 124 (PR #1985): последующим вызовам gh дан `LATER_GH_TIMEOUT_MS`. Это новое падение
  после того исправления, причина не установлена.
- Test в карантине на win32 до 2026-12-03: запись `test/quarantine/autopilot-faults-gh-hangs-whole-run.json`
  (owner — этот Ticket). Пока она есть, на Windows test не запускается и сценарий «gh висит весь Run» там не проверен.

## Причина

- Не выполняется условие «второй pid в `hang.pids`»: последнее чтение PR не запускает своего вызова gh. На момент
  падения в `hang.pids` один pid, `END_READ_MS`-timer-ов на часах test-а ноль, в журнале Run-а уже есть `run-stopped`.
- `PrTracker` ведёт одно чтение за раз на Project (`src/main/github/prs.ts`, `read`: `current.running ??= …`): чтение,
  начатое, пока идёт другое, присоединяется к нему. Последнее чтение перед `run-stopped` присоединяется к чтению
  Wave 1, если оно ещё не закончилось; то кончается отказом, gh больше не запускается, оба timer-а снимаются, Run
  останавливается.
- Test отпускал turn Wave 2, как только зависший stand-in первого вызова умирал (`!alive(pid)`). Но `ghRunner` отвечает
  на `close` процесса (`execFile`), а не на его смерть: между ними есть промежуток. Если он длиннее пути от release до
  `end()` (на Mac 45–65 мс), чтение Wave 1 ещё «идёт», и последнее чтение присоединяется к нему. На Windows смерть
  процесса видна сразу (`process.kill(pid, 0)` спрашивает систему), а `exit` и закрытие pipe-ов приходят в event loop
  отдельными событиями. Вывод (на Windows не измерено): на нагруженном runner-е промежуток длиннее — в логе run-а
  44471611202 строки turn-ов Wave 1 и Wave 2 разделяют 1,5 с, столько же, сколько timeout первого вызова, то есть его
  конец совпал со стартом Wave 2; на Mac Wave 2 стартует через 0,15 с.
- Воспроизведено на Mac временной правкой (не в PR): обёртка `run` в `faultRun` задерживает отказ вызова gh на 200 мс
  или 1000 мс после смерти процесса. До исправления — `Error: timed out waiting for the last read of the PRs`, exit 1,
  ровно в состоянии из первого пункта (один pid, ноль timer-ов, `run-stopped`). После — exit 0 с задержками 0, 200,
  1000 и 3000 мс.
- Остальные кандидаты Ticket-а не подтвердились: задержка вызова `pollPrs` Wave 2 на 0,3–3 с test не краснит (чтение
  Wave 2 либо присоединяется к первому, либо запускает свой вызов gh с `LATER_GH_TIMEOUT_MS`, к которому
  присоединяется последнее чтение); чтение Ticket-ов в воспроизведении ответило (timer-ов ноль, а не два).
- Это гонка test-а, не ошибка продукта: последнее чтение законно присоединяется к идущему чтению, `src/` не меняется.

## Что делаем

1. Найти причину второй гонки — момент последнего чтения PR на медленном Windows runner-е: какое из двух условий
   ожидания не выполняется (второй pid в `hang.pids` или единственный `END_READ_MS`-timer на часах test-а) и почему.
   Кандидаты для проверки, не установлены: последнее чтение не начинается, потому что Run не дошёл до него за время
   `until`; чтение Ticket-ов не ответило и держит второй timer; второй вызов gh присоединился к уже идущему чтению или
   не стартовал. Воспроизвести на Mac временной задержкой (как в 124), записать в «Причина».
2. Исправить test (или продукт, если ошибка в нём): ждать условия, а не часов. Предел ни одного test-а и ни одного
   ожидания не поднимать (правило «Timeout-ы test-ов не подстраивают по одному»).
3. Убрать запись карантина и вернуть `it(` вместо `quarantined('autopilot-faults-gh-hangs-whole-run')(`.

## Готово, когда

- [ ] В «Причина» этого Ticket-а записано, какое условие ожидания не выполнялось и почему, с воспроизведением на Mac
      временной правкой (не в PR): до исправления красный, после — зелёный.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-github.test.ts -t "gh hangs the whole Run"` exit 0 with the first gh call answering 0/200/1000/3000 ms after its stand-in died (temporary delay edit, reverted); exit 1 with 200/1000 ms before the fix · mac - · c6045e2a968d7db01e9a92cf7ff9586c1c806a51
- [ ] Все test-ы `test/contract/autopilot-faults-*.test.ts` зелёные; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-*.test.ts test/contract/test-timeout-scale.test.ts` exit 0 in 5 of 5 runs (57 tests) · mac - · c6045e2a968d7db01e9a92cf7ff9586c1c806a51
  - evidence: test-run pass · `pnpm lint` exit 0, `pnpm typecheck` exit 0 · mac - · c6045e2a968d7db01e9a92cf7ff9586c1c806a51
- [ ] Job-ы `windows / full-suite` PR-а зелёные, test в них запускается (не skipped).
- [ ] Записи `test/quarantine/autopilot-faults-gh-hangs-whole-run.json` нет; test объявлен через `it(`.
  - evidence: commit pass · worfy-polish/129: wait for the hung Run's first PR read to settle, not only its gh to die · - - · c6045e2a968d7db01e9a92cf7ff9586c1c806a51

## Где в коде

- `test/contract/autopilot-faults-github.test.ts`
- `test/contract/autopilot-faults-setup.ts`
- `test/quarantine/autopilot-faults-gh-hangs-whole-run.json`

## Итог

Код — ветка `worfy-polish/129`. `src/` не менялся: это гонка test-а.

**Что изменилось.**
- `faultRun` (`test/contract/autopilot-faults-setup.ts`) отдаёт `prsReading()` — сколько чтений PR Run-а ещё не
  закончилось (набор `prReads`, который уже был для cleanup-а).
- Test «gh hangs the whole Run» перед release turn-а Wave 2 ждёт не только смерти stand-in-а первого вызова gh, но и
  конца его чтения (`h.prsReading() === 0`). Предел `until` прежний; ни один timeout не поднят, оба предела test-а
  по-прежнему идут через `ms()` (множитель `test/time-scale.ts`).
- Запись `test/quarantine/autopilot-faults-gh-hangs-whole-run.json` удалена, test объявлен через `it(`.

**Проверки (Mac).**
- Воспроизведение — в «Причина»: задержка отказа первого вызова gh на 200/1000 мс после смерти процесса — до
  исправления exit 1, после — exit 0 (и с 0/3000 мс). Временная правка не в PR.
- Все `test/contract/autopilot-faults-*.test.ts` + `test/contract/test-timeout-scale.test.ts` — 5 из 5 запусков exit 0.
- `pnpm lint` exit 0, `pnpm typecheck` exit 0.
- `pnpm test` целиком — exit 1: 21 test в 9 файлах, все — test-ы file watcher-а (`cards-watch-edits`, `claude-home-registry`,
  `docs-watch-root`, `docs`, `harness-script-env`, `product-watch`, `profile-move`, `workflow-read-from-main`,
  `workflow-reader`); `fseventsd` на этом Mac — 100 % CPU. Diff их не трогает; файлы `autopilot-faults-*` в этом запуске
  зелёные. Пункт 2 «Готово, когда» для `pnpm test` поэтому не закрыт на Mac — ждёт CI.
- gate fast не запускался (тот же `fseventsd`, указание брифа).

**Решено без владельца.**
- Исправлен test, а не продукт: присоединение последнего чтения к идущему — законное поведение `PrTracker` (одно
  чтение за раз на Project), ошибкой продукта не считаю.
- Механизм на Windows выведен, а не измерен: величину промежутка между смертью процесса и `close` на runner-е никто не
  мерил; доказательство — воспроизведение на Mac и job-ы `windows / full-suite` этого PR.
- Story-файл `stories/129-…` (там лежала Code story PR-а с карантином) переписан под этот PR.
