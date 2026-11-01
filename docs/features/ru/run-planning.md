# Run planning

> Перевод [английской версии](../run-planning.md), commit `same-pr`.

Как Autopilot перед каждой Wave Run-а решает, начать следующую Wave сейчас или ждать, и что он говорит человеку о
Limits недели до старта Run-а. Сам Run описан на странице [Autopilot](autopilot.md). Если термины незнакомы, начните с
[Concepts](concepts.md).

## Run mode and Epic forecast

### Behaviour

#### Run mode

Каждый Run Autopilot-а идёт в одном **Run mode** (режим запуска). Режим фиксируется на старте Run-а и не меняется до
его конца. Он действует только на границе Wave, до отправки «Run wave»: решает, начать следующую Wave сейчас или ждать.
Wave в работе он никогда не останавливает и не обрывает. Отказ Limits внутри Wave в любом режиме остаётся жёстким
пределом: Run ждёт сброса, как описано на странице [Autopilot](autopilot.md).

| Режим | Перед каждой Wave |
|---|---|
| **Fastest** | Следующая Wave идёт сразу. Ни budget, ни Start window не проверяются. |
| **Budget-aware** | Дневной budget Limits с reserve, включён **Daily budget of the Limits** или нет. |
| **Start window** | Новая Wave начинается только внутри Start window. После окна проверяется и budget, если **Daily budget of the Limits** включён. |

Run берёт режим по умолчанию из Settings → Autopilot (**Default run mode**). Кнопка **Autopilot** и команда
`/worfy:epic-wave`, набранная в чате, всегда стартуют в этом режиме. Выбрать режим одного Run-а можно только в диалоге
canvas-инструмента `autopilot_start`, который агент вызывает, когда человек словами просит его запустить Epic. Кнопок в
диалоге четыре:

- **Start: Fastest**
- **Start: Budget-aware**
- **Start: Start window**
- **Cancel**

Кнопка режима по умолчанию кончается на « (default)», например **Start: Budget-aware (default)**. **Cancel** — кнопка
по умолчанию, поэтому Enter или Escape сами по себе ничего не запускают.

Настройки и окно читаются заново перед каждой Wave. Изменение Settings во время Run-а меняет окно и budget его
следующей Wave, но не его режим.

#### Settings → Autopilot

Эти настройки принадлежат Machine.

| Настройка | Значения | По умолчанию | Что написано под ней |
|---|---|---|---|
| Default run mode | Fastest, Budget-aware, Start window | Budget-aware, пока budget включён, Fastest, пока выключен | Fastest: «Waves go one after another: no budget, no window.» Budget-aware: «The daily budget of the Limits, with the reserve.» Start window: «New Waves start only between the times below; the daily budget too, when it is on.» |
| Start window from | от 00:00 до 23:00, целые часы | 23:00 | «Local time; the window may go across midnight.» |
| Start window to | от 00:00 до 23:00, целые часы | 07:00 | «No new Wave starts from this hour on; a Wave in work is never cut.» |
| Daily budget of the Limits | вкл., выкл. | выкл. | «Spreads what is left of the week over the days until it resets. Once today's share is used, Autopilot starts no new Wave and continues the next day; a Wave in work is never cut.» |
| Reserve for your own work | от 0 до 50 % недели | 15 % | «The share of the week Autopilot leaves for your work by hand.» |

Значение **Default run mode** по умолчанию следует за переключателем budget, только пока человек не выбрал режим. Два
часа окна неактивны, если режим по умолчанию не Start window, а час, равный другому краю, не сохраняется: окно было бы
пустым. Reserve неактивен, пока budget выключен, если только режим по умолчанию не Budget-aware. Preset Pro в
Settings → Plan включает budget.

#### Start window

Start window (окно запуска) — местное время от одного целого часа до другого. Окно, чей конец не позже начала, переходит
через полночь, как 23:00–07:00. В день перевода часов окно всё равно начинается и кончается в свои часы по настенным
часам, поэтому в эту ночь оно на час короче или длиннее.

В режиме Start window перед каждой Wave:

1. Когда Wave обычно длятся дольше всего окна, ни одна ночь не даст начать следующую. Run сразу останавливается с
   причиной `window-too-short`, а не ждёт. Tooltip его строки состояния говорит почему, например «Wave 2 usually takes
   up to 1 h 10 min, longer than the Start window 03:00–04:00: widen the window or start the Run in another mode.»
2. Вне окна Run ждёт следующего начала окна.
3. Внутри окна Wave, которая кончилась бы после конца окна, тоже ждёт следующего начала окна. «Кончилась бы» значит:
   сейчас плюс 90-й перцентиль (p90) длительностей последних Wave позже конца окна.
4. Меньше 5 прошлых Wave с известной длительностью — p90 нет. Wave идёт внутри окна без этой проверки.
5. Когда budget включён, он проверяется после окна.

Wave, начатая внутри окна, доходит до конца и после того, как окно закрылось. Wave, чья p90 кончается ровно в конце
окна, всё равно идёт.

Пока Run ждёт окна:

| Строка состояния | Её tooltip |
|---|---|
| `outside start window · resumes 23:00` | `Outside the start window 23:00–07:00: Autopilot continues at 23:00` |
| `wave too long for window · resumes 23:00` | `Wave 3 usually takes up to 2 h 10 min and would end after 07:00: Autopilot continues at 23:00` |

У Wave, ушедшей без проверки длительности, строка состояния обычная, например `Wave 2 · running`, а её tooltip говорит
`Not enough data on Wave duration: Wave 2 started without the window check`.

Во время ожидания Run жив. Он всё время держит экран включённым, поэтому Run в Start window, начатый утром, держит экран
включённым весь день, пока окно не откроется. В начале окна Run проверяет снова: окно, затем budget. Stop во время
ожидания сразу заканчивает Run с `user-stop`.

#### Budget Limits

Budget не даёт Autopilot потратить всю неделю, пока владелец не сел работать вручную. Он действует в режиме
Budget-aware, а в режиме Start window — когда включён **Daily budget of the Limits**. **Reserve for your own work** —
доля недели, которую Autopilot оставляет.

Budget читается перед каждой Wave и никогда не обрывает Wave в работе. Когда он останавливает следующую Wave, Run
находится в `waiting` до времени в строке состояния, а затем проверка идёт снова. Wave не стартует, когда:

- от доли дня ничего не осталось, либо осталось меньше оценки Wave, когда из доли дня что-то уже взято. Строка
  состояния — `today's share used · resumes 00:00`. Run продолжит в начале следующего местного дня или при сбросе
  окна на 7 дней, если это раньше;
- доля дня осталась, а окно на 5 часов заполнено. Строка состояния — `5-hour limits full · resumes 02:12`. Run
  продолжит при сбросе окна на 5 часов или в начале следующего дня, если это раньше.

Tooltip строки состояния называет причину словами: «Today's share of the Limits is used: Autopilot continues at
00:00» или «The 5-hour Limits are used, today's share is not: Autopilot continues at 02:12».

Первая Wave дня идёт всегда, когда у дня есть доля, поэтому Wave с оценкой больше всей доли не ждёт вечно. Неизвестное
или старше 30 минут число окна на 7 дней ничего не останавливает. Stop во время ожидания сразу заканчивает Run с
`user-stop`.

#### Окно на 5 часов

У Limits два окна: окно на 7 дней — это budget, окно на 5 часов — только время, которого можно ждать. У подписки может
вовсе не быть окна на 5 часов. Это нормальное состояние: ничто не ждёт его сброса, ни одна строка Journal о нём не
пишется, ошибкой это не считается.

Окно на 5 часов действует только через правило budget выше. Fastest и Start window без budget не смотрят на него перед
Wave: полное окно на 5 часов встретит Wave отказом Limits внутри неё. Epic forecast его не учитывает. После ожидания
сброса окна на 5 часов Run снова проверяет Start window, поэтому ожидание, которое кончается после конца окна,
превращается в ожидание следующего окна.

#### Epic forecast

**Epic forecast** (прогноз Epic-а) говорит, какую долю Limits недели обычно берут оставшиеся Wave Epic-а на этой
Machine. Он виден в tooltip кнопки **Autopilot** и в диалоге `autopilot_start`. Он ничего не останавливает: Run ведёт
только его Run mode.

Tooltip активной кнопки **Autopilot** кончается такими строками, соединёнными через «. ». Пока main не ответил
выборками, он кончается одной строкой режима.

1. Режим, в котором стартует кнопка: `Mode: Budget-aware (Settings → Autopilot)`.
2. Прогноз: `This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h`.
3. В режиме, где budget действует (Budget-aware или Start window с включённым budget), — рекомендация:
   `Recommended: 2 Waves now, the other 2 after the reset`. В режиме, где не действует (Fastest или Start window с
   выключенным budget), — предупреждение: `Only 2 of 4 Waves fit before the reset: then the run waits for the Limits`.
4. В режиме Start window — окно: `Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min`.

Формы строки прогноза:

| Случай | Текст |
|---|---|
| Оба края округляются до одного числа | `…, usually about 18% of the week…` |
| Оба края меньше 1 % | `…, usually less than 1% of the week…` |
| Меньше 5 выборок | `This Epic: 4 Waves, 11 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 41%, resets in 2 d 5 h` |
| Ticket-ы без номера Wave | предложение после первого: `2 Tickets without a Wave are not counted` или `1 Ticket without a Wave is not counted` |
| Wave не осталось | `This Epic: no Wave left to forecast` |
| Нет числа окна на 7 дней или оно старше 30 минут | хвост — `Used now: unknown` |
| Нет времени сброса | в хвосте нет `resets in …` |

Ticket не получает номера Wave, когда он в работе, done только в ветке worktree, заблокирован или ждёт такого Ticket-а.

Формы рекомендации и предупреждения:

| Случай | Рекомендация | Предупреждение |
|---|---|---|
| Помещаются некоторые Wave | `Recommended: 2 Waves now, the other 2 after the reset` | `Only 2 of 4 Waves fit before the reset: then the run waits for the Limits` |
| Помещаются все Wave | `All 4 Waves fit before the reset without the reserve` (`1 Wave fits …` для одной) | строки нет |
| Не помещается ни одна | `Recommended: no Wave now, all 4 after the reset` | `No Wave fits before the reset: then the run waits for the Limits` |

Ни одной из этих строк нет без числа окна на 7 дней не старше 30 минут с временем сброса впереди или при меньше чем
5 выборках. Без данных о длительности Wave строка окна говорит `Start window 23:00–07:00. Not enough data on Wave
duration: every Wave may start inside the window`.

Рекомендация — только слова. Run в Budget-aware ведёт дневной budget, поэтому tooltip может сказать «Recommended:
2 Waves now», а budget всё равно остановит Run на доле дня после первой Wave.

В диалоге `autopilot_start` прогноз стоит между первым абзацем и последним, по строке на режим, какой бы режим человек
потом ни выбрал:

```
Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h.
Budget-aware: Recommended: 2 Waves now, the other 2 after the reset.
Fastest: Only 2 of 4 Waves fit before the reset: then the run waits for the Limits.
Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.
```

Строк `Budget-aware:` и `Fastest:` нет, когда им нечего сказать. Строка `Budget-aware:` учитывает reserve из Settings,
что бы ни говорил переключатель budget. Run по названным Ticket-ам прогнозирует только их. Когда Journal-ы Run-ов не
читаются, в диалоге нет прогноза, но он всё равно спрашивает.

#### Прогноз и фактическая доля в Journal

Run пишет свой прогноз один раз, на старте, строкой `forecast`, а долю недели, которую он на самом деле взял, — полем
`actual` строки `run-stopped`. `run-started` называет режим, а каждое ожидание Start window — строка `start-window`.
Все строки Journal перечислены на странице [Autopilot](autopilot.md).

### How it works

**Режим действует только на границе Wave.** Прерванный Ticket оставил бы worktree и ветку посреди работы, и утром их
разбирал бы человек, поэтому режим решает только, начинать ли следующую Wave, а отказ Limits внутри Wave остаётся
прежним ([ADR-0093](../../adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md)). Окно ограничивает старт Wave, а
не работу: Wave, начатая под самый конец окна, может идти после него часами. Ожидание окна и ожидание budget — одно
ожидание перед Wave: по одному за раз, и Stop, Force stop и выход из приложения заканчивают их одинаково.

**Порядок проверок.** Fastest не проверяет ничего. Budget-aware проверяет budget, считая переключатель включённым. Start
window спрашивает сначала окно, а потом budget, только если переключатель включён. Окно отвечает в таком порядке: p90
дольше всего окна останавливает Run, где бы ни были часы; вне окна Run ждёт его следующего начала; без p90 Wave идёт;
Wave, чья p90 кончится после конца окна, ждёт следующего начала. Длина окна считается по его часам, поэтому в ночь
перевода часов назад Wave, которая поместилась бы только в эту ночь, всё равно останавливает Run.

**Края окна ищутся по настенным часам.** Следующее начало и конец окна — ближайшие моменты, когда местные часы
показывают эти часы. Час, который перевод пропускает, даёт момент после скачка. Run спрашивает окно снова после каждого
ожидания, поэтому пробуждение, попавшее вне окна, лишь заставит его подождать ещё раз.

**Длительность Wave.** Выборка — время от `wave-started` Run-а до его `wave-finished` той же Wave минус ожидания Limits
внутри неё: от `limits-hit` до `resumed` или до `wave-finished`, если `resumed` не было. Ожидания budget и окна внутрь
никогда не попадают: Run решает их до отправки «Run wave» и пишет `wave-started` после. Wave без `wave-finished`,
например оборванная Force stop, выборки не даёт, как и Wave, чьи времена идут назад. Длительность — p90 последних 10
выборок по концу Wave, по ближайшему рангу; меньше 5 выборок — её нет.

**Выборки прогноза.** Выборка — рост доли окна на 7 дней между строками `wave-started` и `wave-finished` Wave,
делённый на её Ticket-ы. Wave с числом старше 30 минут на любом из концов, со сбросом окна внутри или с упавшей долей
выборки не даёт. Берутся выборки последних 10 Wave, которые её дают, из Journal-ов 30 последних Run-ов Project-а на
этой Machine, по любому Epic-у. Все Ticket-ы весят одинаково. Числа — доли недели, без цен.

**Диапазон — bootstrap.** Прогноз делает 1000 повторов. В каждом каждому оставшемуся Ticket-у достаётся случайная
выборка, с возвращением, а суммы запоминаются на каждой границе Wave. Диапазон — 10-й и 90-й перцентили (p10 и p90)
итога, по ближайшему рангу. Случайные числа идут от постоянного seed, поэтому одни и те же Journal-ы дают один и тот же
диапазон. Меньше 5 выборок — диапазона нет.

**Оставшиеся Wave.** Каждый открытый Ticket получает номер Wave повторением шага готовой Wave до конца, как считает
таблица Waves в spec: Wave 1 — готовая Wave сейчас, затем её Ticket-ы считаются done, и так далее. Кнопка считает
Ticket-ы, которые держит рамка. В Run-е по названным Ticket-ам считаются только названные, а открытый Ticket, который
Run не называет, никогда не берётся, поэтому названный Ticket, который его ждёт, тоже не получает Wave.

**Сколько Wave помещается.** K — наибольшее число первых Wave, чья сумма по p90 не больше доли, свободной до сброса
окна на 7 дней. Где budget действует, свободная доля — 1 − reserve − взятое сейчас; где не действует — 1 − взятое
сейчас, потому что такой Run встаёт на Limits, а не на reserve. Рекомендация читает K с reserve, предупреждение
Fastest — без него. Доли сравниваются в целых миллионных, поэтому ошибка двоичного округления не выбрасывает Wave,
которая помещается ровно.

**Budget.** Всё считается от окна на 7 дней:

- Доля дня = (1 − reserve − доля окна на 7 дней в начале дня) / число дней до сброса окна на 7 дней, сегодняшний
  включён.
- Взято сегодня = доля окна на 7 дней сейчас − доля окна на 7 дней в начале дня.
- Начало дня — первое число сегодняшнего дня в Journal-ах Project-а для того же окна на 7 дней. Поэтому доля весь день
  одна и та же, а сброс окна начинает её заново. Взятое вручную до первой Wave дня поэтому не считается сегодняшним.

**Оценка одной Wave.** Budget сравнивает остаток дня с оценкой следующей Wave: медиана тех же выборок на Ticket,
последних 10, умноженная на Ticket-ы Wave. Ей нужно не меньше 3 выборок. Перед `wave-started` и `wave-finished` Run
один раз спрашивает usage, когда его число старше 5 минут; токенов модели это не стоит.

**Фактическая доля.** `run-stopped.actual` складывает рост доли окна на 7 дней по оконченным Wave Run-а по тому же
правилу, что и выборки. Wave со старым числом или со сбросом недели внутри входит в `waves`, но не в `counted`.

**Считается каждый раз.** Прогноз вычисляется из Journal-ов при каждом показе. Своей модели, кэша или файла статистики
у него нет.

### Implementation

#### Модули

| Путь | Что в нём |
|---|---|
| `src/shared/autopilot/run-mode.ts` | Run mode и их названия, Start window, `windowDecision` на границе Wave, слова ожидания и `window-too-short`. Чистые функции. |
| `src/shared/autopilot/wave-duration.ts` | `waveDurationP90`: длительность Wave по Journal-ам. Чистые функции. |
| `src/shared/autopilot/forecast.ts` | `remainingWaves` и `epicForecast`: оставшиеся Wave и диапазон bootstrap; `percentile`. Чистые функции. |
| `src/shared/autopilot/forecast-lines.ts` | `fitBeforeReset` (K) и строки tooltip и диалога. Чистые функции. |
| `src/shared/autopilot/limits-estimate.ts` | `waveSamples`, `waveGrowth`, оценка одной Wave, `usedNowText`, `duration` и ответ `autopilot.estimate`. Чистые функции. |
| `src/shared/autopilot/budget.ts` | Budget и его решение перед Wave, слова остановки по budget. Чистые функции. |
| `src/main/autopilot/run.ts` | Run: режим, заданный на старте, проверка на границе Wave, ожидания, строка `forecast` и `actual`. |
| `src/main/autopilot/chat-confirm.ts` | Диалог `autopilot_start`: строки прогноза и по кнопке старта на режим. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | Tooltip кнопки **Autopilot**: режим, прогноз и совет. |
| `src/shared/ipc/autopilot.ts` | `autopilotStatusLine`: строки состояния ожиданий. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `src/shared/settings/app-settings.ts` | `autopilotRun` и `autopilotBudget` со значениями по умолчанию. |
| `src/shared/agent/plan-preset.ts` | Preset Pro, который включает budget. |

#### Поток данных

1. Кнопка **Autopilot** спрашивает main `autopilot.estimate`, когда появляется, и при каждой смене состояния Run-а. Main
   читает самые новые Journal-ы Run-ов Project-а и отвечает выборками и длительностью Wave. Tooltip считает по ним и по
   Ticket-ам рамки прогноз, а строки — по живым Limits и Settings.
2. `autopilot_start` читает в main те же Journal-ы, Limits и Settings и кладёт `dialogLines` в диалог. Нажатая кнопка
   передаёт свой режим в старт.
3. Старт задаёт режим Run-а, пишет с ним `run-started`, затем строку `forecast`, затем берёт keep-awake.
4. Перед каждой Wave `sendWave` спрашивает usage, затем проверяет границу по режиму. Ожидание пишет `start-window` или
   `budget-stop` и `waiting-until` и ставит тот же шаг снова на своё время, после `resumed`.
5. Каждая `wave-finished` прибавляется к `actual`, и `run-stopped` его несёт.

#### Test-ы

Эти test-ы не вызывают модель, Limits в них — stub-ы. Время идёт от часов, которые задаёт test, с постоянной time zone
для дней перевода часов.

| Test | Что проверяет |
|---|---|
| `test/unit/autopilot-run-mode.test.ts` | Режимы, окно через полночь и внутри дня, дни перевода часов, `windowDecision`. |
| `test/unit/autopilot-wave-duration.test.ts` | Выборки длительности и их p90. |
| `test/unit/autopilot-forecast.test.ts` | Выборки, `percentile`, оставшиеся Wave, диапазон bootstrap. |
| `test/unit/autopilot-forecast-lines.test.ts` | K, строку прогноза, рекомендацию, предупреждение, строки окна и режима, строки диалога. |
| `test/unit/autopilot-budget.test.ts` | Budget и его решение. |
| `test/unit/autopilot-limits-estimate.test.ts` | Оценку одной Wave. |
| `test/unit/autopilot-run.test.ts` | Строку `forecast` на старте и `actual` в конце. |
| `test/unit/canvas-actions.test.tsx` | Прогноз в tooltip кнопки и строки состояния окна. |
| `test/unit/settings-autopilot.test.tsx` | Settings → Autopilot. |
| `test/contract/autopilot-limits.test.ts` | Ожидания budget и Start window, `window-too-short`, окно на 5 часов и его отсутствие, с часами, которые двигает test. |
| `test/contract/autopilot-start-tool.test.ts` | Кнопки режимов в диалоге и его строки прогноза. |
| `test/e2e/autopilot.spec.ts` | Собранное приложение: ожидание вне Start window и Stop во время него, прогноз в tooltip в каждом режиме. |
