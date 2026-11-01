# 01 — Прогноз Epic-а: ядро

Type: task
Status: claimed 2026-11-01T08:33Z
Branch: worfy-resource-planner/01
Blocked by: —
Source: [spec.md](../spec.md), «Решения» (Q4, Q5, Q8, Q17), «Прогноз Epic-а» («Выборки на Ticket», «Что осталось», «Bootstrap»), «Не решено» (выбрано без решения, п. 5, 7), «Соглашения для Ticket-ов этого Epic-а»; [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 4

## Что происходит

- Ticket 40 Epic-а worfy-throughput считает выборку Wave — рост доли `seven_day` между `wave-started` и
  `wave-finished`, делённый на её Ticket-ы (`sample`, `src/shared/autopilot/limits-estimate.ts:41`), и отдаёт только
  медиану 10 последних (`waveEstimate`, `:61`; отбор `:75-77`). Сами выборки наружу не выходят.
- Номер Wave каждого Ticket-а Epic-а уже считает `waveNumbers` (`src/shared/workflow/waves.ts:228`): Ticket-ы в работе,
  `done` только в ветке и заблокированные выше по цепочке номера не получают. «Закрыт» — `done` в checkout
  (`closed`, `waves.ts:55`).
- Диапазона на весь оставшийся Epic нет нигде.

## Что делаем

Новый чистый модуль `src/shared/autopilot/forecast.ts` (без Node и DOM).

1. **Выборки.** `waveSamples(runs)` в `limits-estimate.ts` — выборки на Ticket в порядке времени, 10 последних
   (`ESTIMATE_WAVES`), по тем же правилам свежести и сброса; `waveEstimate` переходит на неё, его ответы не
   меняются. Там же `waveGrowth(started, finished)` — рост доли за одну Wave (выборка × Ticket-ы) или `null`: им
   пользуется Ticket 07 для факта.
2. **Перцентиль.** `percentile(values, p)` — nearest-rank; экспорт: им пользуется Ticket 02.
3. **Что осталось.** `remainingWaves(tickets, epic, named?)` — по `waveNumbers`: список Wave 1…W с числом
   Ticket-ов в каждой; `uncounted` — Ticket-ы Epic-а (или названные), не закрытые и без номера Wave. У Run по
   названным Ticket-ам считаются только названные.
4. **Bootstrap.** `epicForecast({ samples, waves, draws?, seed? })`:
   - `FORECAST_MIN_SAMPLES = 5`: меньше — `range: null` («мало данных»), остальное считается;
   - `FORECAST_DRAWS = 1000` повторов; на каждый Ticket — случайная выборка с возвращением, суммы копятся по
     границам Wave;
   - генератор с постоянным seed (небольшой PRNG вроде mulberry32): одинаковые входы — одинаковый ответ;
   - ответ: `waves` (W), `tickets`, `uncounted`, `samples`, `range` (`low` = p10, `high` = p90 суммы всех W Wave) и
     `cumulativeHigh[k]` — p90 накопленной суммы первых k Wave (для рекомендации Ticket-а 03).
5. Без оставшихся Wave — `waves: 0`, `range: null`, без ошибки.

## Готово, когда

- [ ] `waveEstimate` отвечает как раньше: все случаи `test/unit/autopilot-limits-estimate.test.ts` зелёные без правок.
- [ ] Unit test `waveSamples`: порядок по времени, 10 последних, Wave со старым числом или сбросом внутри выборки не даёт.
- [ ] Unit test `remainingWaves`: Epic с Ticket-ом в работе, Ticket-ом `done` только в ветке и Ticket-ом за
      заблокированным блокером — все три в `uncounted`, номера Wave остальных как у `waveNumbers`; Run по названным —
      только названные.
- [ ] Unit test `epicForecast`: 4 выборки — `range: null`; 5 одинаковых выборок `s` на N Ticket-ов — `low = high = N·s`;
      известный набор выборок с seed — фиксированные `low`, `high`, `cumulativeHigh`; `low ≤ high`; `cumulativeHigh`
      не убывает; тот же вход дважды — тот же ответ.
- [ ] Test-ы краснеют на mutant-ах: порог 5 → 4; p90 → p50; выборка без возвращения; Ticket в работе получает номер Wave.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/autopilot-forecast.test.ts` (новый).
- Сначала падающий: `epicForecast` на 5 одинаковых выборках.
- Прогнать `test/unit/autopilot-limits-estimate.test.ts`, `test/unit/autopilot-budget.test.ts`, `test/unit/waves.test.ts`
  и все unit и contract test-ы модуля Autopilot (список — spec, «Соглашения»).

## Где в коде

- `src/shared/autopilot/forecast.ts` (новый)
- `src/shared/autopilot/limits-estimate.ts` — `sample` `:41`, `waveEstimate` `:61`, `ESTIMATE_WAVES` `:12`
- `test/unit/autopilot-forecast.test.ts` (новый)

Только читать: `src/shared/workflow/waves.ts` (`waveNumbers` `:228`, `closed` `:55`, `doneOnlyInBranch` `:58`),
`src/main/autopilot/journal.ts` (`readRecentRuns` `:205`).

## Итог

- `src/shared/autopilot/limits-estimate.ts`: `waveGrowth` (`:43`) — рост доли `seven_day` за одну Wave или `null`
  по прежним правилам (старое число, сброс, Wave без Ticket-ов); `sample` теперь делит его на Ticket-ы.
  `waveSamples` (`:73`) — выборки на Ticket, по времени, 10 последних (`ESTIMATE_WAVES`); `waveEstimate` (`:94`) —
  медиана `waveSamples`. `test/unit/autopilot-limits-estimate.test.ts` не правился и зелёный.
- `src/shared/autopilot/forecast.ts` (новый, без Node и DOM): `percentile` (`:23`, nearest-rank, p в процентах
  0..100, пустой список — `RangeError`); `remainingWaves` (`:50`) — `{ waves, uncounted }`, `waves[i]` — число
  Ticket-ов Wave i + 1, `uncounted` — номера Ticket-ов не `done` в checkout и без номера Wave; `epicForecast`
  (`:107`) — bootstrap `FORECAST_DRAWS` = 1000, mulberry32 с seed `FORECAST_SEED` = `0x5eed`, порог
  `FORECAST_MIN_SAMPLES` = 5.
- Решено без владельца, подтвердить:
  1. Run по названным Ticket-ам: открытый Ticket Epic-а, которого нет в списке, для `waveNumbers` считается
     `blocked` — Run его не возьмёт, и названный Ticket, который ждёт его, номера Wave не получает и попадает в
     `uncounted`. Так `waveNumbers` (в Ticket-е только читать) остаётся без правок.
  2. `cumulativeHigh` длиной W + 1: `cumulativeHigh[0] = 0`, `cumulativeHigh[W] = range.high`; при `range: null` —
     тоже `null`. Ticket 03 берёт K как наибольшее k с `cumulativeHigh[k]` ≤ свободного, K = 0 выходит само.
  3. `uncounted` в ответе `epicForecast` — число, в ответе `remainingWaves` — список номеров.
  4. Seed — `0x5eed`: в spec числа нет, только «постоянный seed».
- Test — `test/unit/autopilot-forecast.test.ts`, 20 test-ов. Сначала падал весь файл (модуля не было). Мутанты, на
  каждом test красный: порог 5 → 4 (`:180`); p90 → p50 во всём ответе, только в `range` и только в
  `cumulativeHigh` (`:186`, `:198`, `:205`); выборка без возвращения (`:186`, `:198`); Ticket в работе получает
  Wave 1 (`:130`); Run по названным считает все Ticket-ы (`:153`); `waveSamples` без отбора 10 последних (`:80` и
  `autopilot-limits-estimate.test.ts`), без сортировки по времени (`:66`); `waveGrowth` делит на Ticket-ы (`:102`,
  `:66` и `autopilot-limits-estimate.test.ts`).
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (549 файлов, 11814 test-ов).
- Оценка автора: около 120 тыс. токенов.
