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
- [ ] E2e: on, fake agent отдаёт 529 — строка с отсчётом видна; `Retry now` — продолжение ушло; второй сценарий —
      `Cancel`, продолжения нет. Пауза задана seam-ом test-а (секунды, не минуты).
- [ ] Снимки строки в светлой и тёмной теме.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

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
