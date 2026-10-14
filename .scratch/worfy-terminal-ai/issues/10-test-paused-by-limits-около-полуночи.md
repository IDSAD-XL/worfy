# 10 — Unit test «Paused by Limits» красный каждый день с 23:00 до 24:00

Type: task
Status: claimed — 2026-10-14
Branch: worfy-terminal-ai/10
Blocked by: —
Source: проверка инструментов 2026-10-14 в 23:51 — gate fast на main `c49267f`: lint и typecheck зелёные, в vitest 1 test красный из 5171; test пришёл с [Ticket 08](08-settings-terminal-ai.md) ([PR #309](https://github.com/IDSAD-XL/worfy/pull/309))

## Что происходит

- `test/unit/terminal-ai-settings.test.tsx:345-351`, test «a feature the Limits stopped > goes away
  when main says the feature is on again». Через `mount(...)` (`:81-86`) он ставит паузу на
  `Date.now() + 60 * 60 * 1000` — по настоящим часам и в местном часовом поясе. `now` и `timeZone`
  в раздел не передаются, хотя соседние test-ы передают `now={NOW} timeZone="UTC"`.
- С 23:00 до 24:00 по местному времени пауза кончается уже завтра. Тогда раздел пишет время с днём
  недели: «Paused by Limits until Thu 00:52». А `:347` ждёт только часы и минуты:
  `/^Paused by Limits until \d\d:\d\d$/`.
- Замер 2026-10-14: gate fast в 23:51 — красный (`exit 2`), `test` упал только на этом test-е. Повтор
  файла в 23:54 — тот же отказ, «until Thu 00:54». Тот же файл с `TZ=UTC` — 28 из 28 зелёные.
- Код продукта верен: день недели для паузы до завтра — это поведение из «Готово, когда» Ticket-а 08
  (test «Thu 09:00» рядом). Ошибка в самом test-е.
- Пока test не починен, любой gate этот час красный. В том числе gate full перед мержем любого PR с
  кодом и прогоны Autopilot.

## Что делаем

- Test перестаёт зависеть от времени суток. Способ выбрать по helper-ам файла: фиксированное время
  системы в середине дня (`vi.setSystemTime`) либо фиксированные `now` и `timeZone`, если раздел
  умеет брать их при `mount`.
- Проверить `test/` на тот же класс ошибки: `Date.now()` плюс сдвиг и проверка времени, отформатированного
  по часам. Кандидат, которого никто не смотрел: `test/unit/autopilot-run.test.ts:1004`
  (`new Date(Date.now() + 3_600_000)`). Найденное с той же ошибкой — чинить в этом Ticket-е, остальное —
  строкой в «Итог».
- Код продукта не меняется.

## Готово, когда

- [x] Test `:345-351` зелёный при времени системы 23:30 местного (как воспроизведено — в «Итог») и в середине дня.
- [x] Остальные test-ы файла не изменили смысла.
- [x] Поиск того же класса ошибки в `test/` сделан, результат — в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate fast — exit 0.

## Тесты

Сначала красный: тот же test при времени системы 23:30 местного. Сейчас он падает так же, как в
gate 2026-10-14. В «Итог» — как падал.

## Где в коде

- `test/unit/terminal-ai-settings.test.tsx` (`:81-86` — `mount`, `:345-351` — test)
- `test/unit/autopilot-run.test.ts:1004` — только проверить

## Итог

Ветка `worfy-terminal-ai/10`. Код продукта (`src/`) не менялся.

**Что сделано.** Test «a feature the Limits stopped > goes away when main says the feature is on again»
(`test/unit/terminal-ai-settings.test.tsx`) сам ставит время системы на середину дня по местному
времени: `vi.useFakeTimers({ toFake: ['Date'] })` и `vi.setSystemTime(new Date(2026, 9, 14, 12, 0))`.
Подменяется только `Date`, поэтому promise-ы фейкового main по-прежнему доходят до раздела. Пауза через
час теперь кончается в тот же день при любом часе запуска и любом часовом поясе. Проверка стала
точной: `'Paused by Limits until 13:00'` вместо regex `\d\d:\d\d`. `afterEach` файла добавил
`vi.useRealTimers()`. Передать `now` и `timeZone` через `mount` нельзя: раздел по умолчанию
(`TerminalAiSection`) props не принимает, время берёт из `useNow()`, пояс — местный.
Остальные 27 test-ов файла не менялись.

**Красный первым — как воспроизведено.** Копия файла, в которой test перед `mount` ставит
`vi.setSystemTime(new Date(2026, 9, 14, 23, 30))` (23:30 местного). Без правки test-а она красная в
`TZ=Europe/Kyiv`, `TZ=America/Los_Angeles` и `TZ=Asia/Tokyo` (exit 1 в каждом):
`expected 'Paused by Limits until Thu 00:30' to match /^Paused by Limits until \d\d:\d\d$/` — тот же
отказ, что у gate 2026-10-14 в 23:51.

**Зелёный после правки.** Копия починенного файла, где `beforeEach` ставит часы на 23:30 местного
до того, как test поставит свои: 28 из 28 зелёные в `Europe/Kyiv`, `America/Los_Angeles`,
`Asia/Tokyo`, `UTC`, `Pacific/Kiritimati` (UTC+14) и `Pacific/Pago_Pago` (UTC−11). Сам файл по
настоящим часам: 28 из 28 в `Europe/Kyiv`, `America/Los_Angeles`, `Asia/Tokyo`.

**Mutation testing.** Три мутанта `src/renderer/settings/TerminalAiSection.tsx`, каждый краснит
починенный test (exit 1), файл восстановлен из копии:
раздел не пишет строку паузы; день недели всегда (`Wed 13:00`); часы в 12-часовом формате (`01:00 pm`).

**Поиск того же класса ошибки в `test/`** (время по настоящим часам плюс сдвиг и проверка времени,
отформатированного по местным часам или по календарному дню):
- `test/unit/autopilot-run.test.ts:1004` — не та ошибка. `new Date(Date.now() + 3_600_000).toISOString()`
  — момент комментария через час после старта прогона; сравниваются моменты, местное время и день
  не участвуют. Не менялся.
- `test/unit/canvas-actions.test.tsx:527` — `resumesAt` фиксирован, а `autopilotStatusLine` всегда пишет
  только часы и минуты, без дня. Не зависит от времени суток.
- `test/unit/limits-meter.test.tsx`, `test/unit/session-view.test.tsx` (раздел о времени строк),
  `test/contract/terminal-ai-request.test.ts:345` — фиксированные `now`/`timeZone` или `vi.setSystemTime`.
- `test/e2e/terminal-ai-settings.spec.ts:383-391` — уже допускает день недели (`(?:[A-Z][a-z]{2} )?`).
- `test/e2e/limits.spec.ts` — «as of» с днём недели после сдвига сохранённого на два дня назад; «resets»
  для 5-часового окна всегда без дня. Не зависит от времени суток.
- Остальные `Date.now() ± n` в `test/unit` и `test/contract` — сроки ожидания и длительности
  (`deadline`, `Date.now() - started`), а не отформатированное время.
- Остался один узкий случай, не починен: `test/e2e/session-view.spec.ts:86-95` ждёт, что у только что
  отправленной строки нет даты (`transcript-date` — 0). Раздел показывает дату, когда день строки
  не совпадает с сегодняшним; если полночь наступит между отправкой и проверкой (окно в несколько
  секунд), test покраснеет. Это e2e, его в этом Ticket-е не запускали, а правка без прогона — догадка.
  Решено без владельца, подтвердить: оставить строкой здесь, не чинить в этом PR.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` (с временным `HOME`) — exit 0, 5105 passed,
66 skipped из 5171. gate fast — exit 0, «[gate] зелено (fast)»; `GATE_SCOPE=all` gate fast — exit 0,
«[gate] зелено (fast) … (кэш)».
