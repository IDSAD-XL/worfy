# 11 — Прогноз и факт в Run history

Type: task
Status: done 2026-11-01T17:16Z
PR: #1225
Branch: worfy-resource-planner/11
Blocked by: 08, 10
Source: [spec.md](../spec.md), «Цель», п. 4, «Решения» (Q10), «Что видит пользователь» (Run history), «Волны» (Wave 6); spec Epic-а `worfy-flight-recorder` ([spec.md](../../worfy-flight-recorder/spec.md), «Экран», п. 1 — шапка Run)

## Что происходит

- В `main` (после Ticket-а 08 и Ticket-ов 17–20 Epic-а `worfy-flight-recorder`) есть экран Run history:
  `src/renderer/flight-recorder/RunHistoryView.tsx`, `test/unit/flight-recorder-view.test.tsx`,
  `test/e2e/flight-recorder.spec.ts`.
- Шапка Run по spec Flight Recorder: Epic, начало → конец, длительность, причина остановки, Wave-ы, счёт Ticket-ов,
  повторы, кто начал Run. «Кто начал» (`by`) приходит в элементе списка Run-ов: сервис
  `src/main/flight-recorder/service.ts` (`list`) → канал `runs.list`, схема zod `runListItemSchema` в
  `src/shared/ipc/runs.ts`.
- Разбор Journal (`src/shared/flight-recorder/from-journal.ts`, `JournalFacts`) уже отдаёт `mode`, `forecast` и
  `actual`, но до экрана они не доходят: в `runListItemSchema` их нет.
- Wait `start-window` уже на дорожке Wait со словом `Start window` (`WAIT_WORDS` в
  `src/renderer/flight-recorder/span-words.ts` и `SummaryStrip.tsx`).
- Страница `docs/features/run-planning.md` есть (Ticket 10); страница `docs/features/flight-recorder.md` — после
  Ticket-а 24 Flight Recorder (#1223).
- `STARTED_BY.tool` в `RunHistoryView.tsx` говорит «the Orchestrator (autopilot_start)», но `autopilot_start` может
  вызвать любая Session с инструментами worfy-canvas (spec, «Инструмент autopilot_start»).

## Что делаем

1. Шапка Run в Run history: режим Run (`Fastest`, `Budget-aware`, `Start window`) и
   `Forecast 18–31% · actual 24%`; без диапазона — `Forecast: not enough data · actual 24%`; без факта —
   `… · actual: unknown` (и при `counted = 0`: ни одна Wave не дала выборку); Run до этого Epic-а (нет `forecast`) — ни того, ни другого. `counted < waves` — tooltip
   `Actual counts 3 of 4 Waves: the week reset inside one` (или сколько их).
2. Поля доходят до экрана тем путём, которым шапка уже получает `by` (сервис и IPC `runs` Ticket-а 17 Epic-а
   `worfy-flight-recorder`); новых каналов нет.
3. Абзац о сравнении — в `docs/features/run-planning.md` (Behaviour).

## Готово, когда

- [x] Unit test вида (`test/unit/flight-recorder-view.test.tsx`, его создаёт Ticket 18 Flight Recorder): шапка Run с
      `forecast` и `actual` — режим и `Forecast 18–31% · actual 24%`; без `forecast` — строки нет; `counted = 0` — `actual: unknown`; `counted < waves` —
      tooltip.
- [x] e2e (`test/e2e/flight-recorder.spec.ts`, fixture Journal-а с `forecast` и `run-stopped.actual` через
      `WORFY_DATA_DIR`): шапка показывает прогноз и факт; Wait `start-window` виден на дорожке Wait с причиной словом.
- [x] Снимки обеих тем в `.scratch/worfy-resource-planner/evidence/11/`.
- [x] Test-ы краснеют на mutant-ах: факт показывается при `counted = 0`; диапазон без `high`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Unit `test/unit/flight-recorder-view.test.tsx` (Ticket 18 Flight Recorder).
- e2e `test/e2e/flight-recorder.spec.ts` (Ticket 18 Flight Recorder).
- Сначала падающий: unit test шапки с `forecast`.
- Прогнать все `test/unit/flight-recorder-*.test.ts`.

## Где в коде

- `src/renderer/flight-recorder/RunHistoryView.tsx` (создаёт Ticket 18 Flight Recorder) — шапка Run
- `docs/features/run-planning.md` (Ticket 10)
- `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts` (создаёт Ticket 18 Flight Recorder)

- `src/shared/ipc/runs.ts`, `src/main/flight-recorder/service.ts` — поля `mode`, `forecast`, `actual` элемента
  `runs.list` (бриф Orchestrator-а разрешил правку)
- `docs/features/flight-recorder.md`, `docs/features/ru/flight-recorder.md` — шапка и подпись `Start window`
  (после merge #1223, по брифу Orchestrator-а)

Только читать: `src/shared/flight-recorder/from-journal.ts` (`JournalFacts`, Ticket 08).

## Итог

- Поля дошли до экрана тем же путём, что `by`: `runListItemSchema` (`src/shared/ipc/runs.ts`) получил `mode`
  (`RUN_MODES` или `null`), `forecast` (`{ low, high }` первой строки `forecast` или `null`) и `actual`
  (`run-stopped.actual` или `null`); `FlightRecorder.list` (`src/main/flight-recorder/service.ts`) берёт их из
  `JournalFacts`. Новых каналов нет. Run, который останавливается на экране, получает `actual` со списком, который
  store и так перечитывает на остановке. `fit` не передаётся и не показывается.
- Шапка (`RunHistoryView.tsx`): `Mode <имя режима>` из `RUN_MODE_LABELS` и `Forecast 18–31% · actual 24%`. Без
  диапазона (хоть один край `null`) — `Forecast: not enough data`; без `actual`, а также при `counted = 0` —
  `actual: unknown`; при `counted < waves` — tooltip. Run без строки `forecast` не показывает ни прогноз, ни факт;
  без `mode` — ни режима. Проценты целые, из целых миллионных долей (0.285 — 29 %, а не 28 из плавающей точки); диапазон
  словами строки прогноза: `about 18%`, `less than 1%`; факт меньше 1 % — `less than 1%`.
- `STARTED_BY.tool` — `a Session (autopilot_start)`: имени Session в элементе списка нет. Unit test закрепляет текст.
- Документация: абзац «The forecast and the actual share in Run history» и строки таблиц в
  `docs/features/run-planning.md`; в `docs/features/flight-recorder.md` и `ru/flight-recorder.md` — пункт шапки с
  режимом и прогнозом, `a Session (autopilot_start)` вместо старой подписи, `Start window` в подписях дорожки Waits с
  причиной в tooltip (`outside, until <time>` или `wave-too-long, until <time>`).
- Решено без владельца, подтверждено владельцем 2026-11-01:
  1. Текст tooltip-а — `Actual counts 3 of 4 Waves: a Wave counts only with fresh Limits at both ends and no week reset
     inside it`, а не «the week reset inside one» из Ticket-а: Wave без выборки бывает и из-за старого числа Limits
     (`waveGrowth`, `limits-estimate.ts`), не только из-за сброса недели.
  2. При `counted = 0` и законченных Wave tooltip тоже есть (`Actual counts 0 of 2 Waves: …`): он объясняет `unknown`.
  3. Режим показывается отдельно от прогноза: `Mode Start window` и т. п., когда `run-started.mode` есть.
- Test-ы: `test/unit/flight-recorder-view.test.tsx` — 8 новых (режим и строка; имена трёх режимов; Run без прогноза;
  `not enough data` при обоих и одном пустом крае; `actual: unknown` без `actual` и при `counted = 0`; tooltip при
  `counted < waves`; округление из миллионных, `about`, `less than 1%`; `a Session (autopilot_start)`);
  `test/contract/flight-recorder-run-by.test.ts` — `runs.list` отдаёт `mode`, диапазон и `actual`, старый Journal —
  `null`; `test/e2e/flight-recorder.spec.ts` — Run в режиме Start window: шапка `Mode Start window`,
  `Forecast 18–31% · actual 24%`, Wait `Start window` на дорожке Waits с причиной `start-window: outside` в tooltip.
  Сначала красные: 7 unit test-ов шапки. Фикстуры элемента списка дополнены новыми полями
  (`flight-recorder-detail.test.tsx`, `runs-ipc.test.ts`).
- Mutant-ы (все красные, `flight-recorder-view`): факт показывается при `counted = 0`; диапазон без проверки `high`
  (только `low === null`); проценты `Math.round(share * 100)` вместо миллионных.
- Снимки: [светлая](../evidence/11/forecast-and-actual-light.png), [тёмная](../evidence/11/forecast-and-actual-dark.png).
  Текст шапки — `--text` на `--bg`: контраст 15.7:1 (светлая) и 15.5:1 (тёмная).
- Ревью, раунд 1 (PR #1225):
  - Проценты в шапке Run history и в строках прогноза (`forecast-lines.ts`: tooltip кнопки Autopilot и диалог
    `autopilot_start`) округлялись по-разному: строки прогноза брали `Math.round(x * 100)` и печатали 0.145–0.285
    как «14–28%». Теперь одно правило в `src/shared/autopilot/share-percent.ts`: `shareUnits` (целые миллионные),
    `sharePercent` (половина вверх в целых числах: 0.145 → 15, 0.285 → 29, 0.005 → 1, 0.995 → 100), `shareRangeText`
    и `shareText`. Им пользуются `forecast-lines.ts` (свои `shareUnits` и `shareText` удалены) и `RunHistoryView.tsx`.
    Строка прогноза для 0.145–0.285 теперь «15–29%»; прежние test-ы строки прогноза не изменились.
  - Документация о режиме: режим виден всегда, когда `run-started` его называет, в том числе без строки `forecast`
    (Run между Ticket-ами 05 и 07 или неудачная запись прогноза); прогноз и факт — только при строке `forecast`.
    Поправлены `run-planning.md`, `flight-recorder.md`, `ru/flight-recorder.md`; unit test закрепляет режим без прогноза.
  - `until` в причине Wait (`start-window: outside, until …`, и у Wait Limits) показывается в местном времени тем же
    `formatLocal`, что Start и End: `reasonText` в `src/renderer/flight-recorder/span-words.ts`, им пользуются tooltip
    бара (`Timeline.tsx`) и поле Reason панели деталей (`DetailPanel.tsx`). Journal и span хранят ISO; фильтр ищет
    по исходной причине. Момент, который не разбирается, остаётся как есть.
  - Test-ы: `test/unit/autopilot-share-percent.test.ts` (края половины процента, слова диапазона и доли);
    `test/unit/autopilot-forecast-lines.test.ts` — «15–29%» и «1–100%»; `test/unit/flight-recorder-reason-words.test.tsx`
    — TZ `Europe/Kyiv` задан до импорта, день перевода часов 2026-10-25, Wait Limits, не-ISO и не-Wait;
    `test/unit/flight-recorder-view.test.tsx` — режим без прогноза; местное `until` в tooltip бара и в панели.
  - Mutant-ы (все 7 красные): `forecast-lines` с `Math.round(x * 100)`; `sharePercent` из плавающей точки;
    `sharePercent` с половиной вниз; режим скрыт без прогноза; `reasonText` отдаёт сырой ISO; tooltip бара берёт
    `span.reason`; панель берёт `span.reason`.
  - Шапка и видимые подписи не изменились (18–31 %, 24 %), снимки не переснимались.
  - Проверка раунда на ветке после rebase на `origin/main` 6e4819c6: все 7 mutant-ов снова красные;
    `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (565 файлов test-ов); `test/e2e/flight-recorder.spec.ts` под
    замком `/tmp/worfy-e2e.lock` — 2 passed; gate fast — green.
- Оценка автора: около 250 тысяч токенов (первый раунд) и около 120 тысяч (раунд 1 ревью).

Влит 08f94f63 (#1225).
