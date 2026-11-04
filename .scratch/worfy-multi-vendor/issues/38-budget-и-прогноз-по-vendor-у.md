# 38 — Budget, прогноз и остановка по Limits Vendor-а

Type: task
Status: done 2026-11-04T07:01Z
PR: #1336
Blocked by: 37
Source: [spec.md](../spec.md), «Решено без владельца», п. 4, «Риски», п. 5 и 6; решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); Ticket 03 ([03-codex-limits.md](03-codex-limits.md), «Когда лимит кончился», «Хватит ли данных»); [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md)

## Что происходит

- Budget — по окну `seven_day` (`src/shared/autopilot/budget.ts:172-181`); оценка Wave и прогноз Epic-а — рост
  `seven_day` (`limits-estimate.ts:26-32`, `:129`; `forecast.ts`); ожидание сброса — `resume-at.ts`,
  `src/main/autopilot/limits-wait.ts`; строка `limits` Journal — `{five_hour, seven_day}` (`journal.ts:351`).

## Что делаем

1. Budget и прогноз берут окна Vendor-а Orchestrator-а Run (поле `vendor` из Ticket-а 37). Claude — как сейчас.
   Codex — самое длинное из пришедших окон; калибровка — процент за Wave; до 5 выборок — «мало данных», и строки
   прогноза Codex помечены широкой неопределённостью.
2. `usageLimitExceeded` Codex: окно на 100 % с `resetsAt` — Wait `limits` до сброса и повторный
   `account/rateLimits/read`, как у Claude; без такого окна — остановка Run с новой причиной `vendor-quota` и текстом
   ошибки, без ожидания.
3. Journal: строка `limits` Run-а на Codex — `{windows: LimitWindow[]}`; старые строки читаются как раньше
   (Flight Recorder и `limits-estimate` понимают оба вида).

Глубина review — `high` (budget и остановка Run).

## Готово, когда

- [ ] Unit test budget и прогноза Codex: одно недельное окно (Pro), два окна (Plus); выборки по Wave.
- [ ] Unit test: `usage-limit-window` — ожидание до `resetsAt`; `usage-limit-quota` — остановка `vendor-quota`.
- [ ] Unit test Journal: старая строка `limits` и новая читаются; test-ы Claude без правок ожиданий.
- [ ] Все unit и contract test-ы модуля Autopilot, `pnpm typecheck`, `pnpm lint` — exit 0.

## Где в коде

- `src/shared/autopilot/budget.ts` — `:101`, `:172-181`
- `src/shared/autopilot/resume-at.ts`, `limits-estimate.ts`, `forecast.ts`, `journal.ts` — `:143`, `:351`, `:479`
- `src/main/autopilot/run.ts`, `src/main/autopilot/limits-wait.ts`
- Test-ы: `test/unit/autopilot-budget.test.ts`, `test/unit/autopilot-resume-at.test.ts`,
  `test/unit/autopilot-limits-estimate.test.ts`, `test/contract/autopilot-limits.test.ts`

## Итог

- Какое окно читает Run — новый `src/shared/autopilot/budget-window.ts`. У Claude (Limits — хранимое состояние) окно
  budget — `seven_day`, окно времени — `five_hour`, как было. У другого Vendor-а (Codex) окна приходят списком
  `LimitWindow`: окно budget — самое длинное из пришедших (Pro — одно недельное `primary`, Plus — недельное `secondary`),
  остальные — окна времени на месте `five_hour`. Доля — `usedPercent / 100`. Vendor Run-а — поле `vendor` строки
  `run-started` (Ticket 37), в `run.ts` — `run.vendor`.
- Budget (`budget.ts`): `budgetDecision` получает необязательное `vendor` (окна Vendor-а Run-а); полное окно времени
  (100 % или `reached`) с ещё не прошедшим сбросом держит Wave причиной `five-hour` до самого позднего сброса таких окон.
  `weekReadings` берёт числа только Wave-строк того же Vendor-а.
- Оценка Wave и прогноз (`limits-estimate.ts`, `forecast-lines.ts`): выборки — рост окна budget за Wave на Ticket, только
  из строк Run-ов того же Vendor-а; окно должно быть тем же (`id`) на обоих концах Wave. Оценке Codex нужно 5 Wave
  (`VENDOR_ESTIMATE_MIN_WAVES`), Claude — 3, как было; диапазон прогноза — от 5 выборок у обоих (`FORECAST_MIN_SAMPLES`).
  `forecastLine` у Vendor-а не Claude после диапазона говорит `WIDE_RANGE_TEXT` («The range is wide: this Vendor reports
  its Limits in whole percents only»); «Used now» — по самому длинному окну. `fitBeforeReset` и `dialogLines` принимают
  то же `vendor`. В `run.ts` по Vendor-у Run-а считаются budget, строка `forecast` (выборки, `fit`, `week`) и `actual`.
- Journal (`journal.ts`): `limits` Wave-строки Run-а на Codex — `{windows: [...]}`, каждое окно — поля `LimitWindow` с
  временами в ISO (`journalVendorLimits`; число вне формата пишется как неизвестное, окно без `id` пропускается — иначе
  `formatJournalLine` бросил бы и Wave-строка потерялась бы; время вне дат годов 0–9999, например `resetsAt` 1e13,
  пишется как неизвестное, окно без записываемого `receivedAt` пропускается). Старый вид `{five_hour, seven_day}` читается
  и пишется как раньше. Перед Wave-строкой окна Vendor-а читаются заново, когда их нет или старшее старше 5 минут:
  `AutopilotDeps.usage.refresh(age, vendor)` → `LimitsRefresher.refreshIfOlder(age, vendor)` (`limits-usage.ts`) — один
  poll этого Vendor-а тем же путём, что и фоновый, без второго одновременного poll-а; возраст 0 — poll в любом случае.
- `usageLimitExceeded` Codex: `limit_reached` с `reason: 'quota'` даёт `SessionLimitsStatus.quota` (`src/main/agent/limits.ts`,
  только у quota — статусы Claude те же), `LimitsWait.hitOf` — hit с `quota`, `resumeAt` — план `quota`, и Run сразу
  останавливается с новой причиной `vendor-quota` (`cycle.ts`), текстом ошибки Codex в `message` состояния и в строке
  `limits-hit` (`reason: 'quota'`, `message`), без `waiting-until`. С окном на 100 % и `resetsAt` — Wait `limits` до сброса
  плюс 2 минуты, как у Claude; когда время пришло, окна читаются заново (`stillUsedUp`): окно всё ещё исчерпано —
  ещё одно ожидание до его сброса (дальше 24 часов от начала ожидания — остановка `limits-timeout`), иначе Orchestrator
  получает продолжение. Это чтение идёт наперегонки с Force stop (`run.rushing`), а после него шаг ничего не отправляет,
  если пришли Force stop или выход из приложения. Отказ, при котором ни одно окно Codex не известно и прочитать их не
  удалось, — не quota: это окно без времени сброса, Run проверяет каждые 30 минут (`codexLimitReachedEvent`, сценарий
  фейка `usage-limit-no-windows`). Run на Claude окна заново не читает.
- Tooltip кнопки Autopilot и диалог `autopilot_start`: Vendor Project-а — `Orchestrators.runsOn` (Vendor открытого
  Orchestrator-а, иначе Vendor Project-а по умолчанию). `autopilot.estimate` отдаёт `vendor`, когда это не Claude, и
  считает выборки и `sevenDay` по нему; renderer берёт живые окна этого Vendor-а из `useLimits().vendors` и передаёт их в
  `forecastLine` и `fitBeforeReset`; диалог — то же через `ForecastSources.vendor`. У Claude ответ и строки прежние.
- Flight Recorder: `limits` Wave-строк он не читает, оба вида читаются одинаково (test); `limits-hit` с `quota` не
  открывает Wait ни в `from-journal.ts`, ни в `journal-walk.mjs`; `vendor-quota` — исход `failed`.
- Пункт из ревью #1330: `gateQueueTurn` перед ходом «Process gate queue» спрашивает Vendor так же, как `waveRefused`
  перед каждой Wave (общий `vendorRefusal`); отказ — `session-error` с текстом отказа, Run остановлен с `session-error`,
  строки `gate-queue` нет.
- Test-ы: `test/unit/autopilot-vendor-limits.test.ts` (окно budget Pro и Plus; budget Codex: доля дня по числам Codex,
  числа Claude не считаются, `five-hour` по 5-часовому окну Plus, Pro без окна времени; выборки по Wave, смена окна между
  концами Wave, 5 Wave для оценки; прогноз и строка прогноза с пометкой; `fit` по окну Codex; оба вида `limits` в Journal;
  `limits-hit` с `quota`; `usage-limit-window` — ожидание до `resetsAt`, `usage-limit-quota` — план `quota`; повторное
  чтение после ожидания). `test/contract/codex-orchestrator.test.ts` на фейке: ожидание по `usage-limit-window`,
  повторное чтение и второе ожидание, `{windows}` в `wave-started`, budget Codex держит Wave 1 по 5-часовому окну и
  `week` строки `forecast` — недельное окно, остановка `vendor-quota` по `usage-limit-quota`, отказ hook-ов перед gate
  queue и gate queue при подтверждённых hook-ах. `test/unit/flight-recorder-journal.test.ts`: Run на Codex и `vendor-quota`.
  Ожидания test-ов Claude не менялись; в списке исходов причин остановки добавлена `vendor-quota`.
  Второй раунд: контракт на фейке с прошлыми Wave Codex и Claude в `runs` (`need` в `budget-stop`, `samples` и `fit` в
  `forecast` — по Codex), `actual` в `run-stopped` по недельному окну Codex, второе ожидание дальше 24 часов —
  `limits-timeout`, Force stop во время чтения окон после ожидания (нет `resumed`, нет нового prompt-а), отказ без окон
  при неудачном чтении — ожидание, а не `vendor-quota`; Run на Claude после ожидания не просит usage с возрастом 0;
  `autopilot.estimate` на Codex (`test/contract/autopilot.test.ts`); строки диалога на Codex
  (`test/contract/autopilot-start-tool.test.ts`); tooltip на Codex и его обновление по `limits.changed`
  (`test/unit/canvas-actions.test.tsx`); `refreshIfOlder` с Vendor-ом (`test/unit/limits-usage.test.ts`); фильтр окон
  по Vendor-у в строке Journal, самый поздний сброс из двух полных окон времени, пропуск окна со сбросом в прошлом,
  повтор статуса с quota, времена вне диапазона дат. Снимки tooltip-а на Codex в обеих темах — в e2e
  `test/e2e/autopilot.spec.ts`, копии в `.scratch/worfy-multi-vendor/evidence/38/`.
- `docs/features/autopilot.md`: ожидание и остановка на Codex, budget на Codex, `vendor-quota`, оба вида `limits`,
  проверка hook-ов перед gate queue; tooltip и диалог на Codex; где текст `vendor-quota`; `fit`, `week`, `samples` и
  `actual` на Codex. `docs/features/run-planning.md`: budget на Codex считается по самому длинному окну Codex.

Решено без владельца, подтвердить:

1. Вид окна в Journal — все поля `LimitWindow` (вместе с `label`, `state`, `source`), времена — ISO, как все времена Journal.
2. Окно неизвестной длины становится окном budget, только если длины нет ни у одного окна; из равных — первое.
3. Полное короткое окно Codex останавливает Wave причиной `five-hour` и тем же текстом «The 5-hour Limits are used…»:
   у Plus это и есть 5-часовое окно; новой причины для окна другой длины нет.
4. Оценке Wave на Codex нужно 5 выборок, а не 3, как у Claude («до 5 выборок — мало данных»).
5. Пометка широкой неопределённости — фраза в строке прогноза после диапазона; при «мало данных» её нет (диапазона нет).
6. После ожидания решают только окна свежего чтения (`ordinaryUsageAllowed` не читается: `LimitsPart.read` его не отдаёт);
   чтение не удалось — Orchestrator получает продолжение, и следующий отказ покажет, что окно ещё закрыто.
7. Текст ошибки `vendor-quota` — в `message` состояния Run и в `limits-hit`; в `run-stopped` поля для него нет.
8. Отказ Codex, когда окна не известны и прочитать их не удалось, — ожидание с проверкой каждые 30 минут (не больше
   24 часов), а не `vendor-quota`: quota — только когда Codex сообщил окна и ни одно не исчерпано.
9. Окна Vendor-а Run заново читает через `LimitsRefresher.refreshIfOlder(age, vendor)` (тот же poll, что фоновый), а не
   отдельным чтением драйвера: два poll-а одного Vendor-а не идут одновременно.
10. Vendor для tooltip-а и диалога — Vendor, на котором Orchestrator Project-а пошёл бы сейчас (`Orchestrators.runsOn`);
    Vendor-а Claude ответ `autopilot.estimate` не называет, чтобы ответ Claude остался прежним.

Не сделано в этом Ticket-е: ничего из «Готово, когда» не осталось.
