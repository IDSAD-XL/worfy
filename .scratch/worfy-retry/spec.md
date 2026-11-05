# worfy-retry: Auto-continue — повтор хода после сбоя API и продолжение после Limits

Status: принят владельцем 2026-11-04 («Да, всё»): ответы Q1–Q9 — по рекомендации (Q8 (в), остальные (а)); 2026-11-05
владелец принял Q10–Q18 (меню Modes, Ticket-ы 12 и 13)
Source: слово владельца 2026-11-04: «насчет автоповтора после ошибок, нужен отдельный эпик. Так же как и автоповтор при
исчерпании 5 часового окна, это должно быть в виде переключателя в чате оркестратора, как эко мод.»; уточнение владельца
в тот же день: у его верхнего плана окна в 5 часов нет, у планов ниже — есть, продолжение после Limits должно
работать в обоих случаях; [worfy-faults](../worfy-faults/spec.md), Q3 (автоповтор — отдельный Epic) и «Не в этом
Epic-е»; [worfy-polish 50](../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md), «Что происходит»
(инцидент 2026-11-03); [worfy-daily 05](../worfy-daily/issues/05-ожидание-сброса-limits.md) (ожидание сброса Limits в
Run-е); [worfy-throughput 60](../worfy-throughput/issues/60-переключатель-eco-mode-в-чате-orchestrator-а.md)
(переключатель Eco mode — образец); [worfy-reliability](../worfy-reliability/spec.md) (resume без повтора внешних
действий); [CONTEXT.md](../../CONTEXT.md), термины Run, Wave, Journal, Orchestrator, Session, Limits, Eco mode, Vendor;
ADR [0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md), [0094](../../docs/adr/0094-vendor-seam.md).
Ticket-ы: Epic `worfy-retry`, 14 Ticket-ов, нумерация с `01` (12 и 13 добавлены 2026-11-05; 14 перенесён из worfy-faults
решением владельца 2026-11-05). Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:`,
как у worfy-faults.

**Старт Epic-а — после merge worfy-multi-vendor 38** (budget и прогноз по Vendor-у): он правит
`src/main/autopilot/run.ts`, `limits-wait.ts`, `src/shared/autopilot/resume-at.ts` и `journal.ts` — те же файлы, что
Ticket-ы 04 и 05 этого Epic-а. **Ticket 09 — после merge worfy-faults 01 и 02**: он дописывает их helper-модули.

## Цель

2026-11-03 16:06Z Run Autopilot-а (Epic `worfy-multi-vendor`, Wave 12) остановился с `run-stopped` reason `turn-error`
после `API Error: 500` в Session Orchestrator-а. Ошибка была временной: следующий ход той же Session прошёл бы. Run
стоял, пока владелец не вернулся, а потом его ещё и нельзя было запустить снова (worfy-polish 50, исправлено PR #1307).
Ночью такая остановка — потерянная ночь.

Сегодня:

- **Ход с ошибкой API** (500, 529 `overloaded_error`, обрыв связи) останавливает Run сразу: случай `turn-ended` с
  `isError` → `stop(state, 'turn-error', …)` (`src/shared/autopilot/cycle.ts:288`). Ручной ход Orchestrator-а вне Run-а
  просто кончается ошибкой в чате; дальше никто ничего не шлёт.
- **Отказ Limits** в Run-е уже не останавливает Run: он ждёт сброса окна и шлёт Orchestrator-у продолжение
  (worfy-daily 05; `LimitsWait`, `src/main/autopilot/limits-wait.ts:78`; `resumeAt`,
  `src/shared/autopilot/resume-at.ts`). Это всегда включено и только внутри Run-а. Ручной ход Orchestrator-а после
  отказа Limits стоит до человека. Ждать дольше 24 ч Run не умеет (`MAX_WAIT_MS`, `resume-at.ts:27`): упор в недельное
  окно с далёким сбросом останавливает Run с `limits-timeout`.
- **Окна у планов разные.** На планах ниже верхнего Claude Code сообщает окна `five_hour` и `seven_day`; на верхнем
  плане владельца окна `five_hour` нет, есть только `seven_day` или вообще ни одного окна с временем сброса.
  У Codex — свои `primary` и `secondary` (CONTEXT.md, Limits). Отсутствие окна — нормальное состояние, не ошибка.

Epic даёт одну настройку в чате Orchestrator-а: **Auto-continue** (рабочее имя, Q1) — пункт меню **Modes** рядом с Eco
mode и Auto-approval (Q10). Включён —
после временной ошибки API worfy сам шлёт Orchestrator-у продолжение с паузой, растущей от попытки к попытке; после
отказа Limits ждёт сброса того окна, которое сообщил Vendor (`five_hour`, `seven_day`, `primary`, `secondary`), а без
окна — проверяет по интервалу, и продолжает. Выключен — всё как сегодня, и test-ы worfy-faults «стоп на 500» остаются
верны.

## Что видит владелец

1. **Меню Modes** (Q10–Q13). Во второй строке поля ввода **только Orchestrator-а** — одна кнопка «Modes» вместо
   отдельных переключателей Eco mode и Auto-approval: в строке нет места для третьего (при 1280×800 с открытым sidebar
   остаётся около 30 px, а Send должен остаться на строке pickers). На кнопке — три иконки состояния, всегда все и в
   постоянной ширине: включённый режим — яркая, выключенный — приглушённая, Auto-approval Shadow — контур. Меню:
   Eco mode (on/off), Auto-approval (Off/Shadow/On), **Auto-continue** (on/off). Tooltip пункта Auto-continue:
   «Auto-continue: after a temporary API error (500, 529, connection lost) worfy sends the Orchestrator "continue" up to
   5 times with growing pauses; after the Limits refuse, it waits for the reset and continues. Never resends your
   message or the Wave command.» Перенос двух переключателей в меню — Ticket 12, пункт Auto-continue — Ticket 02.
   Окно Linked machine: до Ticket-а 13 все пункты недоступны, как сегодня оба переключателя (`elsewhere`,
   `src/renderer/session/composer/EcoMode.tsx:52`, `AutoApprove.tsx:85`); после него Full access меняет все три режима,
   Read only видит их и ничего не меняет (Q15–Q17).
2. **Состояния.** Off (как сегодня); On; On и ждёт — повтора после ошибки или сброса Limits. Пока ждёт, над полем
   ввода Orchestrator-а — строка с обратным отсчётом:
   - `API error 529 (overloaded) · retry 2 of 5 in 4:12` и кнопки `Retry now`, `Cancel`;
   - `Limits: 7-day window · resumes 14:20 (in 2:13:05)` и `Cancel`; без времени сброса —
     `Limits: no reset time reported · next try in 27:40`.
   Отсчёт идёт по секундам, время — местное. Сообщение, которое владелец сам отправил, отменяет ожидание: его ход и есть
   продолжение.
3. **Canvas.** Строка состояния Autopilot (`autopilotStatusLine`, `src/shared/ipc/autopilot.ts:215`) получает новый вид
   `API error · retry 2/5 · 14:20` рядом с существующим `waiting for limits · resumes 14:20`.
4. **Journal Run-а.** Новые строки (Ticket 04):
   - `turn-retry` — `attempt`, `of`, `error` (вид: `api-500`, `overloaded`, `connection`, …), `message` (текст ошибки,
     обрезанный), `until` (когда уйдёт продолжение); затем `resumed`, когда продолжение ушло;
   - `retry-refused` — `reason`: `not-transient` (ошибка не временная), `in-flight` (внешнее действие хода не дошло до
     результата), `cap` (попытки кончились) — перед `run-stopped` `turn-error`, как сегодня.
   Отказ Limits — как сегодня: `limits-hit`, `waiting-until`, `resumed`.
5. **Ручной ход вне Run-а.** Journal-а нет; в транскрипте Orchestrator-а — строка worfy (событие `notice`, его видит
   человек, не модель): «worfy: API error 529, retry 2 of 5 at 14:20» и «worfy: sent "continue" (retry 2 of 5)».

## Как работает

### Повтор после ошибки API (A)

1. **Какая ошибка временная** — чистая функция по концу хода (Ticket 01). Claude Code: текст `result` с `is_error`
   (`API Error: 500 … api_error`, `529 … overloaded_error`, `Connection error.`, timeout). Codex: `terminalReason`
   хода — ключ `codexErrorInfo` (`errorKind`, `src/main/vendors/codex/items.ts:74-78`): `serverOverloaded`,
   `internalServerError`, `httpConnectionFailed`, `responseStreamConnectionFailed`, `responseStreamDisconnected`,
   `responseTooManyFailedAttempts`. Отказ Limits — не сюда, а в путь B (`hitOf`, `limits-wait.ts:119`;
   `usageLimitExceeded`). Всё остальное — не временное: 400, 401/403, `contextWindowExceeded`, `modelNotFound`,
   отказ политики. Список — Q4.
2. **Не повторяем исходный текст.** Ни сообщение человека, ни команду Wave (`/epic-wave …`) worfy заново не шлёт.
   Продолжение — новое сообщение в ту же Session: Claude Code и Codex хранят историю хода до ошибки, вызовы tool-ов и
   их результаты модель видит. Так уже работает resume после Limits (`CONTINUE_TEXT`, `limits-wait.ts:24`). Поэтому
   правило worfy-faults И1 (команда Wave одна на Wave) держится и с переключателем.
3. **Текст продолжения называет внешние действия.** worfy смотрит события `tool_use` / `tool_result` хода с ошибкой и
   выделяет внешние действия: Bash с `git commit|push|merge|rebase|reset|tag`, `gh pr create|merge|close|edit`,
   `gh api` с `-X`/`--method`, `gh release`; запуск Agent-а (Subagent) или фоновой задачи; tool-ы MCP worfy, которые
   меняют состояние. Текст: «The previous turn ended with a temporary API error before it finished (retry 2 of 5).
   Continue from where you stopped. These actions of that turn already ran: <список>. Before you repeat any action that
   changes something outside this Session (commit, push, PR, merge, an Agent), check whether it already happened —
   git log, gh pr view, the task list — and do not do it twice.»
4. **Внешнее действие без результата — без повтора.** Если у внешнего действия хода есть `tool_use`, но нет
   `tool_result` (ход оборвался, пока шёл `git push` или merge), никто не знает, случилось ли оно. worfy не повторяет:
   `retry-refused` `in-flight`, Run останавливается `turn-error`, как сегодня. Ручной ход — строка в транскрипте
   «not retried: <действие> may or may not have run». Q9.
5. **Пауза и предел** (Ticket 03): 1, 5, 15, 30, 60 мин (≈ 1 ч 50 мин всего), ±20 % jitter; не больше 5 попыток подряд
   (Q3). Таймер — по часам стены (`wallTimer`, `limits-wait.ts`), как у ожидания Limits: Mac, который спал, не
   опаздывает на время сна. Ход, который кончился без ошибки (продолжение, ход по `task_notification` фоновой задачи,
   сообщение человека), обнуляет счётчик. Попытки кончились — `retry-refused` `cap`, `run-stopped` `turn-error` с
   текстом «gave up after 5 retries», как сегодня.
6. **Пока ждём.** Начался другой ход (фоновая задача прислала `task_notification`, человек написал) — таймер стоит, пока
   ход не кончится; кончился без ошибки — ожидание снято. Stop и Force stop Run-а, закрытие Session и выход приложения
   отменяют таймер; продолжение не уходит. Graceful Stop во время ожидания уходит вместе с продолжением одним
   сообщением, как у Limits (`resume`, `src/main/autopilot/run.ts:1689`).
7. **Claude Code сам повторяет запрос** к API несколько раз с короткой паузой, прежде чем отдать `API Error` (не
   проверено на закреплённой версии — первый шаг Ticket-а 01). Codex сам повторяет обрыв потока (`error` с
   `willRetry: true` → строка «It tries again», `items.ts:254`). Наш повтор — следующий слой, в минутах, а не в секундах;
   `willRetry: true` worfy не трогает.

### Продолжение после Limits (B)

1. **Окно — какое сообщил Vendor.** Отказ уже распознаёт `LimitsWait.hitOf` (окно и `resetsAt` из `rate_limit_event`
   или `limit_reached`); время сброса — `resumeAt` (`resume-at.ts`): окно отказа, иначе самое позднее окно `rejected` из
   `limits.json`, плюс запас 2 мин (`RESUME_MARGIN_MS`, `:14`). Ничего не завязано на `five_hour`: на плане с окном
   `five_hour` ждём его сброса, на верхнем плане без него — сброса `seven_day`, на Codex — `primary`/`secondary`.
   Test-ы — только на stub-ах Limits, оба случая: окно `five_hour` есть и его нет (Ticket 05).
2. **Окна нет вовсе** (ни в событии, ни в `limits.json`): как сегодня — новая попытка через `RECHECK_MS` (30 мин,
   `resume-at.ts:20`), каждая — одно сообщение Orchestrator-у, отказ стоит только отказанного запроса. На Codex перед
   попыткой — бесплатный `account/rateLimits/read` (`readCodexRateLimits`, `src/main/vendors/codex/limits.ts:119`), без
   хода модели. Квота без сброса (`limit_reached` с `reason: 'quota'`, `src/shared/agent/events.ts:262-273`) — ждать
   бесполезно: остановка с причиной. Q7.
3. **Далёкий сброс** (недельное окно через 3 дня): сегодня Run сдаётся через 24 ч. С переключателем — Q8; рекомендация —
   ждать до сброса, keep-awake держать, только пока до сброса ≤ 24 ч.
4. **Выключено** — Run Autopilot-а ведёт себя ровно как сегодня (worfy-daily 05: ожидание до 24 ч), ручной ход не
   продолжается. Включено — то же в Run-е плюс ручной ход и далёкий сброс (Q2).

### Где живёт

- **Настройка** — в `app-settings.json` Machine (`src/main/settings/store.ts`, ADR-0005), поле `autoContinue` по id
  Project-а: переключатель стоит в чате Orchestrator-а этого Project-а. Не в Profile, как Eco mode: Eco mode читает
  Harness при раздаче Ticket-а, а повтор — поведение worfy, Harness его не видит (Q2). Run читает настройку перед каждым
  решением о повторе: выключили во время ожидания — ожидание снято, Run останавливается, как остановился бы сегодня.
- **Run Autopilot-а** — `run.ts`: случай `result` в `Autopilot.onEvent` (`run.ts:1092-1129`) уже отделяет отказ Limits до
  `turn-ended`; новый класс `TurnRetry` (`src/main/autopilot/turn-retry.ts`, по образцу `LimitsWait`) перехватывает
  временную ошибку так же, до `cycle.ts`. Сам `cycle.ts` не меняется: с выключенным переключателем `turn-ended` с
  `isError` доходит до него, как сегодня.
- **Ручной ход** — новый модуль main `src/main/agent/orchestrator-continue.ts`: следит за событиями Session
  Orchestrator-а, пока Run Autopilot-а ею не владеет (Run делает то же сам), и шлёт продолжение через `Session.send`.
- **Состояние ожидания** для строки отсчёта — IPC-канал `autoContinue.wait` (Ticket 07), для Run-а — `AutopilotState`
  (`waitingFor: 'retry'`, `resumesAt`, `retry: { attempt, of }`; `src/shared/ipc/autopilot.ts:53`).

## Что уже есть (переиспользуем)

- **Переключатель Eco mode** (worfy-throughput 60, PR #1057): элемент поля ввода `EcoMode.tsx` (порядок 15, только у
  Orchestrator-а через `useOrchestratorViews`, `:137-143`), канал `src/shared/ipc/eco-mode.ts:29,54`, main
  `src/main/ipc/eco-mode.ts`; test-ы `test/contract/eco-mode.test.ts`, `test/unit/eco-mode-switch.test.tsx`,
  `test/e2e/eco-mode.spec.ts`. Хранит Eco mode Profile проекта (`workflow.agents`, `src/shared/agent/plan-preset.ts:33`).
- **Ожидание Limits в Run-е** (worfy-daily 05): `LimitsWait` (`limits-wait.ts:78`), `wallTimer`, `continueText`;
  `resumeAt`, `RESUME_MARGIN_MS`, `RECHECK_MS`, `MAX_WAIT_MS`, `isLimitsMessage` (`resume-at.ts:14,20,27,96`);
  `Autopilot.limitsHit` и `resume` (`run.ts:1670`, `:1689`); состояние `waiting` (`snapshot`, `run.ts:2068`).
- **Настройки Machine** `app-settings.json` (`src/main/settings/store.ts:1-22`): так же хранятся `autopilotBudget` и
  `autopilotRun` (только то, что выбрал человек; остальное — умолчание).
- **Journal**: `JOURNAL_EVENT_KINDS` (`src/shared/autopilot/journal.ts:280`), `limits-hit` / `waiting-until` /
  `resumed` (`:405-407`).
- **Codex**: `usageLimitExceeded` → `limit_reached` (`src/main/vendors/codex/limits.ts:1-6`, `session.ts:259`), вид
  ошибки хода в `terminalReason` (`items.ts:257`, `:269`), `willRetry` (`items.ts:254`).
- **Fake agent** `src/main/agent/fake-query.ts`: директива `wait_message` и повтор скрипта с начала после последней
  строки (`:11`, `:53-55`) — скрипт «ошибка, затем удачный ход» пишется без новых директив. Готовые скрипты
  `autopilot-limits.jsonl`, `error.jsonl`.
- **worfy-faults**: `faultRun` (`test/contract/autopilot-faults-setup.ts`, Ticket 02 того Epic-а), правила И1–И8
  (`test/autopilot-invariants.ts`, Ticket 01), скрипты `autopilot-fault-api-500.jsonl`, `-overloaded`, `-connection`.

## Чего нет

- Повтора хода после временной ошибки API — нигде.
- Продолжения ручного хода Orchestrator-а после отказа Limits.
- Ожидания сброса дальше 24 ч.
- Переключателя: ожидание Limits в Run-е включено всегда.
- Обратного отсчёта в чате Orchestrator-а; на Canvas есть только время в строке Autopilot.
- Test-ов worfy-faults с включённым повтором.

## Совместимость с worfy-faults

- Переключатель выключен по умолчанию (Q2): `AutopilotDeps` без поля `retry` ведёт себя как сегодня. Сценарии
  worfy-faults 02 и 06 («API 500 → `turn-error`», «529 → `turn-error`, не Limits», «Codex: ход упал») остаются верны без
  правки.
- Ticket 09 этого Epic-а добавляет в `faultRun` поле `autoContinue` и сценарии с включённым переключателем: 500, 529,
  обрыв связи → `turn-retry`, `resumed`, И1–И8; 5 ошибок подряд → `retry-refused` `cap`, `run-stopped` `turn-error`;
  внешнее действие без результата → `retry-refused` `in-flight`. В таблицу И4 worfy-faults
  (`test/autopilot-invariants.ts`) — строка «Run пережил `turn-retry` → `resumed`».

## Сценарии (test-ы Epic-а)

| Сценарий | Переключатель | Ожидание | Слой | Ticket |
| --- | --- | --- | --- | --- |
| API 500, затем удачный ход | off | `run-stopped` `turn-error` (как сегодня) | contract | 04 |
| API 500, затем удачный ход | on | `turn-retry` 1/5, `resumed`; команда Wave одна; продолжение одно | contract | 04 |
| 529 пять раз подряд | on | паузы 1, 5, 15, 30, 60 мин по часам test-а; `retry-refused` `cap`; `turn-error` | contract | 04 |
| 400 / `contextWindowExceeded` | on | `retry-refused` `not-transient`; `turn-error` | contract | 04 |
| `git push` без `tool_result`, затем 500 | on | `retry-refused` `in-flight`; продолжение не ушло | contract | 04 |
| Ожидание, фоновая задача дала удачный ход | on | ожидание снято, продолжение не ушло | contract | 04 |
| Stop во время ожидания | on | `user-stop`; продолжение не ушло | contract | 04 |
| Limits: окна `five_hour` и `seven_day`, отказ `five_hour` | on / off | `waiting-until` = сброс `five_hour` + 2 мин; `resumed` | unit + contract | 05 |
| Limits: только `seven_day` (верхний план) | on / off | ждёт сброса `seven_day`; `five_hour` нигде не нужен | unit + contract | 05 |
| Limits: окна нет вовсе | on | попытка каждые 30 мин; строка `no reset time reported` | unit + contract | 05 |
| Limits: сброс через 3 дня | off / on | off — `limits-timeout` через 24 ч; on — по Q8 | unit + contract | 05 |
| Ручной ход: 529, затем удачный | on / off | on — продолжение, строка в транскрипте; off — ничего | contract | 06 |
| Ручной ход: человек написал во время ожидания | on | ожидание снято, продолжение не ушло | contract | 06 |
| Ручной ход: отказ Limits | on | ожидание сброса, продолжение | contract | 06 |
| Codex: `serverOverloaded`, затем удачный | on | как 529 | contract | 08 |
| Codex: `willRetry: true` | on | worfy ничего не шлёт | contract | 08 |
| Codex: квота без сброса | on | остановка с причиной, ожидания нет | contract | 08 |

## Решено без владельца

1. **Продолжение, не повтор исходного текста.** Единственный способ не повторить уже сделанное — дать модели её же
   историю и спросить «продолжай»; повтор исходного сообщения запустил бы работу заново.
2. **`cycle.ts` не меняется.** Повтор перехватывается в `run.ts` до `turn-ended`, как отказ Limits: чистый цикл и его
   test-ы остаются. Исключение — Ticket 14: он правит в `cycle.ts` только остановку `session-error` (Ticket-ы Wave в
   `stopped`), не повтор.
3. **Повтор только у Orchestrator-а.** Session implementer-а — Subagent внутри Claude Code; его ошибку видит
   Orchestrator и решает сам. Обычные Session на Canvas переключателя не получают.
4. **Умерший процесс** (Claude Code или app-server Codex вышел — `session-error`) — не временная ошибка хода: relaunch
   Session — отдельная тема (Не в этом Epic-е).
5. **Строки в транскрипте ручного хода** — событие `notice` worfy; модель его не получает.
6. **Тексты в коде — английские** (ADR-0074), документы — русские.

## Новые термины

Предложение для `CONTEXT.md` (раздел `## Agents`), переносит Ticket 10:

- **Auto-continue** — настройка Project-а на Machine: после временной ошибки API worfy шлёт Orchestrator-у продолжение с
  растущей паузой, после отказа Limits ждёт сброса окна и продолжает. Исходное сообщение и команду Wave не повторяет.
  _Avoid_: автоповтор, replay, retry loop.
- **Orchestrator modes** (Q11) — настройки, которые меняют то, как работает Orchestrator: Eco mode, Auto-approval,
  Auto-continue. _Avoid_: режимы Autopilot.

Оба термина и «Auto-approval» внесены в `CONTEXT.md` 2026-11-05; Ticket 10 сверяет их со сделанным.

## Ticket-ы

- **01 — Какая ошибка временная.** Проверка формы ошибок Claude Code и Codex, чистая функция `turnFailureKind`. Blocked by: —.
- **02 — Настройка Auto-continue и пункт меню Modes.** `app-settings.json`, канал, третий пункт меню. Blocked by: 12.
- **03 — План повтора и текст продолжения.** Паузы, предел, внешние действия хода, правило `in-flight`. Blocked by: 01.
- **04 — Повтор в Run-е Autopilot-а.** `TurnRetry`, Journal `turn-retry` / `retry-refused`, строка на Canvas. Blocked by: 02, 03.
- **05 — Limits с переключателем: любые окна, далёкий сброс.** Blocked by: 02.
- **06 — Продолжение ручного хода Orchestrator-а.** Blocked by: 03, 04, 05.
- **07 — Обратный отсчёт в чате Orchestrator-а.** Blocked by: 04, 06.
- **08 — Codex: тот же переключатель.** Blocked by: 04, 06.
- **09 — Сценарии worfy-faults с включённым переключателем.** Blocked by: 04, 05 (и worfy-faults 01, 02 — влиты до старта).
- **10 — Документация.** Blocked by: 07, 08, 09.
- **11 — Приёмка с владельцем.** Blocked by: 01–10, 12–14.
- **12 — Меню Modes: перенести Eco mode и Auto-approval.** Одна кнопка «Modes» с иконками состояний вместо двух
  переключателей. Blocked by: —.
- **13 — Modes с Linked machine: Full access меняет, Read only видит.** Пометки каналов `project`, события смены,
  риски link-а. Blocked by: 12, 02.
- **14 — Ticket умершего Run-а в следующей Wave.** Дефект, найденный сценарием 1 Ticket-а worfy-faults 03 (влит #1439):
  после смерти Claude Code Orchestrator-а Ticket умершего implementer-а остаётся `claimed`, и следующий Run его не берёт.
  Следующий Run называет такие Ticket-ы в команде Wave, как после Force stop; статус worfy сам не пишет (ADR-0002);
  поправка ADR-0050 — в том же PR. Перенесён из worfy-faults (там был 09) решением владельца 2026-11-05, Q8 и Q9:
  worfy-faults остаётся Epic-ом только test-ов. Blocked by: —.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/shared/agent/turn-failure.ts`, `test/unit/turn-failure.test.ts` | 1 (влит) |
| 12 | `src/renderer/session/composer/Modes.tsx`, `src/renderer/session/composer/EcoMode.tsx`, `src/renderer/session/composer/AutoApprove.tsx`, `src/renderer/session/modes/eco-mode.ts`, `src/renderer/session/modes/auto-approval.ts`, `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/session.css`, `test/unit/modes-menu.test.tsx`, `test/unit/eco-mode-switch.test.tsx`, `test/unit/auto-approve-switch.test.tsx`, `test/e2e/eco-mode.spec.ts`, `test/e2e/auto-approve.spec.ts`, `test/e2e/session-controls.spec.ts`, `docs/features/sessions.md`, `docs/features/ru/sessions.md`, `docs/features/skills-agents-and-hooks.md`, `docs/features/ru/skills-agents-and-hooks.md` | 1 |
| 02 | `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`, `src/shared/ipc/auto-continue.ts`, `src/main/ipc/auto-continue.ts`, `src/renderer/session/modes/auto-continue.ts`, `src/renderer/session/composer/Modes.tsx`, `src/renderer/session/session.css`, `test/contract/auto-continue-setting.test.ts`, `test/unit/modes-menu.test.tsx`, `test/e2e/auto-continue.spec.ts`, `test/e2e/session-controls.spec.ts` | 2 |
| 03 | `src/shared/agent/continue-plan.ts`, `test/unit/continue-plan.test.ts` | 2 (влит) |
| 04 | `src/main/autopilot/turn-retry.ts`, `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `test/contract/autopilot-retry.test.ts`, `test/fixtures/agent-scripts/autopilot-retry-*.jsonl` | 3 |
| 13 | `src/shared/ipc/eco-mode.ts`, `src/shared/ipc/auto-approve.ts`, `src/shared/ipc/auto-continue.ts`, `src/main/ipc/eco-mode.ts`, `src/main/ipc/auto-approve.ts`, `src/main/ipc/auto-continue.ts`, `src/main/ipc/linked.ts`, `src/renderer/session/composer/Modes.tsx`, `src/renderer/session/modes/eco-mode.ts`, `src/renderer/session/modes/auto-approval.ts`, `src/renderer/session/modes/auto-continue.ts`, `test/contract/modes-linked.test.ts`, `test/unit/modes-menu.test.tsx`, `test/unit/link-access.test.ts`, `docs/features/sessions.md`, `docs/features/ru/sessions.md` | 3 |
| 05 | `src/shared/autopilot/resume-at.ts`, `src/main/autopilot/limits-wait.ts`, `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`, `test/unit/autopilot-resume-at.test.ts`, `test/contract/autopilot-limits-switch.test.ts`, `test/fixtures/agent-scripts/autopilot-limits-weekly.jsonl`, `test/fixtures/agent-scripts/autopilot-limits-no-window.jsonl` | 4 |
| 14 | `src/shared/autopilot/cycle.ts`, `src/main/autopilot/run.ts`, `src/shared/ipc/autopilot.ts`, `test/contract/autopilot-faults-process.test.ts`, `test/unit/autopilot-cycle.test.ts`, `docs/features/autopilot.md`, `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md` | 5 |
| 06 | `src/main/agent/orchestrator-continue.ts`, `src/main/agent/app-orchestrators.ts`, `test/contract/orchestrator-continue.test.ts`, `test/fixtures/agent-scripts/orchestrator-continue-*.jsonl` | 5 |
| 09 | `test/contract/autopilot-faults-setup.ts`, `test/autopilot-invariants.ts`, `test/unit/autopilot-invariants.test.ts`, `test/contract/autopilot-faults-retry.test.ts`, `test/fixtures/agent-scripts/autopilot-fault-retry-*.jsonl` | 5 |
| 07 | `src/shared/ipc/auto-continue.ts`, `src/main/ipc/auto-continue.ts`, `src/renderer/session/composer/ContinueCountdown.tsx`, `src/renderer/session/session.css`, `test/unit/continue-countdown.test.tsx`, `test/e2e/auto-continue.spec.ts` | 6 |
| 08 | `test/contract/codex-auto-continue.test.ts`, `test/fixtures/codex-scripts/auto-continue-*.jsonl`, `src/main/vendors/codex/items.ts` | 6 |
| 10 | `docs/features/sessions.md`, `docs/features/ru/sessions.md`, `docs/features/autopilot.md`, `docs/features/ru/autopilot.md`, `CONTEXT.md` | 7 |
| 11 | `.scratch/worfy-retry/spec.md` | 8 |

Правило плана: Ticket стоит в первой Wave, где закрыты все его блокеры; общий файл у двух Ticket-ов одной Wave —
Ticket с большим номером уходит дальше (`filesOverlap`, `src/shared/workflow/waves.ts:158`).

План пересчитан 2026-11-05 после Ticket-ов 12 и 13 и ещё раз после переноса 14; 01, 02, 03 и 12 к этому дню влиты.

- **Wave 1 — 01 (влит), 12.** Меню Modes не зависит ни от чего.
- **Wave 2 — 02, 03 (влит).** 02 ждёт меню (12); 03 ждал 01.
- **Wave 3 — 04, 13.** 04 ждёт 02 и 03; 13 — 12 и 02. Общих файлов нет. 05 тоже свободен с Wave 3, но делит с 04
  `run.ts` и `src/main/ipc/autopilot.ts` и уходит дальше.
- **Wave 4 — 05.**
- **Wave 5 — 06, 09, 14.** 06 ждёт повтор (04) и Limits (05); 09 — то же, файлы только test-ов worfy-faults. 14 блокеров
  в Epic-е не имеет, но делит `run.ts` и `src/shared/ipc/autopilot.ts` с 04 (Wave 3) и `run.ts` с 05 (Wave 4) и уходит
  дальше; с 06 и 09 общих файлов нет. `docs/features/autopilot.md` у него общий с 10 (Wave 7).
- **Wave 6 — 07, 08.** Обоим нужно состояние ожидания ручного хода (06).
- **Wave 7 — 10.** **Wave 8 — 11**, владелец.

## Не в этом Epic-е

- **Relaunch умершего процесса** Claude Code или app-server Codex (`session-error`): Session надо поднимать заново, это
  не повтор хода.
- **Повтор у обычных Session-ов и Subagent-ов**; повтор исходного сообщения или команды Wave.
- **Настройка числа внутренних повторов Claude Code**, если она есть: это поведение Claude Code, не worfy; Ticket 01
  только записывает, что Claude Code делает сам.
- **Отдельные паузы и предел в Settings**: числа — константы с комментарием (Q3).
- **Настоящий Claude Code или Codex** с учётной записью владельца в test-ах, сеть, платный eval: только fake agent,
  fake Codex и stub-ы Limits.
- **Пробуждение спящего Mac** к сбросу Limits (`pmset` по расписанию): нужны права администратора.

## Риски

1. **Повтор повторяет внешнее действие.** Модель видит историю, но может её не учесть. Защита — три слоя: продолжение
   вместо исходного текста; текст называет уже сделанные внешние действия и требует проверки; действие без результата
   останавливает повтор. Остаточный риск — модель всё же повторит действие; второй push того же commit-а — «up to
   date», второй merge — отказ gh, а второй PR или второй Agent виден в Journal и транскрипте.
2. **Петля трат.** Каждое продолжение — запрос; предел 5 подряд и рост паузы ограничивают траты при долгом сбое API.
3. **Отказ Limits, принятый за временную ошибку** (429 без события Limits): уйдёт в паузы 1–60 мин вместо ожидания
   сброса. Порядок проверки — сначала `hitOf`, потом классификатор (Ticket 01 и 04).
4. **Форма ошибки Claude Code меняется** между версиями: классификатор — по коду ошибки, а не по всему тексту;
   неизвестная форма — не временная (как сегодня). Compatibility suite worfy-reliability 05 ловит новую форму.
5. **Пересечение с worfy-multi-vendor 38** по `run.ts`, `resume-at.ts`, `limits-wait.ts`, `journal.ts`: Epic стартует
   после его merge.
6. **Двойное продолжение** — Run и модуль ручного хода оба отвечают на одну ошибку. Модуль ручного хода молчит, пока
   Run владеет Session (Ticket 06); test ловит два продолжения.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-retry/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный `ci-ok`
  (Linux, macOS и Windows job-ы), отметка `review`. Глубина ревью — по общему правилу (`rules-review-depth.md`);
  Ticket-ы 04 и 06 (worfy сам шлёт сообщения модели) и 13 (запись с другой Machine, Auto-approval через link) — не
  ниже `high`.
- **Сначала падающий test**: показать красный на старом поведении, это пишется в «Итог».
- **Без токенов и без чужих учётных записей.** `WORFY_AGENT=fake`, `WORFY_CODEX=fake` с временным `CODEX_HOME`, Limits —
  stub (`LimitsTracker` с часами test-а); настоящие Claude Code и Codex не запускаются. Оба случая окон — с `five_hour`
  и без него — только на stub-ах.
- Часы и таймеры — test-а (`now`, `schedule`, как у `LimitsWait`); в e2e пауза повтора задаётся через seam, а не
  настоящими минутами.
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Timeout-ы — через `ms()` (`test/time-scale.ts`).
- Flaky test — Quarantine со сроком (`test/quarantine.ts`). Low findings не становятся Ticket-ами.
- Репозиторий публичный: в fixture-ах и логах нет путей домашней папки, имён машин, id учётных записей.
- Перед локальным `pnpm test:e2e` на Mac — `rules-local-e2e.md`.
- Язык: документы — русские, термины — латиницей из `CONTEXT.md`, имена UI — латиницей.

## Вопросы владельцу

Ответы приняты владельцем 2026-11-04 («Да, всё»): везде рекомендация.

1. **Q1. Один переключатель или два.** (а) Один «Auto-continue» на оба случая; (б) два: «Retry on API errors» и
   «Resume after limits»; (в) один в чате и тонкая настройка в Settings → Autopilot. **Рекомендую (а):** механизм один
   (продолжение в ту же Session, без повтора исходного текста), строка поля ввода уже в две строки и тесна; если
   понадобится отключить только повтор — (в) отдельным Ticket-ом.
2. **Q2. По умолчанию и где хранится.** (а) Выключен, хранится на Machine по Project-у (`app-settings.json`); выключен
   — всё как сегодня, включая ожидание Limits в Run-е; (б) включён по умолчанию; (в) в Profile проекта, как Eco mode.
   **Рекомендую (а):** test-ы worfy-faults «стоп на 500» остаются верны без правки, новое поведение включает владелец
   один раз на Project; Profile читает Harness, а повтор — дело worfy.
3. **Q3. Предел и паузы.** (а) 5 попыток подряд: 1, 5, 15, 30, 60 мин (≈ 1 ч 50 мин), ±20 % jitter; (б) 3 попытки: 1, 5,
   15 мин; (в) без предела, пауза до 60 мин, общий предел 24 ч. **Рекомендую (а):** сбой API обычно короче двух часов,
   а ночной Run, который сдался через 20 мин, теряет ночь; (в) тратит запросы при долгом сбое.
4. **Q4. Какие ошибки временные.** (а) Узко: HTTP 500, 502, 503, 504, 529, обрыв связи и timeout; Codex —
   `serverOverloaded`, `internalServerError`, `httpConnectionFailed`, `responseStreamConnectionFailed`,
   `responseStreamDisconnected`, `responseTooManyFailedAttempts`; (б) то же плюс 429 без события Limits и неизвестные
   ошибки. **Рекомендую (а):** неизвестная ошибка, повторённая 5 раз, — 5 лишних запросов и шум; 429 на подписке —
   почти всегда Limits, и путь B его ловит.
   _Дополнение 2026-11-04 (решение Orchestrator-а, PR #1387):_ Codex `responseTooManyFailedAttempts` с
   `httpStatusCode` 429 — не временная ошибка (`other`): Codex уже исчерпал свои повторы по rate limit, как и Claude
   `API Error: 429`. Делает Ticket 08: сегодня код до `turnFailureKind` не доходит.
5. **Q5. Только Run Autopilot-а или и ручные ходы Orchestrator-а.** (а) Оба: переключатель стоит в чате Orchestrator-а,
   а ночная работа часто идёт без Run-а — Orchestrator ведёт Wave-ы сам с фоновыми агентами; (б) только Run.
   **Рекомендую (а):** с правилом — сообщение человека снимает ожидание, а пока Run владеет Session, ручной модуль молчит.
6. **Q6. Codex.** (а) Тот же переключатель для Orchestrator-а на Codex, классификация по `codexErrorInfo`, `willRetry:
   true` worfy не трогает; (б) сначала только Claude Code. **Рекомендую (а):** у Codex ошибки уже с кодом, это проще
   разбора текста Claude Code; Autopilot на Codex — новый путь worfy-multi-vendor 37.
7. **Q7. Окна Limits нет вовсе** (верхний план без `five_hour`, событие без `resetsAt`, `limits.json` пуст).
   (а) Попытка каждые 30 мин (`RECHECK_MS`), на Codex — сначала бесплатное чтение окон; строка «no reset time
   reported · next try in …»; (б) остановиться сразу с причиной «no reset time reported». **Рекомендую (а):** так Run
   ведёт себя уже сегодня; попытка стоит одного отказанного запроса. На плане с `five_hour` и на плане без него правило
   одно: ждём сброса того окна, которое пришло в отказе или в `limits.json`, а без окна — проверяем по интервалу.
8. **Q8. Далёкий сброс** (недельное окно через 3 дня). (а) Как сегодня: предел 24 ч, потом `limits-timeout` с временем
   сброса в причине; (б) ждать до сброса сколько угодно, keep-awake всё время; (в) ждать до сброса, keep-awake — только
   когда до сброса ≤ 24 ч, раньше Mac может спать, продолжение уйдёт при первом пробуждении после сброса.
   **Рекомендую (в):** на верхнем плане единственное окно — недельное, и (а) для него почти ничего не даёт; (б) держит
   Mac без сна днями.
9. **Q9. Безопасность повтора при внешних действиях.** (а) Повтор всегда продолжением; текст называет внешние действия
   хода; действие без `tool_result` — без повтора; (б) без повтора, если в ходе было любое внешнее действие; (в) повтор,
   только если в ходе не было вызовов tool-ов. **Рекомендую (а):** почти каждый ход Orchestrator-а запускает Agent-ы или
   gh, и (б)/(в) почти никогда не повторяли бы; модель видит результаты, а неизвестный исход останавливает повтор.

## Решения владельца 2026-11-05 (Q10–Q18)

Владелец ответил «да» на все девять; Q15 — с его поправкой.

10. **Q10. Где третий переключатель.** В строке controls Orchestrator-а после Auto-approval (PR #1368) места нет: при
    1280×800 с открытым sidebar остаётся около 30 px, более широкая строка сталкивает Send со строки pickers
    (`test/e2e/session-controls.spec.ts:315`, `test/e2e/context-meter.spec.ts:128`). **Решено:** одна кнопка-меню вместо
    отдельных Eco mode и Auto-approval; в меню Eco mode (on/off), Auto-approval (off/shadow/on), Auto-continue (on/off).
11. **Q11. Имя.** **Решено:** кнопка «Modes»; новый термин глоссария «Orchestrator modes» — настройки, которые меняют
    то, как работает Orchestrator: Eco mode, Auto-approval, Auto-continue. Не «Autopilot»: Auto-continue действует и на
    ручные ходы Orchestrator-а (Q5), Eco mode — на любую раздачу Ticket-а.
12. **Q12. Вид кнопки.** **Решено:** всегда три иконки состояния, ширина постоянная: включённый режим — яркая,
    выключенный — приглушённая, Auto-approval Shadow — контур. Строка не меняет ширину от состояний.
13. **Q13. Кто переносит.** **Решено:** новый Ticket 12 «Меню Modes: перенести Eco mode и Auto-approval»; Ticket 02
    получает `Blocked by: 12` и добавляет в меню третий пункт вместо своего `AutoContinue.tsx` с порядком 16.
14. **Q14. Имя в UI.** **Решено:** «Auto-approval», как `aria-label` в `src/renderer/session/composer/AutoApprove.tsx:205`;
    папка Epic-а `worfy-auto-approve` остаётся. В глоссарии «Auto-approval», _Avoid_: Auto-approve в тексте UI.
15. **Q15. Linked machine с Full access** (поправка владельца: «полный доступ — значит действительно полный»).
    **Решено:** меняет все три режима. С Read only видит их и не меняет.
16. **Q16. Отдельный Ticket.** **Решено:** Ticket 13 «Modes с Linked machine: Full access меняет, Read only видит»,
    Blocked by 12 и 02, все три пункта; запись идёт через link на Machine Project-а (Eco mode — в Profile через
    `bin/profile-set` там, Auto-approval и Auto-continue — в настройки той Machine). До merge 13 окно Linked machine —
    как сегодня: оба переключателя недоступны при любом уровне доступа и даже не читают состояние (`elsewhere`,
    `EcoMode.tsx:52`, `AutoApprove.tsx:85`).
17. **Q17. Read only.** **Решено:** меню открывается, три состояния видны, каждый пункт недоступен с подсказкой
    Read only из `useReadOnly` (`src/renderer/projects/useProjects.ts:263-270`).
18. **Q18. Смена на другой Machine.** **Решено:** открытое меню обновляется сразу (рассылка, как у store настроек);
    Ticket 13 проверяет это contract test-ом.

## Готово, когда

- [ ] Меню Modes у Orchestrator-а: Eco mode, Auto-approval, Auto-continue; кнопка постоянной ширины с тремя иконками
      (12, 02). Auto-continue off по умолчанию; хранится по Project-у (02).
- [ ] Linked machine: Full access меняет все три режима, Read only видит; смена видна в открытом меню другой Machine
      сразу (13).
- [ ] Выключен — Run и ручной ход ведут себя как сегодня; сценарии worfy-faults 02 и 06 зелёные без правки (04, 09).
- [ ] Включён — после временной ошибки продолжение уходит в ту же Session с паузами и пределом; исходный текст и команда
      Wave не повторяются; действие без результата останавливает повтор (03, 04, 06).
- [ ] Limits: ожидание сброса по окну, которое сообщил Vendor, — с `five_hour` и без него; без окна — проверка по
      интервалу; далёкий сброс — по Q8 (05).
- [ ] Обратный отсчёт в чате Orchestrator-а и строка на Canvas (04, 07).
- [ ] Codex — тот же переключатель (08). Сценарии worfy-faults с включённым переключателем (09).
- [ ] Страницы Feature и термин в `CONTEXT.md` (10). Приёмка владельца (11).
