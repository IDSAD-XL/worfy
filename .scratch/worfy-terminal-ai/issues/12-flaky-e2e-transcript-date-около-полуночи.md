# 12 — Flaky e2e `transcript-date` в `session-view.spec.ts`: красный, если полночь наступила между отправкой и проверкой

Type: task
Status: done 2026-10-17T16:32Z
PR: #442
Branch: worfy-terminal-ai/12
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен», кроме двух рисков — им Ticket-ы):
[Ticket 10](10-test-paused-by-limits-около-полуночи.md), «Итог» («Остался один узкий случай, не починен»)
и «Gate оркестратора (2026-10-15)», Consider [low].

## Что происходит

- e2e `test/e2e/session-view.spec.ts:84-95`: test отправляет prompt (`sentFrom = Date.now()`, `:86`),
  проверяет часы строки (`:91-94`) и ждёт, что у только что отправленной строки нет даты:
  `transcript-date` — `toHaveCount(0)` (`:95`).
- Transcript показывает дату у строки, чей день не совпадает с сегодняшним
  (`src/renderer/session/Transcript.tsx:127-128`). «Сегодня» — `useToday()`, он сдвигается таймером в
  местную полночь (`:66-79`).
- Если полночь наступит между отправкой и проверкой (окно в несколько секунд), строка вчерашняя —
  дата показана, test красный без дефекта. Часы строки test уже допускают с обеих сторон границы
  минуты (`[clock(sentFrom), clock(Date.now())]`, `:94`), дату — нет.
- Ticket 10 чинил такие случаи в unit и contract test-ах, а этот оставил: e2e там не запускали.

## Что делаем

1. **Сначала красный прогон**: тот же сценарий с часами окна около 23:59:59 (Playwright `clock` у окна
   Electron, или другой способ подвести время — выбор исполнителя, без правки кода приложения ради
   test-а). На main — красный.
2. **Правка test-а**: ожидание даты зависит от того, сменился ли местный день между `sentFrom` и
   проверкой. Тот же день — `transcript-date` 0; день сменился — дата есть и равна дате `sentFrom`.
   Test по-прежнему ловит дефект «дата у сегодняшней строки».
3. **Правило вылеченного flaky test-а** (решение владельца 2026-10-16, `worfy-reliability` 03,
   пункт 6): 10 повторов файла без единого красного под параллельной нагрузкой полного `pnpm test`
   (как в gate full); прогоны на тихой машине не считаются. Число и нагрузка — в «Итог».

## Готово, когда

- [x] Прогон пункта 1 красный на main и зелёный с правкой.
- [x] Мутант «дата у сегодняшней строки» (`Transcript.tsx` всегда показывает дату) — test красный.
- [x] 10 повторов `session-view.spec.ts` под нагрузкой полного `pnpm test` — 0 красных; в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; gate full — exit 0 и строка `[gate] зелено (full)`
      (оркестратор перед merge); Linux CI зелёный.

## Тесты

- `test/e2e/session-view.spec.ts` — граница дня.

## Где в коде

- `test/e2e/session-view.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/session/Transcript.tsx`.

## Вне скоупа

- Правка `Transcript.tsx`: показ даты верен.
- Другие e2e с местным временем — Ticket 10 их уже разобрал.

## Итог

Ветка `worfy-terminal-ai/12`, один файл кода: `test/e2e/session-view.spec.ts`. `Transcript.tsx` не тронут.

**Что сделано.**
- Проверка времени строки вынесена в helper `expectLiveRowTime` (`session-view.spec.ts:83`).
  Время берётся из часов окна (`window.evaluate(() => Date.now())`), а не из процесса Playwright:
  строку штампует renderer (`src/renderer/session/store.ts:89`), и «сегодня» у Transcript — тоже его часы.
- Helper читает время прихода строки из `datetime` у `transcript-time` и проверяет, что оно между
  `sentFrom` и моментом проверки. Тот же местный день — `transcript-date` 0. День сменился — дата есть
  и равна дате прихода строки (`Oct 17`, с `'YY` в другом году). Это дата `sentFrom`, кроме случая,
  когда строка пришла уже после полуночи: тогда она сегодняшняя и даты нет. Поэтому решает время
  строки, а не `sentFrom`.
- Новый test «a prompt sent just before local midnight…» (`:221`): `window.clock.install` за минуту до
  ближайшей местной полуночи, `window.reload()` (Transcript смонтирован вместе с окном, и без
  перезагрузки его таймер полуночи остаётся на настоящих часах — проверено: без reload test зелёный
  и на старой проверке), отправка, `clock.fastForward(60_000)` через полночь, тот же helper и
  `transcript-date` = 1.

**Пункт 1, красный прогон.** Новый сценарий со старой проверкой (`toHaveCount(0)`, как на main;
`sentFrom` из часов окна, иначе под подменёнными часами раньше краснеют часы строки) — красный:
`Expected: 0, Received: 1` на `transcript-date`. С правкой — оба test-а файла зелёные (2 passed).

**Мутанты** (в своём worktree, файл восстановлен копией, `git status` — только файлы тикета):
- «дата у сегодняшней строки» (`if (sameDay && false)` в `rowTime`) — основной test красный
  (`Expected: 0, Received: 1`), midnight test зелёный;
- «даты нет никогда» (`if (true) return { date: null, … }`) — midnight test красный
  (`Expected: "Oct 17"`, element not found).

**10 повторов под нагрузкой.** `pnpm test:e2e test/e2e/session-view.spec.ts --repeat-each 10` одновременно
с одним полным `pnpm test` в том же worktree: 20 passed (10 × 2 test-а), 0 красных, 30,9 s;
load average 4,20 до старта, 7,28 через 20 s, 8,67 в конце повторов. Полный `pnpm test` дошёл до конца
(5 мин) с 3 красными по timeout в файлах вне diff: `test/unit/install-stable-functions.test.ts`
(2 × «Test timed out in 5000ms») и `test/contract/harness-scripts.test.ts` (`wave-gate.test.sh`,
`spawnSync bash ETIMEDOUT`). Одновременно шли полные test-ы соседних worktree (tai-11, tai-13).
Повтор этих двух файлов (load average 4,13) — 77 passed.

**Проверки.** `pnpm lint`, `pnpm typecheck` — exit 0. Gate fast: первый прогон красный по timeout в
`harness-scripts.test.ts` под той же нагрузкой (load average 4,13 → 4,73); после rebase на `b2ae59d8`
повтор — exit 0, `[gate] зелено (fast)`. Gate full — за оркестратором перед merge.

Ревью и merge (2026-10-17): гейт глубины low — `VERIFIED` с первого круга
([вердикт](https://github.com/IDSAD-XL/worfy/pull/442#issuecomment-6235742053)); мутант проверяющего (таймер
полуночи `Transcript.tsx:75` на час позже) краснит test границы дня. `GATE_SCOPE=all` gate full — зелёный с
первого прогона; влит — `a18aa831`.
Долг (low): `test/e2e/session-view.spec.ts:86-93` — в ветке «тот же день» дата читается один раз `count()`; строка,
штампованная сразу после настоящей полуночи до срабатывания таймера, несколько миллисекунд показывает дату —
ждать `toHaveCount(0)` с повторами. Вывод по чтению кода, test-ом не показан.
