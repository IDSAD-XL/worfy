# 85 — Два flaky test-а: retry около полуночи и вложения чата под нагрузкой

Type: bug
Status: done 2026-11-10T02:10Z
PR: #1760
Branch: worfy-polish/85
Blocked by: —
Source: находки Orchestrator-а 2026-11-09…11-10 в прогонах `pnpm test` на Mac. Строки перечитаны по main `c69ffd43b`.

## Что происходит

**1. `test/contract/orchestrator-continue.test.ts:805`** («on in app-settings.json: one continuation at the wall-clock
time») падает, если его запустить за минуту-две до полуночи по местному времени. Блок describe этого test-а (:757)
ставит fake timers без своего времени (:775, `vi.useFakeTimers({ toFake: […, 'Date'], shouldAdvanceTime: true })`),
поэтому часы идут от настоящего «сейчас». Retry назначается через 2 минуты, и строка ожидания строится через
`clockText` (`src/main/agent/orchestrator-continue.ts:113–117`): если время retry уже в следующих сутках, к `HH:MM`
добавляется дата (`2026-11-10 00:01`). Test ждёт только время — regex `/… at \d{2}:\d{2}$/` (:810), как и helper
`hhmm` (:272–275) в остальных test-ах файла. Код прав; test зависит от настоящих часов.

**2. `test/unit/chat-attachments.test.tsx:293` и `:298`** («with its Session running, asks main to check a dropped
file» и «a drop of no files keeps the error under the field») падают под нагрузкой полного `pnpm test` и проходят,
если файл запустить один. Первый ждёт `['agent.attach']` в списке вызовов main, а получает `[]` (:295). Оба test-а
ждут чтения файла и вызова main фиксированной паузой `setTimeout(settle, 50)` внутри `act` (:289 в helper-е
`dropOnRunning`, :305 и :310 во втором test-е): под нагрузкой 50 ms не хватает.

## Что делаем

- Test 1: дать часам test-а фиксированное время — `now` в `vi.useFakeTimers` или `vi.setSystemTime` на середину дня
  (например, `START_MS` файла, :55), чтобы retry через 2 минуты не переходил через полночь. Код `clockText` не
  меняется. Отдельный test: время retry за полночью — строка с датой (если такого ещё нет).
- Test 2: вместо паузы 50 ms ждать условия — `await waitFor(() => expect(asked…).toEqual(['agent.attach']))` для
  первого и появления текста ошибки для второго. Фиксированных пауз в этих test-ах не остаётся.
- В файле таких пауз три (:289, :305, :310); заменить все.

## Готово, когда

- [ ] Test 1 проходит при часах за минуту до полуночи: временно поставить системное время test-а на 23:59 местного
      (или запустить с `TZ`, где сейчас 23:59) — exit 0; команда и вывод в «Итог».
  - evidence: test-run pass · `TZ=UTC node scripts/vitest-electron.mjs test/contract/orchestrator-continue.test.ts -t <both wall-clock tests>` started at 23:59:20 local exit 0 (before the fix, TZ=Etc/GMT-1 at 23:59:20 local: exit 1) · mac - · b245bd564
- [ ] Test 2: `test/unit/chat-attachments.test.tsx` 20 раз подряд под нагрузкой (параллельно с полным `pnpm test`) — 0 падений; команда и счёт в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/chat-attachments.test.tsx` 20 times alongside a full `pnpm test`, twice: 0 of 20 and 0 of 20 failed (before the fix 1 of 20) · mac - · b245bd564
- [ ] В `test/unit/chat-attachments.test.tsx` нет `setTimeout(settle, 50)` как ожидания результата.
  - evidence: commit pass · Tests: a fixed clock for the retry line and waits for the dropped file (worfy-polish 85) · - - · b245bd564
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · b245bd564

## Где в коде

- `src/main/agent/orchestrator-continue.ts:113–117` — `clockText(at, now)`: дата добавляется, когда `at` и `now` в
  разных сутках; вызов строки retry — :308.
- `test/contract/orchestrator-continue.test.ts:775` — `vi.useFakeTimers` без `now`; :805 — test; :810 — regex
  `\d{2}:\d{2}$`; :272–275 — helper `hhmm`; :55 — `START_MS`.
- `test/unit/chat-attachments.test.tsx:282–291` — helper `dropOnRunning` с паузой 50 ms (:289); :293 — test 1, его
  expect — :295; :298 — test 2, паузы — :305 и :310, expect-ы — :307 и :312.

## Вне скоупа

- Формат строки ожидания retry в UI.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.

## Итог

Код приложения не менялся: оба test-а чинились в самих test-ах.

**Test 1 — retry около полуночи.** Причина: `app()` в `test/contract/orchestrator-continue.test.ts` ставил fake
timers без `now`, и часы test-а шли от настоящего времени. Теперь `app(now = START_MS)` передаёт `now` в
`vi.useFakeTimers`: утро 2026-10-05, retry через минуту ± 20 % остаётся в тех же сутках. Новый test «a retry that falls
on the next day» запускает часы в 23:59:30 местного и ждёт строку `… at 2026-10-06 00:0N`.

- До исправления, настоящие часы в 23:59:20 местного (`TZ=Etc/GMT-1`, старт 22:59:20 UTC):
  `TZ=Etc/GMT-1 node scripts/vitest-electron.mjs test/contract/orchestrator-continue.test.ts -t 'one continuation at the wall-clock time'`
  — exit 1, получено `worfy: API error 529, retry 1 of 5 at 2026-11-10 00:00`. Тот же запуск в 23:54 — exit 0.
- После исправления, настоящие часы в 23:59:20 местного (`TZ=UTC`, старт 23:59:20 UTC):
  `TZ=UTC node scripts/vitest-electron.mjs test/contract/orchestrator-continue.test.ts -t "on in app-settings.json: one continuation at the wall-clock time|a retry that falls on the next day"`
  — exit 0, 2 passed.
- Mutant: `clockText` без ветки с датой (всегда `HH:MM`) — новый test красный, остальные 27 зелёные.

**Test 2 — вложения под нагрузкой.** Причина: jsdom читает файл в `FileReader` цепочкой из нескольких
`setImmediate`, потом идёт вызов `agent.attach` и ответ main. Test давал на это фиксированные 50 ms. Под нагрузкой
event loop останавливается дольше 50 ms, timer срабатывает раньше конца цепочки, `act` кончается до вызова main,
и запоздавший вызов попадает уже в следующий test (во втором test-е было `['agent.attach', 'agent.attach']`).
Теперь test-ы ждут условия через `waitFor` Testing Library (его предел общий для набора, `test/setup-dom.ts`): вызова
`agent.attach` и текста ответа main под полем. Пустой drop и read-only отказ синхронны — их проверка идёт сразу после
`act`. Пауз `setTimeout(settle, 50)` в файле нет.

- Под нагрузкой полного `pnpm test` (HOME во временной папке), 20 запусков
  `node scripts/vitest-electron.mjs test/unit/chat-attachments.test.tsx` параллельно с ним:
  до исправления — 1 падение из 20 (оба test-а из тикета); после — 0 из 20, и ещё раз 0 из 20.
  Сам `pnpm test` во всех трёх прогонах — exit 0.
- Под 18 и 54 busy-loop процессами без полного набора (10 + 10 запусков) старый test не падал: голой загрузки CPU
  мало, нужна нагрузка полного набора.
- Детерминированная проверка механизма: busy-wait 80 ms в `setImmediate` сразу после drop. Старые test-ы — 3 красных
  (третий получил запоздавший вызов из предыдущего), новые — 4 зелёных.
- Mutant: пустой drop всё же зовёт `attachFiles` (ошибка под полем стирается) — test «a drop of no files» красный 6 раз
  из 6.

`pnpm lint` — exit 0, `pnpm typecheck` — exit 0, gate fast — exit 0, `[gate] green (fast)`.
