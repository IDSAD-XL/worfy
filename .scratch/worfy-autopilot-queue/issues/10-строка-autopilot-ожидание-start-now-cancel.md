# 10 — Строка Autopilot: ожидание Orchestrator-а, Start now и Cancel

Type: task
Status: open
Blocked by: 07, 09
Source: [spec.md](../spec.md), «Что видит владелец», п. 2–3; «Окно запуска (прототип)», виды «Start now» и «Waiting line»; «Решения владельца», 4, 12, 15; [02](02-старт-при-идущей-работе.md), Q4, решение 12

## Что происходит

- После 07 ожидающий Run публикует `waitingFor: 'orchestrator'`, `busy` и строку `waiting for the Orchestrator · N min`;
  каналы `autopilot.startNow` и `autopilot.stop` (Cancel ожидания) есть.
- Строка Autopilot и её кнопки — `AutopilotAction.tsx` (строка `:385`, кнопки `:420-445`, меню «⋯» `:449-475`); окно
  и кнопка `danger` — из 09.

## Что делаем

1. В строке Autopilot ожидающего Run-а — кнопки «Start now» и «Cancel» (Cancel — без подтверждения: Orchestrator не
   трогается).
2. **Малое окно «Start now?»** `src/renderer/autopilot/StartNowModal.tsx` (рамка окна 09, ширина 460): «Autopilot
   <Epic> starts right away. This stops:» — «✕ the running turn» (если ход идёт), «✕ N background tasks: <имена>»,
   «✓ N queued messages stay in the queue»; Cancel и красная «Interrupt and start». Список берётся из `busy` в момент
   открытия и обновляется, пока окно открыто. Esc — Cancel, фокус на Cancel.
3. Тексты toast-ов: Cancel — «Autopilot cancelled; the Orchestrator was not touched»; Start now — «Turn interrupted, N
   background tasks stopped · Autopilot started».

## Готово, когда

- [ ] Unit test окна Start now: строки по `busy` (ход есть / нет, 0 и 3 задачи, сообщения), Esc не прерывает.
- [ ] e2e: Orchestrator в ходе (fake agent держит ход) → «Start when free» → строка ожидания с минутами → «Start now» →
      окно со списком → «Interrupt and start» → Wave пошла; второй сценарий — «Cancel» в строке → Run остановлен
      `start-cancelled`, ход Orchestrator-а продолжается.
- [ ] Снимки строки ожидания и окна Start now в обеих темах — `../evidence/10-*.png`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/start-now-modal.test.tsx`, e2e `test/e2e/autopilot-wait.spec.ts` (новые).
- Сначала падающий: строка ожидания без кнопки «Start now».

## Где в коде

- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/renderer/autopilot/StartNowModal.tsx` (новый)
- `test/unit/start-now-modal.test.tsx`, `test/e2e/autopilot-wait.spec.ts` (новые)

Только читать: `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/autopilot-modal.css`,
`src/shared/ipc/autopilot.ts`.
