# 21 — Subagent-ы в правой колонке Session view: новые сверху, `done` — в свёрнутой группе «Done (N)»

Type: task
Status: open
Blocked by: —
Source: слово владельца 2026-10-15 (через Orchestrator-а): «В окне Session (у Orchestrator-а) справа
список subagents. При большом числе он становится огромным. Нужно: subagents со статусом done прятать
в сворачиваемую группу („Done (N)“, по умолчанию свёрнута); порядок списка — от нового к старому».

## Что происходит

Session view — окно одной Session (переключатель Canvas / Session в toolbar). Справа — rail:
колонка блоков из `src/renderer/session/rail/*.tsx` (`rail/index.ts`). Блок Subagent-ов —
`SubagentsRail.tsx` (`order = 20`, `:16`).

- **Все Subagent-ы — одним списком, ничего не свёрнуто.** `SubagentsList` рисует
  `flattenSubagents(tree)` (`src/renderer/session/rail/SubagentsRail.tsx:51-93`, строка — `:52`);
  комментарий прямо говорит «Nothing is folded here» (`:12-13`). У Orchestrator-а за день — десятки
  Subagent-ов, почти все `done`.
- **Порядок — от старого к новому.** Дерево сортирует каждый уровень по времени старта по
  возрастанию (`byStart`, `src/shared/transcript/subagents.ts:625-626`; `settle`, `:724-730`).
  `flattenSubagents` (`:736-738`) кладёт родителя перед детьми.
- **На Canvas `done` уже сворачиваются.** Узлы Subagent-ов у Session: у каждого родителя `done`-дети
  уходят в одну строку «N done» под работающими, клик раскрывает
  (`src/renderer/canvas/sources/subagents.ts:3`, `:138-148`; открытость — `doneExpanded`,
  `toggleDoneSubagents`, `:79-88`). Rail этого правила не знает.
- Дерево общее с Canvas и `ExternalSessionPanel.tsx`: менять порядок в `buildSubagentTree` нельзя —
  сдвинутся Узлы на Canvas.

## Что делаем

1. **Сначала красный unit test** (блок `describe('SubagentsList')`,
   `test/unit/subagent-nodes.test.tsx:346`): дерево из трёх Subagent-ов первого уровня — два `done`,
   один `running` — и одного вложенного. Ожидание: сверху `running`, ниже свёрнутая строка «Done (2)»;
   после клика по ней — оба `done` от нового к старому. На main test красный.
2. **Порядок — от нового к старому — только в rail.** Список строит своя функция в
   `SubagentsRail.tsx` поверх дерева: на каждом уровне — по `startedAt` по убыванию. Вложенные
   остаются под родителем. Subagent без `startedAt` — внизу своего уровня.
3. **Группа «Done (N)».** Предложение (**решение владельца 2026-10-15**):
   - в группу уходят Subagent-ы первого уровня со статусом `done` — вместе со всем своим поддеревом;
   - `error` и `running` остаются в списке над группой: на них нужно смотреть;
   - N — число Subagent-ов первого уровня в группе;
   - по умолчанию свёрнута; открытость — на время работы окна, по Session, не сохраняется на диск;
   - группа — кнопка с `aria-expanded`, как заголовки разделов боковой панели; клавиатура работает.
   Альтернатива — правило Canvas: `done`-дети сворачиваются у каждого родителя, и в rail, и на
   Canvas одинаково (общее состояние `doneExpanded`). Владелец 2026-10-15 выбрал предложение.
4. **Комментарий** `SubagentsRail.tsx:10-13` — по новому правилу.
5. **e2e** `test/e2e/subagent-tree.spec.ts` (`:167-170` ждёт обе строки `done` в rail): открыть группу
   перед проверкой `done`-строк, проверить порядок и свёрнутость по умолчанию.
6. **Снимки** rail с 1 `running`, 1 `error` и 5 `done`: группа свёрнута и открыта, светлая и тёмная
   тема — `.scratch/worfy-polish/evidence/21-*.png`.

## Готово, когда

- [ ] Test пункта 1 красный на main и зелёный с правкой.
- [ ] Мутанты краснят свои test-ы: «группа открыта по умолчанию»; «порядок от старого к новому»;
      «`error` уходит в группу».
- [ ] Узлы Subagent-ов на Canvas не сдвинулись: `placeSubagents` test-ы в `subagent-nodes.test.tsx`
      зелёные без правок их ожиданий.
- [ ] e2e `subagent-tree.spec.ts` зелёный.
- [ ] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/subagent-nodes.test.tsx`, блок `SubagentsList` — порядок, группа, клик, клавиатура.
- e2e `test/e2e/subagent-tree.spec.ts` — rail настоящего Orchestrator-а с fake agent-ом.

## Где в коде

- `src/renderer/session/rail/SubagentsRail.tsx`
- `test/unit/subagent-nodes.test.tsx`
- `test/e2e/subagent-tree.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/transcript/subagents.ts`, `src/renderer/canvas/sources/subagents.ts`,
`src/renderer/session/ExternalSessionPanel.tsx`, `src/renderer/claude-home/subagents.ts`.

## Вне скоупа

- Порядок и свёртка Узлов Subagent-ов на Canvas.
- Блок Limits в том же rail — Ticket 22.
- Стрелка «назад» из окна Subagent-а — Ticket 25.

## Итог

—
