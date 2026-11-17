# 121 — e2e test-ы, зависящие от даты: фиксированное время для `new-product-session` и `limits-vendors`, обход `test/e2e`

Type: task
Status: done 2026-11-17T02:26Z
PR: #1939
Blocked by: none
Source: решение владельца 2026-11-17; `worfy-throughput` 66, «Итог», часть 5, эпизоды 3 и 7: два e2e test-а,
зависящих от даты, сделали `main` красным без изменения кода и остановили merge PR с кодом на 1 551 min в окне
2026-11-09…16 (134 min и 1 417 min). Тот же «Итог» называет их частой причиной красного `main` этой недели.

Кто: агент.

## Что происходит

Оба test-а уже починены «вперёд», но не фиксированным временем, а временем от часов машины:

- **`new-product-session`.** Polish 97 (#1778): fixture клал transcript с фиксированным `timestamp:
  '2026-11-09T08:00:00.000Z'`; через 24 h автоархив (ADR-0076) убрал Session Node `product-1` с Canvas, и
  `test/e2e/new-product-session.spec.ts:93` упал на всех ОС. Сейчас время записей transcript-а — минута назад от
  часов машины: `test/e2e/new-product-session.spec.ts:97` (`new Date(Date.now() - 60_000)`), записи — `:98–99`.
  Правило, которое читает это время: `src/main/layout/archive.ts:153–157` (`idleSessions`, простой от последней
  записи, если у Node нет свежего `touchedAt`), порог по умолчанию 24 h (`src/shared/settings/app-settings.ts:164`, `src/main/layout/archive.ts:72`).
- **`limits-vendors`.** #1855: сброс 7-дневного окна «через 72 h» давал на разных днях разное имя дня недели, и
  секция становилась шире предела (тогда 112 px, секция 112,34 px; сейчас предел `SECTION_MAX = 115`,
  `test/e2e/limits-vendors.spec.ts:150`, проверка — `:202` в test-е `:152`). Сейчас сброс — ближайшая
  среда от часов машины: `test/e2e/limits-vendors.spec.ts:61–62` (`receivedAt`, `inHours` от `Date.now()`), `:68–69`
  (цикл до `getDay() === 3`), данные — `:70–77` (`limits.json`). Имя дня недели пишет
  `src/shared/agent/limits.ts:380–384` (`resetsLine`), «устаревшие» данные — `:387–391` (`asOfLine`).

Какие механизмы подмены часов уже есть в проекте:

- **Playwright clock окна** (`window.clock.install`): `test/e2e/autopilot.spec.ts:435`,
  `test/e2e/session-view.spec.ts:404`. Подменяет часы только renderer-а, не main процесса Electron.
- **Подмена `Date.now` в main через `app.evaluate`**: `test/e2e/pr-inbox-digest.spec.ts:166–169`. Доходит только до
  кода, который зовёт `Date.now()` в момент работы. До `new Date()` без аргументов не доходит, и до автоархива тоже не
  доходит: он берёт функцию при создании (`src/main/index.ts:300`, `now: Date.now`) и запускается на первом чтении
  Layout-а, то есть на старте.
- **`now` в конструкторе** для unit- и contract-test-ов: `src/main/agent/limits.ts:65` и `:100` (`now?: () => number`,
  по умолчанию `Date.now`), `deps.now()` автоархива (`src/main/layout/archive.ts:269`).
- Переменной окружения, которая задаёт часы main процесса в e2e, нет: среди `process.env.WORFY_*` в `src/main` такой
  нет. `WORFY_ARCHIVE_TICK_MS` (`src/main/layout/archive.ts:90–93`) только ускоряет timer автоархива.

### Обход `test/e2e` (2026-11-17, `main` на f27a868e7, чтение кода; ни один e2e не запускался)

Найдено, что может покраснеть без изменения кода. Это факты для решения, не исправления.

- `test/e2e/work-track.spec.ts:281–284` — у месяца «Earlier» ожидается разрыв «no data». stub test-а даёт его, только
  если начало прошлого календарного месяца раньше «сегодня − 30 дней» (`:117`, `:198`, строгое `<`); период Month —
  календарный месяц (`src/renderer/work-track/store.ts:57`). По чтению кода: красный 1 мая, 1 июля, 1 октября,
  1 декабря и 1–3 марта (1–2 марта в високосный год).
- `test/e2e/work-track.spec.ts:276–277` — у текущего месяца ждёт ячейку дня Orchestrator-а; день без работы ячейки не
  даёт (`src/renderer/work-track/store.ts:195–196`). По чтению кода: красный 1-го числа до первого «хода» stub-а за
  день (около 08:00–10:00 местного времени). Не проверено.
- `test/e2e/autopilot.spec.ts:762` и `:791` — окно Start window начинается через 2 h от текущего часа, ожидается
  «resumes HH:00»; `src/shared/autopilot/run-mode.ts:60–68` (`nextHour`, `setHours`). Возможен расход в ночь перевода
  часов на летнее время. Не проверено.
- `test/e2e/epic-columns.spec.ts:180` — «вчера» как `Date.now()` − 24 h, приложение сравнивает календарные дни
  (`src/renderer/canvas/arrangement-record.ts:204`, `src/renderer/canvas/epic-arrangement.ts:184`). В день перевода
  часов на зимнее время между 23:00 и 24:00 это всё ещё «сегодня». Не проверено.
- `test/e2e/pr-inbox-digest.spec.ts:166–169` — часы main сдвигаются на +24 h ради «следующего дня»; digest сравнивает
  календарные дни (`src/main/github/inbox-digest.ts:79`, `:114–116`). Тот же риск в ночь перевода часов на зимнее
  время. Не проверено.
- Около полуночи по местному времени (риск низкий): `test/e2e/epic-columns.spec.ts:189`, `:208`, `:251`,
  `test/e2e/zoom-whole-nodes.spec.ts:129`, `test/e2e/done-shelf.spec.ts:94` (запись раскладки «сегодня» из
  `new Date()`), `test/e2e/autopilot.spec.ts:677–678` (дневной бюджет, `src/shared/autopilot/budget.ts:58–62`).
- Ширина зависит от дня недели (та же причина, что у `limits-vendors`): `test/e2e/codex-hooks-step.spec.ts:183`
  (сброс `inHours(72)`), `test/e2e/toolbar.spec.ts:45` и `:192` (сброс через 3 дня). Запас по ширине не измерен.
- `test/e2e/flight-recorder.spec.ts:333` (и `flight-recorder-detail.spec.ts`) — fixture с фиксированными датами
  октября 2026; приложение показывает «gate logs deleted» для Run-а старше 31 дня (`src/main/flight-recorder/gate-logs.ts:28`,
  `:108`). Комментарий test-а у `:333` говорит, что строки появятся с 2026-11-18; test их не проверяет, но проверки
  наложения подписей и число строк пройдут по новым строкам. Не проверено.
- Без риска, с причиной:
  - fixture-ы с фиксированными датами Session (`family`, `arrange-by-epic`, `binding`, `browser-family`) ставят
    `sessionArchive: { after: 'never' }`; остальные (`session-back`, `toast-placement`, `session-picker`,
    `session-history-tail`, `node-kinds`, `zoom-whole-nodes`, `subagent-tree`, `minimap-kinds`, `new-session`,
    `external-session`, `checks-badges`, `session-view`, `orchestrator`) не кладут в Layout Session Node, который
    правило автоархива возьмёт; их даты уже старше всех порогов (24 h, 7 и 30 дней) — дальше ничего не меняется
    (тот же вывод — «Итог» polish 97);
  - даты статусов Epic-ов в sidebar (`pipeline`, `epic-columns`, `epic-frame`, `getting-started-*`, `many-epics.ts`):
    группа «Older» — пороги 3, 7 и 30 дней (`src/renderer/shell/sidebar/epics-order.ts:18`, `:77–78`); все
    уже по одну сторону порога;
  - `test/e2e/session-view.spec.ts:404` — часы окна на 23:59, `:418` ждёт `23:59`: риск скорости (больше 60 s реального
    времени), не даты.

Обход сделан агентом-поиском и частично перепроверен (строки выше перечитаны); пункты с пометкой «Не проверено» —
вывод по чтению кода.

## Что делаем

1. **Фиксированная дата для двух test-ов.** `new-product-session` и `limits-vendors` получают фиксированный момент
   времени, одинаковый для fixture-а, main процесса и renderer-а. Механизм — существующий, если он дотягивается:
   Playwright clock окна для renderer-а, `now` main процесса. Сейчас часов main процесса в e2e задать нельзя (см.
   выше), поэтому нужен один источник «сейчас» для main, который e2e может задать до старта (например, переменная
   окружения, читаемая одной функцией, которую получают `AutoArchiver` в `src/main/index.ts:300` и Limits). Выбор —
   за implementer-ом; новый механизм — одна функция, без второго пути.
2. **Фиксированная дата выбирается «неудобной»:** для `limits-vendors` — день, у которого самое широкое имя дня
   недели сброса (`Wed`); для `new-product-session` — время записей transcript-а моложе порога автоархива
   относительно этой фиксированной даты.
3. **Обход.** Для каждого пункта списка выше с риском «real» — либо фиксированная дата тем же механизмом, либо
   строка в «Итог» с причиной, почему пункт оставлен (риск низкий, исправление дороже, отдельный Ticket).

## Готово, когда

- [ ] Оба test-а берут время из фиксированной даты, а не из часов машины: в `new-product-session.spec.ts` и
      `limits-vendors.spec.ts` нет `Date.now()` и `new Date()` без аргументов для данных fixture-а.
  - evidence: commit pass · Pin the date of date-dependent e2e tests: main's clock from WORFY_NOW (worfy-polish 121) · - - · 00b7ab38f
- [ ] Unit- или contract-test источника «сейчас» main процесса: заданное значение доходит до автоархива и до Limits;
      без него — часы машины. Сначала красный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/main-clock.test.ts test/unit/codex-limits.test.ts` exit 0 (main-clock red first: no module, then this.deps.now is not a function) · mac - · 00b7ab38f
- [ ] Оба test-а зелёные при часах машины, сдвинутых вперёд, — без локального e2e (локальный e2e запрещён): CI run с
      шагом, который сдвигает часы runner-а вперёд (например, на 8 дней и на пятницу UTC) перед
      `pnpm test:e2e test/e2e/new-product-session.spec.ts test/e2e/limits-vendors.spec.ts`; run — в Evidence.
      Если сдвинуть часы runner-а нельзя — unit-test из пункта выше с датой «через 8 дней» и обычный CI e2e, и строка
      в «Итог», почему.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/43986230457 (clock-shift-121, macOS, runner clock moved to 2026-11-27 10:00 UTC and 2026-12-01 10:00 UTC, 16 passed each) · ci dev · 87c46a09a
- [ ] CI e2e (`macos-e2e`, `windows-e2e`) зелёный на PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/43987987519/job/133730778008 · ci - · 3930e29c5fb7151320d567989836b8c623c0bdf1
- [ ] В `test/e2e` не осталось e2e, зависящих от даты с риском «real» из обхода выше, или каждый назван в «Итог» с
      причиной.
  - evidence: commit pass · Pin the date of date-dependent e2e tests: main's clock from WORFY_NOW (worfy-polish 121) · - - · 00b7ab38f
- [ ] Все unit- и contract-test-ы затронутых модулей зелёные (`test/contract/ci-workflow.test.ts`, test-ы
      `src/main/layout/archive.ts` и `src/main/agent/limits.ts`); gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · c4c116e16
  - evidence: gate pass · `gate fast` exit 0 · mac - · c4c116e16

## Где в коде

- `test/e2e/new-product-session.spec.ts`
- `test/e2e/limits-vendors.spec.ts`
- `test/e2e/helpers.ts` (запуск Electron, окружение)
- `src/main/index.ts` (`:300`, `now` автоархива; создание Limits)
- `src/main/layout/archive.ts`, `src/main/agent/limits.ts` (только если меняется способ получить `now`)
- новый файл источника «сейчас» main процесса, если он нужен, и его unit-test в `test/unit/`
- `.github/workflows/ci.yml` — только временно, ради run-а со сдвинутыми часами; в PR не остаётся
- e2e из обхода, если они чинятся тем же механизмом: `test/e2e/work-track.spec.ts`, `test/e2e/codex-hooks-step.spec.ts`,
  `test/e2e/toolbar.spec.ts`, `test/e2e/epic-columns.spec.ts`, `test/e2e/autopilot.spec.ts`,
  `test/e2e/pr-inbox-digest.spec.ts`, `test/e2e/flight-recorder.spec.ts`

## Вне скоупа

- Порог автоархива, правила Limits и вид секции — правила продукта не меняются.
- Quarantine для этих test-ов: исключение из правила красного `main` (ADR-0083, Amendment 2026-11-17) — для будущих
  эпизодов, не замена этого Ticket-а.

## Итог

- **Источник «сейчас» main — `src/main/clock.ts`.** `appNow()` — часы машины; в dev-запуске (распакованная сборка
  `out/`, которую запускают e2e; `app.isPackaged` ложно) с переменной `WORFY_NOW` (ISO-дата) — часы, которые
  стартуют с этого момента и идут дальше вместе с часами машины. Упакованный worfy.app переменную не читает (то же
  правило, что у `ELECTRON_RENDERER_URL`, `src/main/window.ts`); неверная дата останавливает старт с сообщением.
  `src/main/index.ts` ставит часы один раз сразу после `setBuildKind`. Без своих часов `appNow` берут: автоархив
  (`AutoArchiver`, `now` в `index.ts` убран), `LayoutStore` (`touchedAt` и `at` архива — второе время того же правила),
  `LimitsTracker`, `LimitsRefresher`, Codex poll (`codexLimitsPart`) и `FlightRecorder` (Run history). Остальной main
  (timer-ы, timeout-ы, время в UI) остаётся на `Date.now`: в e2e с `WORFY_NOW` эти два времени расходятся, это
  записано в комментарии модуля.
- **Окно** — Playwright clock: `pinWindowClock` в `test/e2e/helpers.ts` (`window.clock.install` и перезагрузка окна,
  как в `session-view.spec.ts`), чтобы первый кадр renderer-а уже читал эти часы.
- **`new-product-session`** — main на `WORFY_NOW` 2026-06-15 09:00Z, transcript на минуту старше. Окно не
  закреплено: ничего, что test проверяет, от часов окна не зависит.
- **`limits-vendors`** — main и окно на 2026-06-15 09:00Z, `limits.json` от того же момента, сброс 7-дневного окна —
  ближайшая среда (`wednesdayReset`, самое широкое имя дня). Codex-окна приходят из script-а fake с фиксированными
  сбросами, время их записи — `appNow`.
- **Обход, починено тем же механизмом:**
  - `work-track.spec.ts`, первый test (`:281–284` и `:276–277` обхода) — окно и stub `workTrack.read` на полудне
    17 июня 2026 по местному времени: у Month есть дни Orchestrator-а, у Month before — «no data».
  - `flight-recorder.spec.ts` (оба test-а ночного Run-а) и `flight-recorder-detail.spec.ts` — main на `WORFY_NOW`
    2026-11-10 12:00Z: gate ещё хранит логи ночного Run-а, строк «gate logs deleted» нет в любой день. test живого
    Run-а (`prepareLive`) не закреплён: его Journal пишется по часам машины.
  - `toolbar.spec.ts` (`staleLimits`, `freshLimits`) и `codex-hooks-step.spec.ts` — сброс 7-дневного окна в
    ближайшую среду не раньше чем через 72 h: ширина toolbar не меняется с днём недели. Цифры времени табличные
    (`LimitBar.tsx`), имя дня — единственное, что меняло ширину; момент данных остался от часов машины, поэтому
    `Date.now` в этих двух файлах остаётся.
- **Обход, оставлено, с причиной:**
  - `work-track.spec.ts`, второй и третий test-ы — «вчера» от часов машины и в stub-е, и в окне; Month третий test
    проверяет только отсутствие меток. Риск — только переход часов и полночь, ниже.
  - Переход на летнее/зимнее время (`autopilot.spec.ts:762`, `:791`; `epic-columns.spec.ts:180`;
    `pr-inbox-digest.spec.ts:166–169`) — runner-ы GitHub работают в UTC, где перехода нет (в log-е временного run-а —
    `date` с поясом); локально риск — один час в две ночи года. Исправление (часы main и окна в этих длинных
    test-ах) дороже риска.
  - Около полуночи (`epic-columns.spec.ts:189`, `:208`, `:251`, `zoom-whole-nodes.spec.ts:129`,
    `done-shelf.spec.ts:94`, `autopilot.spec.ts:677–678`) — риск низкий: секунды между записью fixture-а и проверкой
    должны пересечь полночь.
  - Без риска — как в обходе (`sessionArchive: never`, пороги «Older» в sidebar, `session-view.spec.ts:404`).
- **Проверка со сдвинутыми часами runner-а** — временный workflow `.github/workflows/clock-shift-121.yml` (отдельный
  файл, а не job в `ci.yml`: job в `ci.yml` обязан стоять в `needs` у `ci-ok` по `test/contract/ci-workflow.test.ts`;
  запуск по push в ветку, до PR) на macOS: `sudo date` на 2026-11-27 10:00 UTC (пятница, +10 дней) и на 2026-12-01
  10:00 UTC (1 декабря — красный день Month), затем семь spec-ов выше. Файл удалён из ветки до PR; run — в Evidence.
