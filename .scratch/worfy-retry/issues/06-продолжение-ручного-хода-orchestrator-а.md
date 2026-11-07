# 06 — Продолжение ручного хода Orchestrator-а вне Run-а: ошибка API и отказ Limits

Type: task
Status: open
Blocked by: 03, 04, 05
Source: [spec.md](../spec.md), «Что видит владелец», п. 2 и 5; «Как работает» → «Где живёт»; «Риски», п. 6; «Вопросы владельцу», Q5

## Что происходит

- Вне Run-а Autopilot-а ход Orchestrator-а с ошибкой или с отказом Limits просто кончается; дальше Session ждёт
  человека. Ночью Orchestrator часто ведёт Wave-ы сам, без Run-а, с фоновыми агентами.
- Run Autopilot-а после Ticket-ов 04 и 05 повторяет сам; Session Run-а помечена unattended (`setUnattended`,
  `src/main/agent/orchestrator.ts`).
- События Session — `sharedRegistry().observe` (как `observeSessionLimits` в `src/main/ipc/autopilot.ts:194`);
  сообщение — `Session.send`.

## Что делаем

1. **`src/main/agent/orchestrator-continue.ts`** — по Session Orchestrator-а каждого Project-а с включённым
   переключателем: следит за `prompt`, `result`, `tool_use`, `tool_result`, `limits`, `limit_reached`.
2. **Молчит, пока Run владеет Session** (Run Autopilot-а этого Project-а идёт): тогда отвечает Run. Test ловит два
   продолжения на одну ошибку.
3. **Ошибка API:** `turnFailureKind` → `retryDecision` → таймер `retryDelay` → `retryText` в Session; счётчик — до
   удачного хода. **Отказ Limits:** `hitOf` / `resumeAt` (с правилами Ticket-а 05) → таймер → `continueText`.
4. **Человек написал** во время ожидания (событие `prompt` не от worfy) — ожидание снято. Выключили переключатель,
   закрыли Session, вышли из приложения — таймер отменён.
5. **Строки в транскрипте** — событие `notice` worfy (модель его не получает): «worfy: API error 529, retry 2 of 5 at
   14:20», «worfy: sent "continue" (retry 2 of 5)», «not retried: <действие> may or may not have run»,
   «worfy: waiting for the Limits, resumes 14:20». Проверить первым шагом, что `notice` сохраняется в транскрипте
   после перезапуска приложения; если нет — записать в «Итог» и показывать строку только в живом окне.
6. Состояние ожидания (вид, попытка, время) — наружу для Ticket-а 07, методом модуля.

## Готово, когда

- [ ] Contract test: on, ручной ход 529, затем удачный — одно продолжение, строки в транскрипте; off — ничего не ушло.
  - evidence: test-run pass · `pnpm test test/contract/orchestrator-continue.test.ts` exit 0 · mac - · 0ceae2c35b719be97f40662bf3983e58cd6403b0
- [ ] Contract test: человек написал во время ожидания — продолжения нет.
  - evidence: test-run pass · `pnpm test test/contract/orchestrator-continue.test.ts` exit 0 · mac - · 0ceae2c35b719be97f40662bf3983e58cd6403b0
- [ ] Contract test: отказ Limits вне Run-а — ожидание сброса по stub-у, одно продолжение.
  - evidence: test-run pass · `pnpm test test/contract/orchestrator-continue.test.ts` exit 0 · mac - · 0ceae2c35b719be97f40662bf3983e58cd6403b0
- [ ] Contract test: идёт Run — модуль ничего не шлёт; Run повторил один раз.
  - evidence: test-run pass · `pnpm test test/contract/orchestrator-continue.test.ts` exit 0 · mac - · 0ceae2c35b719be97f40662bf3983e58cd6403b0
- [ ] Contract test: `git push` без результата — продолжения нет, строка «not retried».
  - evidence: test-run pass · `pnpm test test/contract/orchestrator-continue.test.ts` exit 0 · mac - · 0ceae2c35b719be97f40662bf3983e58cd6403b0
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.

## Тесты

- Contract `test/contract/orchestrator-continue.test.ts` (новый): настоящие `SessionRegistry`, `Orchestrators` на fake
  agent, часы и таймер test-а.
- Скрипты `test/fixtures/agent-scripts/orchestrator-continue-overloaded.jsonl`, `orchestrator-continue-limits.jsonl`
  (новые).
- Сначала падающий: on, 529 — ожидание продолжения красное.
- Прогнать `test/contract/orchestrator*.test.ts`, `test/contract/autopilot*.test.ts`.

## Где в коде

- `src/main/agent/orchestrator-continue.ts` (новый)
- `src/main/agent/app-orchestrators.ts` (подключение)
- `test/contract/orchestrator-continue.test.ts`, `test/fixtures/agent-scripts/orchestrator-continue-*.jsonl` (новые)

Только читать: `src/main/agent/orchestrator.ts`, `src/main/agent/limits.ts`, `src/main/autopilot/turn-retry.ts`,
`src/main/autopilot/limits-wait.ts`, `src/shared/agent/continue-plan.ts`, `src/shared/agent/turn-failure.ts`.

## Итог

Новый модуль `src/main/agent/orchestrator-continue.ts` (класс `OrchestratorContinue`) подключён в
`src/main/agent/app-orchestrators.ts`: события — `sharedRegistry().observe`, чья Session чья — из view Orchestrator-а
(`publish`), переключатель — `autoContinueOn`, его смена — `changed` хранилища настроек, Limits — `appLimits()`.
Файлы «только читать» не менялись: модуль использует их как есть — `TurnRetry` (план `retryDecision`, `retryText`,
счётчик до удачного хода) и `LimitsWait` (`hitOf` первым, `plan(hit, true)` — далёкий сброс ждём по Q8 (в),
`continueText`). Своего плана пауз и своего текста продолжения у модуля нет.

- **Сначала падающий test:** модуль-заглушка без поведения — `test/contract/orchestrator-continue.test.ts` 6 из 7
  красные (on, 529 — `timed out waiting for the wait for the continuation`); зелёный был только test «off».
- **Строка `notice` после перезапуска** (проверка первым шагом): не сохраняется. `Session.notice` шлёт событие только
  подписчикам живой Session (`src/main/agent/session.ts`, `notice`); после перезапуска история Orchestrator-а читается
  из транскрипта Claude Code (`src/shared/transcript/parse.ts`), а worfy туда не пишет (ADR-0005). Строки видны только
  в живом окне, пока приложение работает; так и сказано на странице `docs/features/sessions.md`.
- **Run владеет Session** = Session unattended (`Session.unattended`): модуль тогда молчит и снимает своё ожидание.
  Test с настоящим Run-ом на том же registry: у Run-а один `turn-retry` и одно продолжение, у модуля ни таймера, ни строки.
- Строки: `worfy: API error 529, retry 1 of 5 at HH:MM`, `worfy: sent "continue" (retry 1 of 5)`,
  ``worfy: not retried: `git push origin demo/01` may or may not have run``, `worfy: not retried: gave up after 5
  retries`, `worfy: waiting for the Limits, resumes HH:MM` (без времени сброса — `…, no reset time reported, next try at
  HH:MM`), `worfy: sent "continue" after the Limits wait`, `worfy: Auto-continue is off; nothing was sent`. Время —
  местное; на другой день — с датой.
- Состояние ожидания для Ticket-а 07 — `wait(projectId)`: `{ kind: 'retry', attempt, of, error, until }` или
  `{ kind: 'limits', window, until }`; экземпляр — `sharedOrchestratorContinue()`.

Решено без владельца:

- Владение Run-ом определяется по `Session.unattended`, а не по состоянию Autopilot: `app-orchestrators.ts` не может
  импортировать `src/main/ipc/autopilot.ts` (тот импортирует его). Остановленный Run, чья Session ждёт возврата
  человеку, тоже считается владельцем — модуль молчит (безопасная сторона).
- Ход, который идёт в момент таймера (task-notification фоновой задачи), снимает ожидание без отправки, а счётчик
  остаётся; решает конец этого хода — как в `run.ts` (`retryResume`). Сообщение человека во время ожидания — так же.
- Вне Run-а keep-awake не берётся: таймер по часам стены продолжает при первом пробуждении после срока
  (`shortcut:` в модуле).
- На Codex после ожидания Limits окна заново не читаются (в Run-е это `stillRefused`): продолжение уходит, и если
  Limits всё ещё отказывают, новый отказ ставит новое ожидание.
- Отказ без повтора по `not-transient` строки не даёт: ход кончился ошибкой, как сегодня. Квота без сброса и `give-up`
  дают строку `worfy: not continued: …`.

Долг: ветки `give-up`/`quota` и далёкий сброс у ручного хода test-ом не покрыты (покрыты в Run-е тем же `LimitsWait`).

### Итог раунда 2

После ревью high (раунд 1, PR #1548); ветка перебазирована на `origin/main` 12349ec0c.

- (1) Начало хода — не только `prompt`, но и переход Session в `busy` (ход, который Claude Code начал сам по
  task-notification, `prompt` не шлёт). Каждое начало сбрасывает вызовы прошлого хода (`TurnRetry.turnStarted`) и
  новости Limits (`LimitsWait.turnStarted`); запись вызовов больше не растёт всё время работы приложения. Ходы и их
  вызовы отслеживаются и пока Run владеет Session: Run, отдавший Session посреди хода, оставляет модулю его конец со
  всеми вызовами. Новый fixture `orchestrator-continue-task-turn.jsonl`.
- (2) Связка `app-orchestrators.ts` проверена через `sharedOrchestrators()` и `sharedOrchestratorContinue()` с настоящим
  хранилищем настроек: выключено — ни строки, ни отправки и через 2 ч; включено — одно продолжение по часам стены;
  выключено в Modes во время ожидания — ожидание снято сразу; выход приложения (`will-quit`) снимает ожидание.
- (3) Ход, прерванный человеком, с отказом Limits во время хода и текстом про Limits — не продолжается.
- (4) Проверки в момент таймера: переключатель выключен без уведомления модуля; Session стала unattended; идёт ход
  (task-notification) — ничего не уходит. Для последнего случая добавлена строка
  `worfy: a turn is under way; nothing was sent, its end decides`.
- (5) Смена другой настройки во время ожидания ожидание не снимает; продолжение уходит одно.
- (6) Два Project-а: отказ одного не трогает ожидание другого, отказ без окна не берёт окно чужой Session.
- Строки `notice` теперь уходят после того, как событие, о котором они говорят, дошло до окон (`queueMicrotask`): в
  чате строка стоит ниже строки ошибки.
- Новые fixture-ы: `orchestrator-continue-task-turn.jsonl`, `-interrupted-limits.jsonl`, `-limits-text.jsonl`;
  `test/contract/sdk-compat.test.ts` их принимает (у прерванного хода — `errors`, как у настоящего SDK).
- Каждый новый test убивает своего мутанта: 15 мутантов (11 в модуле, 4 в связке) — все убиты
  (`/tmp/impl-retry06/mutate.mjs`, вне репозитория).

Раздел «Consider»:

- **Codex: чтение окон перед продолжением (spec Q7 (а)) не добавлено — решение для владельца.** Run перед продолжением
  читает окна Codex бесплатным `account/rateLimits/read` (`stillRefused` в `run.ts`); модуль ручного хода — нет: после
  ожидания продолжение уходит, и если Limits всё ещё отказывают, отказ ставит новое ожидание (цена — один отказанный
  запрос на попытку). Если владелец хочет чтение и здесь — отдельный Ticket: перенести `stillRefused` в общий helper.
  В коде — `shortcut:` в `orchestrator-continue.ts`.
- Строка при идущем ходе в момент таймера — сделано (пункт 4).
- Порядок строк относительно строки ошибки — сделано (`queueMicrotask`, test проверяет порядок в событиях окон).
- `isLimitsMessage` (`resume-at.ts`, только читать) может принять за отказ Limits постоянную ошибку, в тексте которой
  есть «rate limit». Не менялось: так же ведёт себя Run; ошибка без окна даёт попытки раз в 30 мин не дольше 24 ч.
- `docs/features/sessions.md`: полный список временных ошибок (timeout, обрыв потока), все строки, сон Mac без
  keep-awake, Codex без чтения окон, прерванный ход.
- Мёртвый код: `entry.sent` удалён (своё продолжение снимает ожидание до отправки, его `prompt` ничего не находит).
  `retry.cancel()` в ветке отказа Limits оставлен: он нужен, когда во время ожидания повтора ход task-notification
  кончается отказом Limits — тогда ожидание одно, Limits.
