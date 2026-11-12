# 17 — NumberFlow: проценты limits, context meter, стоимость

Type: task
Status: claimed 2026-11-12T16:53Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 17; «Решения по реализации» (NumberFlow); истории 19, 20; решение
владельца 2026-11-11 «NumberFlow можно»; заметка темы `docs/product/ui-overhaul/notes/inventory-foundation.md`, раздел 2.2

## Что происходит

- Цифры не анимируются: значения просто перерисовываются, от прыжков ширины их держат моноширинные цифры.
- Проценты limits — `limits/LimitBar.tsx` и `shell/toolbar/LimitsMeter.tsx`; заполнение context meter —
  `session/composer/ContextMeter.tsx`; стоимость — `formatCost` в `session/SessionView.tsx:415` и
  `canvas/nodes/OrchestratorNode.tsx:158`.
- Обратный отсчёт Auto-continue (`session/composer/ContinueCountdown.tsx`) меняется каждую секунду внутри
  `role="status"`.

## Что делаем

1. `@number-flow/react` (MIT) точной версией в `dependencies`, версия не моложе суток; install scripts нет. Запись о
   пакете — в ADR Ticket-а 03.
2. `theme/AnimatedNumber.tsx`: одна обёртка над NumberFlow — анимация только при смене значения, не при первом показе;
   при Reduce motion цифры меняются сразу; текст для screen reader-а — итоговое значение.
3. Проценты limits, заполнение context meter и стоимость показываются через неё.
4. Обратный отсчёт Auto-continue не трогается.

## Готово, когда

- [ ] Unit test `test/unit/animated-number.test.tsx`: первый показ без анимации; смена значения анимируется; при Reduce
      motion — сразу; доступный текст — итоговое значение.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/animated-number.test.tsx, 8 tests) · mac - · 6e1b00edeff78a364d5ec615b4dae928de9ea660
- [ ] Существующие `context-meter`, `limits-meter` unit test-ы и e2e `context-meter.spec.ts`, `limits.spec.ts` зелёные.
- [ ] `ContinueCountdown.tsx` не изменён.
  - evidence: commit pass · NumberFlow for the Limits, the context meter and the cost (worfy-ui-kit 17) · - - · 6e1b00edeff78a364d5ec615b4dae928de9ea660
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; e2e test бюджета старта зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6e1b00edeff78a364d5ec615b4dae928de9ea660

## Где в коде

- `package.json`
- `pnpm-lock.yaml`
- `src/renderer/theme/AnimatedNumber.tsx` (новый)
- `src/renderer/limits/LimitBar.tsx`
- `src/renderer/shell/toolbar/LimitsMeter.tsx`
- `src/renderer/session/composer/ContextMeter.tsx`
- `src/renderer/session/SessionView.tsx`
- `src/renderer/canvas/nodes/OrchestratorNode.tsx`
- `test/unit/animated-number.test.tsx` (новый)
- `test/unit/context-meter.test.tsx`
- `test/unit/limits-meter.test.tsx`
- `test/e2e/context-meter.spec.ts`
- `test/e2e/limits.spec.ts`

## Вне скоупа

- Обратный отсчёт Auto-continue, прочие числа.
