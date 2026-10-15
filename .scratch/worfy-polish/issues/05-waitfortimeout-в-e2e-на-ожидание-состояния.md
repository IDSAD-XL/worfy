# 05 — 32 `waitForTimeout` в e2e: ожидание состояния или обоснованное окно «ничего не случилось»

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), кандидат R5; `HANDOFF.md`, «Риски и долги» (нестабильные e2e, ложные
таймауты под нагрузкой); [docs/lessons/agents.md](../../../docs/lessons/agents.md).

## Что происходит

- В `test/e2e` 32 вызова `waitForTimeout` в 18 файлах (`grep -rn waitForTimeout test/e2e`, main
  `fff11ba`): `card-runtime` и `ship-ticket` — по 5; `focus`, `terminal-ai-fix`, `linked-cards`,
  `handoff`, `external-session`, `epic-frame` — по 2; остальные десять — по 1.
- Пауза на время бывает двух видов. **Ожидание события** («подождать, пока отрисуется») под нагрузкой
  то коротка (test красный), то лишняя (test медленный). **Окно «ничего не случилось»** («за 500 ms
  файл не изменился») — законная пауза: доказать отсутствие события иначе нельзя.
- С Ticket-ом 04 общих файлов нет: три его файла (`edges`, `binding`, `autopilot`) `waitForTimeout` не
  зовут.

## Что делаем

1. Каждый из 32 вызовов — в одну из двух групп.
2. **Ожидание события** → ожидание состояния: `expect(locator).toBeVisible()` / `toHaveText` /
   `toHaveAttribute`, `expect.poll(...)`, `waitForFunction`, событие окна или файла.
3. **Окно «ничего не случилось»** остаётся, но (а) по возможности короче за счёт «маяка»: после
   проверяемого действия сделать второе, которое точно даёт событие, дождаться его и тогда проверить, что
   первого не было; (б) если маяка нет — комментарий над вызовом: что доказывает пауза и почему её
   длина достаточна.
4. Таблица «файл:строка → группа → что стало» — в «Итог».

## Готово, когда

- [ ] `grep -rn waitForTimeout test/e2e` — только вызовы с комментарием-обоснованием над ними; их число
      и список — в «Итог».
- [ ] Каждый изменённый файл зелёный 5 из 5 под нагрузкой (половина ядер `yes > /dev/null`, как в
      Ticket-е 04); вывод с exit code — в «Итог».
- [ ] Общее время `pnpm test:e2e` не выросло (до и после — в «Итог»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Сами e2e. «Сначала красный» здесь — замер: прогон под нагрузкой до правки, сколько красных
  (допустимо «0 из 5» — тогда правка только убирает лишнее время).
- Мутант на группу «окно»: убрать паузу у одного окна — test должен остаться осмысленным (проверка
  «не было» после маяка) или стать красным, если маяка нет; что вышло — в «Итог».

## Где в коде

- `test/e2e/card-runtime.spec.ts`
- `test/e2e/epic-frame-undo.spec.ts`
- `test/e2e/wheel-over-nodes.spec.ts`
- `test/e2e/focus.spec.ts`
- `test/e2e/done-stack.spec.ts`
- `test/e2e/terminal-ai-fix.spec.ts`
- `test/e2e/terminal-ai-suggest.spec.ts`
- `test/e2e/terminal-ai-next-command.spec.ts`
- `test/e2e/card-drag.spec.ts`
- `test/e2e/linked-cards.spec.ts`
- `test/e2e/handoff.spec.ts`
- `test/e2e/terminal-ai-request.spec.ts`
- `test/e2e/external-session.spec.ts`
- `test/e2e/ship-ticket.spec.ts`
- `test/e2e/subagent-tree.spec.ts`
- `test/e2e/packaged.spec.ts`
- `test/e2e/session-controls.spec.ts`
- `test/e2e/epic-frame.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `test/e2e/helpers.ts` — если
нужен общий helper ожидания, он пишется в своём файле `test/e2e/wait.ts` (исполнитель дописывает его в
список при claim), а не в `helpers.ts`: его правят Ticket-ы 04 и 06.

## Вне скоупа

- `test/e2e/edges.spec.ts`, `binding.spec.ts`, `autopilot.spec.ts` — Ticket 04.
- Паузы в `test/contract` — кандидат R7 отброшен (spec).
- `packaged.spec.ts` гоняется только с `@packaged`; его пауза правится, но прогон — по правилам этого test-а.

## Итог

—
