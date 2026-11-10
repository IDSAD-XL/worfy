# 89 — Flaky test: отношение времени двух scan-ов в `autopilot-task-output.test.ts` выходит за 64 под нагрузкой

Type: bug
Status: open
Blocked by: —
Source: находка Orchestrator-а 2026-11-10 в локальном gate fast на Mac (запуск 02:12Z; повтор в 02:23Z зелёный).
В CI за 2026-11-09…11-10 не найдено: в log-ах job-ов `linux-tests`, `macos-tests` и `windows … / full-suite` этот
test ни разу не упал и не дал строки FLAKY. Строки перечитаны по main `100acec94`.

## Что происходит

`test/unit/autopilot-task-output.test.ts:89` — test «16 times more paths on one line cost less than 64 times more»
из describe «the cost grows with the text, not with its square» (:67). Он меряет, сколько `taskOutputFiles`
(`src/main/autopilot/task-output.ts:49`) идёт на строке из 500 путей и на строке из 8000 путей, берёт самое быстрое
из до пяти попыток для каждой (:97–101) и требует, чтобы отношение было меньше 64 (:102). Линейный scan даёт около
16, старый квадратичный — около 265; 64 стоит между ними.

Под нагрузкой полного набора отношение вышло за предел:

```
AssertionError: expected 82.9317413344301 to be less than 64
 ❯ test/unit/autopilot-task-output.test.ts:102:40
```

Короткая строка сканируется доли миллисекунды, поэтому одна пауза планировщика или GC в каждой из её пяти попыток
раздувает знаменатель меньше, чем нужно, а длинной — числитель; «самое быстрое из пяти» эту паузу не всегда
отсекает. Цикл попыток (:97) останавливается, как только отношение ниже 64, но после пятой попытки проверка падает.
Локально (`CI_RETRIES = 0`, `test/flaky.ts:20`) одно такое падение краснит gate; в CI его закрывает один retry.

## Что делаем

- Сначала замерить: распределение отношения `fastestLong / fastestShort` на один файл и под нагрузкой полного
  `pnpm test` (например, 50 прогонов каждого), а также время одного scan-а короткой строки. Числа — в «Итог».
- По замеру сделать измерение устойчивым к паузам, не ослабляя то, что test ловит: например, мерить пачку scan-ов
  короткой строки, чтобы её время было не меньше нескольких миллисекунд, или брать больше попыток только для
  короткой строки. Предел 64 и размеры строк меняем только если замер покажет, что иначе нельзя; тогда новое число
  и замер — в комментарии рядом и в «Итог».
- Первый, квадратичный scan (для каждого пути смотрит назад до начала строки; комментарий на :86) должен
  по-прежнему краснить test: проверить mutation-ом.
- Общие пределы набора (`testTimeout`, `hookTimeout`, множитель в `test/time-scale.ts`) не трогаем.

## Готово, когда

- [ ] `node scripts/vitest-electron.mjs test/unit/autopilot-task-output.test.ts` один — exit 0; распределение
      отношения до и после — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-task-output.test.ts` exit 0; ratio alone 17.4-18.6 after (12.9-18.0 before), under a full pnpm test max 23.0 in 390 after (3 of 250 at 64 or more before) · mac - · 12585f1e3
- [ ] Тот же файл под нагрузкой полного `pnpm test` (параллельно с ним) 20 раз подряд — 0 падений; команда и счёт в
      «Итог»; до исправления — сколько падений из 20.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-task-output.test.ts` back to back alongside a full `pnpm test`: 0 of 78 and 0 of 243 failed (before the fix 0 of 20, then 2 of 366) · mac - · 12585f1e3
- [ ] Квадратичный scan в `taskOutputFiles` (mutation) — test красный.
  - evidence: test-run pass · mutant from = 0 (look back to the start of the text): `node scripts/vitest-electron.mjs test/unit/autopilot-task-output.test.ts -t <16 times more paths>` exit 1 six of six, ratio 241-261 · mac - · 12585f1e3
- [ ] Общие пределы набора и множитель в `test/time-scale.ts` не изменены.
  - evidence: commit pass · test: measure the path-scan growth in thread CPU time, not on the clock (worfy-polish 89) · - - · 12585f1e3
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 12585f1e3

## Где в коде

- `test/unit/autopilot-task-output.test.ts:67` — describe; :69–73 — `took`; :89 — test; :97–101 — цикл до пяти
  попыток; :102 — проверка `< 64`; :78 — соседний test с пределом в секундах.
- `src/main/autopilot/task-output.ts:49` — `taskOutputFiles`.
- `test/flaky.ts:20` — `CI_RETRIES`.

## Вне скоупа

- Соседний test «a 200 000-character word before a path» (:78) с пределом 1 s.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.

## Итог

Код приложения не менялся, изменён только test. Предел 64, размеры строк (500 и 8000 путей) и пять попыток остались.

**Причина.** Под нагрузкой полного `pnpm test` растягивается не короткий scan, а длинный. Scan 8000 путей занимает
около 8 ms CPU. Под нагрузкой поток часть этого времени ждёт свободное ядро: по часам scan занимал 30–400 ms
(p50 31.8 ms, p99 224 ms, max 431 ms). Короткий scan (0.4–0.55 ms) обычно успевает до того, как поток снимут с ядра.
Если все пять попыток длинного scan-а попали под такое ожидание, отношение выходит за 64. Пачка из 16 коротких
scan-ов на попытку (вариант из тикета) этого не исправила: по часам 3 выхода за 64 из 250, как и без пачки.
Время CPU этого же потока (`process.threadCpuUsage`) на тех же scan-ах ожидание ядра не считает: максимум 20.7,
0 из 250.

**Исправление.** `cpuPerScan` повторяет scan строки, пока поток не потратит на эти scan-ы 50 ms своего CPU, и
возвращает CPU на один scan. Отношение считается по этим числам. Обе строки меряются одинаково долго, поэтому пауза
garbage collector-а, которую время CPU потока учитывает, ложится на обе строки одинаково. 50 ms выбраны с запасом под
часы потока, которые идут шагами по 15.6 ms (Windows): так ошибка каждой строки меньше трети.
Цена: test теперь идёт 110–280 ms, когда файл запущен один (раньше обычно около 10 ms: одна попытка), под нагрузкой — до 1.4 s.

**Распределение отношения** (замер — временный файл в `test/unit`, в commit не вошёл; команда
`node scripts/vitest-electron.mjs test/unit/zz-p89-measure.test.ts`):

- До исправления, файл один, 50 прогонов процедуры test-а (по часам): min 12.9, p50 16.6, p90 17.4, max 18.0.
  Один scan короткой строки — p50 0.41 ms (min 0.37), длинной — p50 6.85 ms.
- До исправления, параллельно с одним полным `pnpm test` (480 s), 250 прогонов: p50 17.2, p90 45.2, p99 72.4,
  max 89.2, не меньше 64 — 3 из 250. «Самое быстрое из пяти» без раннего выхода — 5 из 250.
- После исправления, файл один, 50 прогонов: min 17.4, p50 18.0, max 18.6. Каждый раз хватило первой попытки.
- После исправления, параллельно с одним полным `pnpm test` (386 s), 390 прогонов: min 13.7, p50 17.9, p99 21.2,
  max 23.0, не меньше 64 — 0 из 390.

**Test-файл под нагрузкой.** Запуски `node scripts/vitest-electron.mjs test/unit/autopilot-task-output.test.ts` шли
подряд, один за другим, всё время, пока в соседнем окне шёл полный `pnpm test`. В то же время на машине работали
test-ы других агентов, load average был от 23 до 102 на 18 ядрах.

- До исправления, первая серия: 0 падений из 20, все 20 прошли за первые полторы минуты нагрузки.
- До исправления, вторая серия, на всё время одного полного `pnpm test` (671 s): 2 падения из 366, на запусках 226 и
  238: `expected 124.89… to be less than 64` и `expected 102.37… to be less than 64` (`:102`), как в тикете.
- После исправления: 0 падений из 78, вместе с замером, на одном полном `pnpm test`. Ещё 0 из 243 на другом полном
  `pnpm test` (555 s). Оба этих `pnpm test` прошли с exit 0.

**Mutation.** Mutation проверялась в отдельной копии (`git worktree add --detach`, после проверки удалена). В
`taskOutputFiles` строка `const from = Math.max(0, match.index - LOOK_BACK)` заменена на `const from = 0`: каждый путь
снова смотрит назад до начала текста, это квадратичный scan. Запуск
`node scripts/vitest-electron.mjs test/unit/autopilot-task-output.test.ts -t '16 times more paths'` — exit 1 шесть раз
из шести, отношение от 241 до 261.

Общие пределы набора не тронуты: `git diff origin/main...HEAD` меняет только `test/unit/autopilot-task-output.test.ts`.
`testTimeout`, `hookTimeout` и `test/time-scale.ts` остались как были.

Не проверено на Windows: что `process.threadCpuUsage` там идёт шагами 15.6 ms, известно из документации
`GetThreadTimes`, локально не проверялось. Проверку даст job Windows в CI на этом PR.
