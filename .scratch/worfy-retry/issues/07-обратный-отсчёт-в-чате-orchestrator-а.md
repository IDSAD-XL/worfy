# 07 — Обратный отсчёт в чате Orchestrator-а: Retry now и Cancel

Type: task
Status: open
Blocked by: 04, 06
Source: [spec.md](../spec.md), «Что видит владелец», п. 2; «Как работает» → «Где живёт» (состояние ожидания)

## Что происходит

- Run ждёт — время видно только в строке Autopilot на Canvas (`autopilotStatusLine`, `src/shared/ipc/autopilot.ts:215`).
- В чате Orchestrator-а ожидания не видно; после Ticket-а 06 ждёт и ручной ход.
- Элементы поля ввода — `src/renderer/session/composer/` (`index.ts` — порядок; `Queue.tsx` — строка над полем).

## Что делаем

1. **Канал** `autoContinue.wait` в `src/shared/ipc/auto-continue.ts`: состояние ожидания Orchestrator-а Project-а —
   `{ kind: 'retry', attempt, of, error, at } | { kind: 'limits', window, at } | { kind: 'limits', window: null, at }`
   или `null`; источник — Run (`AutopilotState`) или модуль ручного хода (Ticket 06). Методы `retryNow`, `cancel`.
2. **`src/renderer/session/composer/ContinueCountdown.tsx`** — строка над полем ввода, только у Orchestrator-а:
   - `API error 529 (overloaded) · retry 2 of 5 in 4:12` · `Retry now` · `Cancel`;
   - `Limits: 7-day window · resumes 14:20 (in 2:13:05)` · `Cancel`;
   - `Limits: no reset time reported · next try in 27:40` · `Cancel`.
   Отсчёт — по секундам от `at`, время — местное. Окно — по имени, которое прислал Vendor (`five_hour` → «5-hour»,
   `seven_day` → «7-day», Codex — подписи из `src/main/vendors/codex/limits.ts`).
3. `Retry now` — продолжение сразу (та же попытка, без новой паузы); `Cancel` — ожидание снято: Run останавливается
   с той причиной, с которой остановился бы без переключателя (`turn-error` / `limits-timeout`), ручной ход — ничего.

## Готово, когда

- [ ] Unit test: три вида строки и формат отсчёта; `null` — строки нет; обычная Session — строки нет.
  - evidence: test-run pass · `pnpm test test/unit/continue-countdown.test.tsx` exit 0 · mac - · 2d95828be03e258f4e28d8665c9ef6e568c42841
- [ ] E2e: on, fake agent отдаёт 529 — строка с отсчётом видна; `Retry now` — продолжение ушло; второй сценарий —
      `Cancel`, продолжения нет. Пауза задана seam-ом test-а (секунды, не минуты).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts` exit 0 · mac dev · 444c1c307
- [ ] Снимки строки в светлой и тёмной теме.
  - evidence: screenshot pass · `../evidence/07-countdown-retry-light.png` · mac dev · 444c1c307 · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/07-countdown-retry-dark.png` · mac dev · 444c1c307 · scrub: 2026-11-07
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 13baf9023
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 13baf9023

## Тесты

- Unit `test/unit/continue-countdown.test.tsx` (новый).
- E2e `test/e2e/auto-continue.spec.ts` (дописать к Ticket-у 02).
- Сначала падающий: e2e — строки нет.

## Где в коде

- `src/shared/ipc/auto-continue.ts`, `src/main/ipc/auto-continue.ts`
- `src/renderer/session/composer/ContinueCountdown.tsx` (новый), `src/renderer/session/session.css`
- `test/unit/continue-countdown.test.tsx` (новый), `test/e2e/auto-continue.spec.ts`

Только читать: `src/renderer/session/composer/Queue.tsx`, `src/renderer/session/composer/index.ts`,
`src/main/agent/orchestrator-continue.ts`, `src/main/autopilot/turn-retry.ts`.

## Итог

Строка над полем ввода Orchestrator-а — `src/renderer/session/composer/ContinueCountdown.tsx` (элемент bar-а на строке
подсказок, нарисованный над полем; `session.css`, `.w-continue`). Каналы — `src/shared/ipc/auto-continue.ts`:
`autoContinue.wait` (read), `autoContinue.waitChanged` (событие ручного ожидания), `autoContinue.retryNow` и
`autoContinue.cancel` (write); там же чистые форматтеры `countdownText`, `localTime`, `countdownLine`. Обработчики —
`src/main/ipc/auto-continue.ts`: ожидание Run-а первым, иначе ручного хода; кнопки идут тому, кто ждёт.

- **Вне следа «Где в коде».** Ticket называет `src/main/agent/orchestrator-continue.ts` «только читать», но у модуля
  ручного хода не было ни кнопок, ни события смены ожидания. Добавлены `observeWaits`, `retryNow`, `cancel`
  (`continueRetry` вынесен из `retryFired`, чтобы таймер и кнопка шли одним путём). В `src/main/autopilot/run.ts` —
  `continueWait`, `retryNow`, `cancelContinue` и `retryDropped` (вынесен из `retryResume`, тот же путь, что при
  выключенном переключателе). В `src/main/agent/app-orchestrators.ts` — seam e2e `WORFY_CONTINUE_PAUSE_MS`.
- **Guard против второй отправки.** Retry now: ручной ход — `TurnRetry.resume()` снимает таймер и `until`, второй клик
  находит `retry.until === null`; Run — клик идёт в очередь Run-а и проверяет `isCurrent(retryId)`, таймер после него
  находит id не текущим. Cancel снимает таймер; позднее срабатывание таймера ничего не шлёт. Contract test-ы:
  `test/contract/orchestrator-continue.test.ts` (двойной клик, таймер после Retry now, таймер после Cancel, Limits) и
  `test/contract/autopilot-retry.test.ts` (двойной клик `Promise.all` → `[true, false]`, таймер после, Cancel →
  `turn-error` / `limits-timeout`, сообщений после Cancel нет).
- **Ревью PR #1563, раунд 1 (mutation testing).** Добавлены test-ы на три выживших мутанта, каждый проверен ручной
  мутацией: Cancel Run-а, вставший в очередь за Retry now или за таймером, отвечает `false`, ничего не подаёт в цикл,
  Run идёт дальше (мутант без guard-а `retry.until === null` в `cancelContinue`); Cancel ручного ожидания и сразу
  следующий 529 без удачного хода между ними — снова retry 1 (мутант без сброса счёта в `cancel`); Retry now при Session,
  которая уже не готова, сразу сообщает окнам конец ожидания (мутант без `tell()` в `retryNow`). Код не менялся.
- **Снимки** — строка retry в обеих темах: `../evidence/07-countdown-retry-light.png`,
  `../evidence/07-countdown-retry-dark.png` (e2e `test/e2e/auto-continue.spec.ts`, `captureScreenshot`). Строк Limits на
  снимках нет: их вид проверяет unit test.
- **Сначала падающий e2e** этим implementer-ом не воспроизводился: работу начал прошлый implementer (остановлен
  перезапуском worfy), его красного прогона в записи нет.

Решения без владельца:

1. Строка показывает и ожидание Limits у Run-а при выключенном Auto-continue (Run ждёт Limits и без переключателя);
   Cancel тогда останавливает Run с `limits-timeout`, сообщение Run-а — `The wait for the Limits reset was cancelled`.
2. Retry now — только у ожидания после ошибки API; у Limits только Cancel (как в «Что делаем»); канал `retryNow` на
   ожидании Limits отвечает `{ done: false }` и ничего не шлёт.
3. Ожидание Run-а важнее ручного: пока Run владеет Session, модуль ручного хода всё равно не ждёт.
4. Подпись окна: подпись известного окна Vendor-а (Codex), иначе Claude по началу имени (`five_hour` — `5-hour`,
   `seven_day` — `7-day`, `seven_day_opus` — `7-day opus`), иначе имя с пробелами.
5. Время сброса на другой день — с датой: `resumes 2026-11-09 14:20`; отсчёт от часа — `h:mm:ss`, после срока — `0:00`.
6. Cancel ручного ожидания пишет в транскрипт строку `worfy: the wait was cancelled; nothing was sent`; следующая ошибка —
   retry 1 нового счёта.
7. Ожидание Run-а приходит в окно с его состоянием: строка перечитывает `autoContinue.wait` на `autopilot.changed`,
   отдельного события для Run-а нет.
8. В окне только для чтения кнопки видны с подсказкой и ничего не шлют (как остальные действия записи).
9. Seam e2e `WORFY_CONTINUE_PAUSE_MS` укорачивает только паузу ручного хода; строка показывает время плана.
