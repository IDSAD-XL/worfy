# 85 — Два flaky test-а: retry около полуночи и вложения чата под нагрузкой

Type: bug
Status: open
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
- [ ] Test 2: `test/unit/chat-attachments.test.tsx` 20 раз подряд под нагрузкой (параллельно с полным `pnpm test`) — 0 падений; команда и счёт в «Итог».
- [ ] В `test/unit/chat-attachments.test.tsx` нет `setTimeout(settle, 50)` как ожидания результата.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

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
