# worfy-resource-planner: прогноз Epic-а и режим запуска Autopilot

Status: ждёт приёмки владельца.
Source: решения владельца 2026-11-01 (три раунда вопросов, Q1–Q17; раздел «Решения» ниже пересказывает каждое как
поведение); [CONTEXT.md](../../CONTEXT.md), термины Limits, Wave, Autopilot, Run, Wait, Settings, Machine;
worfy-throughput Ticket 40 (оценка Wave по Journal, `src/shared/autopilot/limits-estimate.ts`) и Ticket 41 (budget
Limits с reserve, `src/shared/autopilot/budget.ts`); [ADR-0092](../../docs/adr/0092-run-history.md) (история Run);
[ADR-0093](../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md) (решение этого Epic-а).
Ticket-ы: Epic `worfy-resource-planner`, 12 Ticket-ов, нумерация с `01`. Карты нет: после трёх раундов вопросов
неясного не осталось, кроме двух долгов (раздел «Не решено»).

## Цель

Перед ночным Run пользователь хочет знать две вещи: сколько недели Limits съест то, что осталось от Epic-а, и
успеет ли Run до сброса окна. Сейчас кнопка Autopilot говорит только медиану одной Wave («A Wave like this usually
takes about 6% of the week», Ticket 40), а Run умеет одно правило — дневную долю budget (Ticket 41).

После Epic-а:

1. Tooltip кнопки Autopilot и диалог подтверждения `autopilot_start` показывают прогноз Epic-а: сколько Wave и
   Ticket-ов осталось, диапазон доли недели p10–p90, рекомендацию «K Wave сейчас, остальные после сброса» или
   предупреждение.
2. У Run есть режим запуска: Fastest, Budget-aware или Start window. Режим действует только на границе Wave:
   начать следующую Wave сейчас или ждать.
3. Start window не начинает Wave, которая по p90 своей длительности кончится после конца окна; вне окна Run ждёт
   начала следующего окна.
4. Journal хранит прогноз на старте Run и фактическую долю в конце; Run history показывает их рядом.

## Термины

Канонические имена — английские, как в интерфейсе (ADR-0017); русские слова владельца — в скобках.

- **Epic forecast** (прогноз Epic-а) — диапазон доли 7-дневного окна Limits, которую возьмут оставшиеся Wave Epic-а
  на этой Machine: p10–p90 bootstrap-сумм по прошлым выборкам на Ticket (Ticket 40). Вместе с ним — число
  оставшихся Wave и Ticket-ов, число Ticket-ов без Wave и p90 длительности Wave.
- **Run mode** (режим запуска) — правило, по которому Run на границе Wave решает, начинать ли следующую Wave:
  - **Fastest** — без budget и без окна: следующая Wave идёт сразу. Отказ Limits внутри Wave остаётся жёстким
    пределом, как сейчас (`limits-wait.ts`).
  - **Budget-aware** — существующий budget Ticket-а 41: дневная доля недели с reserve.
  - **Start window** (окно запуска) — новые Wave начинаются только внутри окна; budget тоже действует, если он
    включён в Settings.
- **Start window** как настройка — местное время «с» и «до» (по умолчанию 23:00–07:00, окно может переходить через
  полночь).

Слова, которых нет: «ночной режим» остаётся в Avoid термина Autopilot; «Overnight» как имя режима не используется
(Q6′). «лимиты», «расход» остаются в Avoid термина Limits.

## Решения

Каждое решение владельца 2026-11-01 — как поведение.

- **Q1. Результат.** Принятый spec Epic-а `worfy-resource-planner` с Ticket-ами в `.scratch/worfy-resource-planner/`;
  после spec — остановка до приёмки владельца.
- **Q2. Только граница Wave.** Режим запуска решает одно: начать следующую Wave сейчас или ждать. Идущую Wave он
  никогда не останавливает и не режет.
- **Q3. Оба окна Limits.** `seven_day` — это budget (доля недели), `five_hour` — время (когда можно продолжить). У
  подписки владельца окна `five_hour` больше нет: Anthropic его убрал. Отсутствие окна — нормальное состояние, путь
  `five_hour` проверяется только test-ами со stub Limits (раздел «five_hour»).
- **Q4. Диапазон.** p10–p90 по выборкам Ticket-а 40; меньше 5 выборок — «мало данных», диапазона нет. Размер
  Ticket-а в прогнозе (вариант «в») — долг, раздел «Не решено».
- **Q5. Только эта Machine.** Прогноз — по Epic-у этой Machine и по Journal её Run-ов. Число Limits аккаунта уже
  включает работу другой Machine, отдельно её не считаем. Идущие на другой Machine Wave — долг.
- **Q6′. Режимы и слова.** Fastest (budget выключен), Budget-aware (budget Ticket-а 41 с reserve), Start window
  («Окно запуска»; не «Overnight», «ночной режим» остаётся в Avoid). Термины словаря: режим запуска, окно запуска,
  прогноз Epic-а.
- **Q7. Где виден прогноз.** В диалоге подтверждения `autopilot_start` и в tooltip кнопки Autopilot: строка прогноза
  заменяет строку Ticket-а 40.
- **Q8. Как считается диапазон.** Bootstrap по прошлым выборкам на Ticket: много раз складываем случайные выборки
  (с возвращением) на каждый оставшийся Ticket; p10 и p90 этих сумм — диапазон.
- **Q9. Рекомендация.** «K Wave сейчас, остальные после сброса»: K — сколько первых Wave помещается до сброса
  7-дневного окна по верхнему краю p90, не трогая reserve.
- **Q10. Прогноз и факт.** Прогноз пишется в Journal на старте Run, фактическая доля — в конце; сравнение видно в
  Run history (Flight Recorder).
- **Q11. Единица риска — новая Wave.** Start window не начинает Wave, чья p90 длительности кончается после конца
  окна. Внутри Wave ничего не ограничено по времени; идущую Wave не останавливают.
- **Q12. Длительность Wave.** Прогноз длительности — на Wave, не на Ticket: из Journal, от `wave-started` до
  `wave-finished` минус ожидания Limits и budget внутри; берётся p90. Меньше 5 выборок — окно пропускает Wave и
  говорит «мало данных о длительности».
- **Q13. Вне окна.** Run ждёт начала следующего окна так же, как после `budget-stop`; причина в Journal —
  `start-window`. Run жив, keep-awake держится. Wave, начатая внутри окна, доходит до конца и после его конца.
- **Q14. Выбор режима.** Режим выбирается на один Run в диалоге старта Autopilot; режим по умолчанию и окно (с/до,
  по умолчанию 23:00–07:00 местного времени) — в Settings → Autopilot.
- **Q15. Сочетания.** Start window применяет и budget, если он включён в Settings. Fastest выключает и budget, и
  окно.
- **Q16. Fastest и прогноз.** Fastest тоже показывает прогноз; рекомендация становится предупреждением («до сброса
  влезут 2 из 4 Wave — дальше Run встанет на Limits»), ожидания нет.
- **Q17. Ticket-ы без Wave.** Ticket-ы без номера Wave (заблокированы выше по цепочке, в работе, `done` только в
  ветке) в прогноз не входят; одна строка «N Ticket-ов без Wave не учтены».

## Прогноз Epic-а

Модуль чистый, в `src/shared/autopilot/` (без Node и DOM): им пользуются и main (диалог, Journal), и renderer
(tooltip).

**Выборки на Ticket (Q4, Q8).** Те же выборки, что у Ticket-а 40 (`limits-estimate.ts`): рост доли `seven_day`
между `wave-started` и `wave-finished`, делённый на Ticket-ы Wave; Wave с числом старше 30 минут на любом конце или
со сбросом окна внутри выборки не даёт; берутся 10 последних (`ESTIMATE_WAVES`). Journal-ы — Run-ов Project-а на
этой Machine (`readRecentRuns`, до 30 Run-ов). Меньше 5 выборок (`FORECAST_MIN_SAMPLES`) — «мало данных»:
диапазона и рекомендации нет, число Wave и Ticket-ов есть.

**Что осталось (Q17).** Номера Wave — `waveNumbers` (`src/shared/workflow/waves.ts:228`) по Ticket-ам Epic-а; у
Run по названным Ticket-ам — только по названным. Оставшиеся Wave — 1…W, у каждой своё число Ticket-ов. Ticket, не
`done` в checkout и без номера Wave, не учтён; их число идёт в строку «N Tickets without a Wave are not counted».

**Bootstrap (Q8).** `FORECAST_DRAWS` (1000) повторов; в каждом на каждый оставшийся Ticket берётся случайная выборка
с возвращением, суммы копятся по границам Wave. Генератор случайных чисел — с постоянным seed: одни и те же входы
дают один и тот же диапазон, tooltip не прыгает от перерисовки. Перцентиль — nearest-rank. Итог: p10 и p90 суммы
всех W Wave и p90 накопленной суммы первых k Wave для каждого k.

**Длительность Wave (Q12).** По тем же Journal-ам: для каждой пары `wave-started` … `wave-finished` одного Run —
разница времени минус ожидания Limits внутри неё (от `limits-hit` до `resumed`; ожидание, не закрытое до
`wave-finished`, — до него). Ожидания budget и окна внутрь пары не попадают: они решаются до «Run wave», а
`wave-started` пишется после него. Wave без `wave-finished` выборки не даёт. Берутся 10 последних,
p90; меньше 5 — длительности нет, «мало данных о длительности».

**Рекомендация и предупреждение (Q9, Q16).** «Свободно до сброса» — по свежему (не старше 30 минут,
`BUDGET_FRESH_MS`) числу `seven_day` с известным временем сброса:

- когда в Run действует budget (Budget-aware, или Start window при включённом budget) — `1 − reserve − used`;
  K — наибольшее k, при котором p90 накопленной суммы первых k Wave не больше свободного. Рекомендация — только
  слова: нового правила остановки она не добавляет, Run по-прежнему ведёт budget Ticket-а 41 (выбор без решения
  владельца, «Не решено», п. 13);
- когда budget в Run не действует (Fastest, Start window без budget) — `1 − used` (Run встанет на Limits, а не на
  reserve); при K < W — предупреждение, ожидания нет.

Без свежего числа `seven_day` рекомендации и предупреждения нет, строка говорит «Used now: unknown», как сейчас.
Сброс в рекомендации — сброс 7-дневного окна.

## Режим запуска

**Выбор (Q14).** Settings → Autopilot: «Default run mode» (Fastest, Budget-aware, Start window), «Start window from» и
«Start window to» (по умолчанию 23:00 и 07:00 местного времени). Пока человек режим не выбирал, режим по умолчанию —
Budget-aware при включённом «Daily budget of the Limits» и Fastest при выключенном: поведение сегодняшних Run-ов не
меняется. На один Run режим выбирается в диалоге `autopilot_start`; кнопка Autopilot и команда в чате стартуют в
режиме по умолчанию (раздел «Не решено», п. 1).

**Граница Wave (Q2, Q11, Q13, Q15).** Перед каждым «Run wave» (`sendWave`, `src/main/autopilot/run.ts:1188`), там же,
где сейчас budget:

1. Fastest — Wave идёт. Budget и окно не проверяются, что бы ни стояло в Settings.
2. Start window — сначала окно:
   - сейчас вне окна → ожидание до начала следующего окна, причина `outside`;
   - внутри окна, есть p90 длительности и `сейчас + p90` позже конца окна → ожидание до начала следующего окна,
     причина `wave-too-long`;
   - внутри окна и выборок длительности меньше 5 → Wave идёт; tooltip строки статуса говорит «мало данных о
     длительности».
   Окно пропустило — дальше budget, если он включён в Settings.
3. Budget-aware — budget Ticket-а 41 (`budgetDecision`, `src/shared/autopilot/budget.ts:170`) с reserve из Settings.
4. Ожидание окна устроено как ожидание budget (`budgetWait`, `run.ts:1333`): строки Journal `start-window` и
   `waiting-until`, Run `waiting`, по таймеру — `resumed` и та же проверка заново (окно, потом budget). Stop во
   время ожидания кончает Run сразу с `user-stop`, как во время ожидания budget (`run.ts:903-904`). Keep-awake
   держится до конца Run.
5. Wave, начатая внутри окна, доходит до конца и после конца окна (Q13).

## five_hour

- У подписки владельца окна `five_hour` нет. Отсутствие окна — нормальное состояние: ничего не ждёт его сброса,
  ни одна строка о нём не пишется, ошибки нет.
- Окно `five_hour` входит в Epic только как время: правило budget Ticket-а 41 «5-часовое окно полно → ждать его
  сброса» (`budget.ts:181`) остаётся, а после любого ожидания граница Wave проверяется заново, окно запуска тоже.
  Значит, ожидание `five_hour`, которое уводит за конец окна, кончается ожиданием следующего окна.
- Это узкое прочтение Q3, выбор без решения владельца («Не решено», п. 14): `five_hour` действует только через
  правило budget. В Fastest и в Start window без budget граница Wave на него не смотрит (полное окно встретит Wave
  отказом Limits внутри, как сейчас), а в прогнозе — в диапазоне, рекомендации, предупреждении и строке окна — его нет.
- Путь `five_hour` проверяется только test-ами со stub Limits (unit с `LimitsState`, contract с часами test-а, e2e —
  `limits.json` в `WORFY_DATA_DIR`). Приёмка на Mac владельца его не проверяет.

## Что видит пользователь

Тексты интерфейса — английские (`scripts/check-cyrillic.mjs`), в форме строки Ticket-а 40 (`waveEstimateLine`,
`limits-estimate.ts:118`): предложения через «. », проценты целые, длительность — `duration()` того же файла
(`2 d 5 h`, `3 h 10 min`, `25 min`). Числа в примерах — для формы.

**Строка прогноза** (заменяет строку Ticket-а 40 в tooltip кнопки Autopilot):

- `This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h`
- края, округлённые до одного числа: `…, usually about 18% of the week…`; оба ниже 1 %: `…, usually less than 1% of the week…`
- мало данных: `This Epic: 4 Waves, 11 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 41%, resets in 2 d 5 h`
- Ticket-ы без Wave (Q17), отдельным предложением после первого: `2 Tickets without a Wave are not counted` (одна —
  `1 Ticket without a Wave is not counted`)
- ничего не осталось для прогноза: `This Epic: no Wave left to forecast`
- без числа `seven_day` — хвост `Used now: unknown`, без времени сброса — без `resets in …`, как сейчас.

**Рекомендация** (budget действует в Run):

- `Recommended: 2 Waves now, the other 2 after the reset`
- все помещаются: `All 4 Waves fit before the reset without the reserve`
- ни одна: `Recommended: no Wave now, all 4 after the reset`

**Предупреждение** (budget в Run не действует, K < W): `Only 2 of 4 Waves fit before the reset: then the run waits for the Limits`.

**Окно** (режим Start window): `Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min`; мало данных —
`Start window 23:00–07:00. Not enough data on Wave duration: every Wave may start inside the window`.

**Режим** (только tooltip кнопки, первым предложением хвоста): `Mode: Budget-aware (Settings → Autopilot)`.

**Диалог `autopilot_start`** (`src/main/autopilot/chat-confirm.ts:71`, нативный message box). К `detail` после
текущего первого абзаца добавляются строки:

```
Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h.
Budget-aware: Recommended: 2 Waves now, the other 2 after the reset.
Fastest: Only 2 of 4 Waves fit before the reset: then the run waits for the Limits.
Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.
```

Строки Budget-aware и Fastest — только когда есть что сказать (без числа `seven_day` или при «мало данных» их нет).
Кнопки: `Start: Fastest`, `Start: Budget-aware`, `Start: Start window`, `Cancel`; кнопка режима по умолчанию — с
` (default)` в конце; `Cancel` остаётся кнопкой по умолчанию, Enter ничего не запускает.

**Строка статуса** (`autopilotStatusLine`, `src/shared/ipc/autopilot.ts:172`), `waitingFor: 'start-window'`:

- вне окна: `outside start window · resumes 23:00`, tooltip — `Outside the start window 23:00–07:00: Autopilot continues at 23:00`;
- Wave не успеет: `wave too long for window · resumes 23:00`, tooltip — `Wave 3 usually takes up to 2 h 10 min and would end after 07:00: Autopilot continues at 23:00`;
- Wave пошла без данных о длительности: строка обычная (`Wave 2 · running`), tooltip — `Not enough data on Wave duration: Wave 2 started without the window check`.

**Settings → Autopilot:** `Default run mode` (Select: `Fastest`, `Budget-aware`, `Start window`), `Start window from` и
`Start window to` (Select по часам `00:00` … `23:00`; неактивны, пока режим по умолчанию не Start window). Описания:
Fastest — `Waves go one after another: no budget, no window.`; Budget-aware — `The daily budget of the Limits, with the reserve.`;
Start window — `New Waves start only between the times below; the daily budget too, when it is on.`.

**Run history** (Flight Recorder): в шапке Run — `Forecast 18–31% · actual 24%` (или `Forecast: not enough data ·
actual 24%`, `actual: unknown`, когда фактической доли нет) и режим Run; Wait с причиной `start-window` на дорожке Wait.

## Journal

Формат — шапка `src/shared/autopilot/journal.ts`. Новое (ADR-0093):

- `run-started.mode?` — `fastest`, `budget-aware` или `start-window`: режим Run. Строки до этого Epic-а его не
  имеют и читаются как раньше.
- `forecast` (новый вид, после `run-started` и `harness-behind`, если тот есть, до первого `wave-started`) — `mode`, `waves`, `tickets`,
  `uncounted`, `samples`, `low` и `high` (доли 0..1, `null` при «мало данных»), `fit` (K, `null` без рекомендации),
  `week` (`utilization`, `resetsAt` — число `seven_day` на старте, `null` без него), `durationP90Ms` (`null` при
  «мало данных о длительности»), `durationSamples`, `window?` (`from`, `to` — только у Start window).
- `start-window` (новый вид) — `reason` (`outside` или `wave-too-long`), `until`, `text`, `durationP90Ms?`; за ним
  `waiting-until`, потом `resumed`, как за `budget-stop`.
- `run-stopped.actual?` — `share` (сумма роста доли `seven_day` по Wave этого Run, по правилу выборок Ticket-а 40),
  `waves` (сколько Wave Run закончил), `counted` (сколько из них дали выборку). Без законченных Wave поля нет.

Виды добавляются и в `JOURNAL_KINDS` (`src/shared/flight-recorder/journal-walk.mjs:9`): unit test держит списки
равными. В Flight Recorder новая причина Wait — `start-window` (`WAIT_CAUSES`, `src/shared/flight-recorder/facts.ts:25`).

## Не решено

**Долги владельца (вне Epic-а).**

1. **Размер Ticket-а в прогнозе** (Q4, вариант «в»). Сейчас все Ticket-ы весят одинаково: одна выборка на Ticket.
   Учитывать размер (число файлов, тип, Stage-ы) — отдельное решение.
2. **Идущие Wave другой Machine** (Q5). Прогноз не вычитает то, что за время Run возьмёт Run другой Machine:
   число аккаунта включает её прошлую работу, но не будущую.

**Выбрано в spec без решения владельца — подтверждено владельцем 2026-11-01.**

1. Кнопка Autopilot и команда в чате стартуют в режиме по умолчанию; режим на один Run выбирается только в диалоге
   `autopilot_start` (у кнопки диалога нет; Q7 называет диалогом старта диалог `autopilot_start`).
2. Режимы в нативном диалоге — три кнопки старта и `Cancel`; `Cancel` по умолчанию. Инструмент `autopilot_start` не
   получает параметра `mode`.
3. Budget-aware применяет budget независимо от переключателя «Daily budget of the Limits»; переключатель решает
   только за Start window (Q15) и за режим по умолчанию, пока человек его не выбрал.
4. Предупреждение Fastest считает до полной недели (`1 − used`), а не до reserve: Run без budget встаёт на Limits,
   а не на reserve. Start window без budget — так же.
5. Выборки — 10 последних, как у Ticket-а 40; 1000 повторов bootstrap с постоянным seed; перцентиль nearest-rank;
   длительности — тоже 10 последних Wave.
6. Строка прогноза заменяет строку Ticket-а 40 и при 3–4 выборках говорит «мало данных», хотя медиана Ticket-а 40
   уже есть; сама медиана остаётся у budget (`need` в `budgetDecision`).
7. Run по названным Ticket-ам прогнозирует только названные.
8. Окно в Settings — по целым часам; «с» и «до» не могут совпадать.
9. Форма Journal: `run-started.mode`, виды `forecast` и `start-window`, `run-stopped.actual` (раздел «Journal»).
10. «Мало данных о длительности» не пишется в Journal отдельно: его видно по `forecast.durationSamples`.
11. Страница документации — новая `docs/features/run-planning.md` с переводом; раздел «The budget of the Limits»
    переезжает туда из `autopilot.md` (тот уже длиннее 400 строк).
12. В `CONTEXT.md` — заголовки `Run mode`, `Start window`, `Epic forecast` (термины словаря английские, ADR-0017),
    русские слова владельца — в определении.
13. Рекомендация «K Wave сейчас, остальные после сброса» — только слова: нового правила остановки нет, Run в
    Budget-aware ведёт дневная доля budget Ticket-а 41. Поэтому tooltip может сказать «Recommended: 2 Waves now», а
    budget остановит Run на дневной доле уже после первой Wave. Другое прочтение Q9 — Run сам ждёт сброса после K
    Wave; тогда это новое правило границы Wave.
14. `five_hour` — только через правило budget Ticket-а 41 (раздел «five_hour»): граница Wave в Fastest и в Start
    window без budget его не проверяет, прогноз его не учитывает. Другое прочтение Q3 — время до сброса `five_hour`
    входит в проверку окна и в строку прогноза.
15. Прогноз вычисляется из Journal при каждом показе: своей модели, кэша или файла статистики нет. Владелец этого не
    решал; ADR-0005 позволяет worfy держать такой файл в своей папке данных.

## Не в этом Epic-е

- Размер Ticket-а в прогнозе и Run-ы другой Machine (раздел «Не решено»).
- Ограничение по времени внутри Wave: остановка Ticket-а или Wave по концу окна (Q2, Q11).
- Цены и деньги: только доли Limits, как у Ticket-ов 40 и 41.
- Режим для «Run wave» с Canvas и из Command palette: это не Run.
- Аналитика по многим Run (точность прогноза за месяц и т. п.): Run history сравнивает прогноз и факт одного Run.
- Topic Guide «Autopilot» — отчёт об отставании Guide поймает его сам.

## Риски

1. **Мало выборок.** 10 Wave на bootstrap — грубый диапазон; при новом Project «мало данных» будет неделями. Это
   честный ответ, а не ошибка.
2. **Местное время окна.** Переход на летнее время и окно через полночь — test-ы с фиксированной time zone
   (`timeZone` и фиксированные часы, как `budgetStopText`).
3. **Keep-awake днём.** Run в Start window, начатый днём, ждёт до 23:00 с keep-awake (Q13): экран не гаснет весь
   день. Это решение владельца; документация его называет.
4. **Сброс недели внутри Run.** Факт `run-stopped.actual` считает только Wave без сброса внутри; Wave со сбросом
   идут в `waves`, но не в `counted`.

## Ticket-ы

Test-ы — внутри Ticket-ов, сначала падающий. UI — снимки в обеих темах в `.scratch/worfy-resource-planner/evidence/<NN>/`.

- **01 — Прогноз Epic-а: ядро.** Выборки на Ticket, bootstrap, оставшиеся Wave и Ticket-ы, Ticket-ы без Wave, «мало
  данных». Blocked by: —. Не UI.
- **02 — Длительность Wave.** Выборки длительности из Journal минус ожидания, p90, «мало данных о длительности».
  Blocked by: 01. Не UI.
- **03 — Рекомендация, предупреждение и строки.** K по p90 без reserve, предупреждение Fastest, все английские строки
  прогноза. Blocked by: 01, 02, 04. Не UI (чистые строки).
- **04 — Settings: режим по умолчанию и окно.** Настройки, раздел Settings → Autopilot, расчёт окна по местному
  времени. Blocked by: —. UI.
- **05 — Run: режим на границе Wave.** Режим в старте Run, проверка окна, ожидание `start-window`, Fastest выключает
  budget и окно, строка статуса. Blocked by: 02, 04. UI (строка статуса).
- **06 — Диалог старта и tooltip кнопки.** Прогноз и выбор режима в `autopilot_start`, строка прогноза в tooltip.
  Blocked by: 03, 04, 05. UI.
- **07 — Journal: прогноз на старте, факт в конце.** `forecast`, `run-stopped.actual`. Blocked by: 01, 03, 05. Не UI.
- **08 — Flight Recorder читает прогноз, факт и Wait окна.** Факты Run и Wait `start-window`. Blocked by: 05, 07. Не UI.
- **09 — Термины в CONTEXT.md.** Run mode, Start window, Epic forecast; «ночной режим» в Avoid. Blocked by: —. Не UI.
- **10 — Документация.** `docs/features/run-planning.md` и перевод. Blocked by: 06, 07. Не UI.
- **11 — Прогноз и факт в Run history.** Шапка Run на экране Flight Recorder. Ждёт merge Ticket-а 18 Epic-а
  `worfy-flight-recorder` (экран шкалы): до него Ticket в статусе `blocked`, `Blocked reason:` «ждёт merge
  worfy-flight-recorder 18». Blocked by: 08, 10. UI.
- **12 — Приёмка с владельцем.** Run в Start window на Mac Stable, прогноз против факта. Blocked by: 01–11. UI
  (снимки владельцу).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов нет. Таблица — план; Wave,
которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/shared/autopilot/forecast.ts`, `src/shared/autopilot/limits-estimate.ts`, `test/unit/autopilot-forecast.test.ts` | 1 |
| 04 | `src/shared/autopilot/run-mode.ts`, `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`, `src/renderer/settings/AutopilotSection.tsx`, `test/unit/autopilot-run-mode.test.ts`, `test/unit/settings-autopilot.test.tsx`, `test/contract/app-settings.test.ts`, `test/e2e/settings.spec.ts` | 1 |
| 09 | `CONTEXT.md` | 1 |
| 02 | `src/shared/autopilot/wave-duration.ts`, `test/unit/autopilot-wave-duration.test.ts` | 2 |
| 03 | `src/shared/autopilot/forecast-lines.ts`, `src/shared/autopilot/limits-estimate.ts`, `test/unit/autopilot-forecast-lines.test.ts` | 3 |
| 05 | `src/shared/autopilot/run-mode.ts`, `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `src/main/autopilot/journal.ts`, `src/shared/flight-recorder/journal-walk.mjs`, `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `test/unit/autopilot-run-mode.test.ts`, `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts`, `test/unit/canvas-actions.test.tsx`, `test/contract/autopilot-limits.test.ts`, `test/contract/autopilot-journal.test.ts`, `test/e2e/autopilot.spec.ts` | 3 |
| 06 | `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `src/shared/autopilot/limits-estimate.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/main/autopilot/chat-confirm.ts`, `src/main/autopilot/chat-start.ts`, `test/contract/autopilot-start-tool.test.ts`, `test/unit/autopilot-limits-estimate.test.ts`, `test/unit/autopilot-chat-start.test.ts`, `test/unit/canvas-actions.test.tsx`, `test/e2e/autopilot.spec.ts` | 4 |
| 07 | `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `src/shared/flight-recorder/journal-walk.mjs`, `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts` | 4 |
| 08 | `src/shared/flight-recorder/facts.ts`, `src/shared/flight-recorder/from-journal.ts`, `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-summary.test.ts` | 5 |
| 10 | `docs/features/run-planning.md`, `docs/features/ru/run-planning.md`, `docs/features/autopilot.md`, `docs/features/README.md`, `docs/features/ru/README.md` | 5 |
| 11 | `src/renderer/flight-recorder/RunHistoryView.tsx`, `docs/features/run-planning.md`, `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts` | 6 |
| 12 | `.scratch/worfy-resource-planner/spec.md` | 7 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры. Если у двух Ticket-ов одной Wave общий файл,
Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 04, 09.** Блокеров нет. 01 — чистый прогноз, 04 — настройки и расчёт окна, 09 — словарь.
- **Wave 2 — 02.** Ждёт 01: перцентиль и выборки — в `forecast.ts`.
- **Wave 3 — 03, 05.** 03 ждёт 01, 02 и 04 (подписи режимов `RUN_MODES`), 05 — 02 и 04. Общих файлов нет: 03 правит `limits-estimate.ts` (экспорт
  `duration`), 05 его не трогает; `autopilot-run-mode.test.ts` 04 и 05 правят в разных Wave.
- **Wave 4 — 06, 07.** 06 ждёт 03, 04, 05; 07 — 01, 03, 05. Общих файлов нет: 06 — IPC, tooltip, диалог; 07 — `run.ts`
  и Journal. `test/e2e/autopilot.spec.ts` и `test/unit/canvas-actions.test.tsx` 05 и 06 правят в разных Wave.
- **Wave 5 — 08, 10.** 08 ждёт 05 и 07, 10 — 06 и 07. Общих файлов нет.
- **Wave 6 — 11.** Ждёт 08 и 10, а вне Epic-а — merge Ticket-а 18 Epic-а `worfy-flight-recorder` (он создаёт
  `RunHistoryView.tsx` и `test/e2e/flight-recorder.spec.ts`). Пока 18 не влит, 11 стоит в `blocked` (`ticket block`) и Autopilot его не берёт; после merge 18 —
  `ticket open`.
- **Wave 7 — 12.** Владелец.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-resource-planner/<NN>`, worktree `.claude/worktrees/<NN>`. Глубина ревью — по общему правилу; 01 (модель
  прогноза) и 05 (поведение Run) — `high`.
- Без токенов: unit и contract — со stub Limits (`LimitsState`) и часами test-а; e2e — `WORFY_AGENT=fake`, Journal-ы
  через `WORFY_DATA_DIR`, Limits — `limits.json` там же (как test budget в `test/e2e/autopilot.spec.ts`).
- `five_hour` — только stub. Каждый Ticket, который читает Limits, проверяет и состояние без окна `five_hour`.
- Время — местное, test-ы задают time zone явно (`TZ` процесса test-а или параметр `timeZone`).
- Новый e2e spec — строка в `scripts/e2e-specs.table.json`; правка существующего spec — без строки.
- Каждый Ticket, который правит модуль Autopilot, прогоняет все его unit и contract test-ы: `test/unit/autopilot-*.test.ts`,
  `test/unit/waves.test.ts`, `test/unit/settings-autopilot.test.tsx`, `test/contract/autopilot*.test.ts`,
  `test/contract/agent-send-autopilot.test.ts`, `test/contract/app-settings.test.ts`, `test/contract/canvas-tools.test.ts`.

## Готово, когда

- [x] Tooltip кнопки Autopilot показывает режим и строку прогноза вместо строки Ticket-а 40; «мало данных» при
      меньше чем 5 выборках; строка о Ticket-ах без Wave. Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
- [x] Диалог `autopilot_start` показывает прогноз, рекомендацию, предупреждение Fastest и строку окна и запускает Run
      в выбранном режиме. Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
- [x] Settings → Autopilot: режим по умолчанию и окно 23:00–07:00 по умолчанию. Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
- [ ] Run в Start window ждёт вне окна и не начинает Wave, которая по p90 не успеет; Wave внутри окна доходит до
      конца; Fastest не ждёт ни budget, ни окна; Start window с budget ждёт обоих. Не проверено на живом Run: отдельный Run в режиме Start window не проводился (покрыто test-ами; [Итог 12](issues/12-приёмка-с-владельцем.md)).
- [x] Journal: `run-started.mode`, `forecast`, `start-window`, `run-stopped.actual`; Run history показывает прогноз
      и факт рядом и Wait `start-window`. Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
- [x] Без окна `five_hour` всё работает и ничего о нём не говорит; путь `five_hour` покрыт test-ами со stub. Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
- [x] `CONTEXT.md` и `docs/features/run-planning.md` с переводом. Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
- [x] Приёмка владельца (12). Итог: [Ticket 12](issues/12-приёмка-с-владельцем.md).
