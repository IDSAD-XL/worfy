# 21 — Subagent-ы в правой колонке Session view: новые сверху, `done` — в свёрнутой группе «Done (N)»

Type: task
Status: done 2026-10-15
PR: #364
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

- [x] Test пункта 1 красный на main и зелёный с правкой.
- [x] Мутанты краснят свои test-ы: «группа открыта по умолчанию»; «порядок от старого к новому»;
      «`error` уходит в группу».
- [x] Узлы Subagent-ов на Canvas не сдвинулись: `placeSubagents` test-ы в `subagent-nodes.test.tsx`
      зелёные без правок их ожиданий.
- [x] e2e `subagent-tree.spec.ts` зелёный.
- [x] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

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

Rail строит свой список поверх общего дерева (`src/renderer/session/rail/SubagentsRail.tsx`):
на каждом уровне — от нового к старому по `startedAt`, Subagent без `startedAt` — внизу уровня,
равное время — в порядке дерева. Subagent-ы первого уровня со статусом `done` вместе с поддеревом
уходят в группу «Done (N)» под `running` и `error`; N — число Subagent-ов первого уровня в группе.
Группа — `<button>` с `aria-expanded` и `aria-controls`, Enter и Space работают (e2e). По умолчанию
свёрнута; открытость хранится в памяти окна по ключу `<projectId>/<id Session-а>`, на диск не
пишется. `buildSubagentTree` и Canvas не тронуты.

- Test-ы: `test/unit/subagent-nodes.test.tsx`, блок `SubagentsList` — четыре новых test-а (порядок и
  группа, `error` над группой, Subagent без времени старта, открытость по Session) и старый test
  списка с открытием группы; на main четыре из них красные. Мутанты «группа открыта по умолчанию»,
  «порядок от старого к новому», «`error` уходит в группу» — каждый красит свои test-ы.
- e2e `test/e2e/subagent-tree.spec.ts`: rail Orchestrator-а открывает «Done (1)» перед проверкой
  `done`-строк; новый test — Session с 1 `running`, 1 `error` и 5 `done`: свёрнутость по умолчанию,
  порядок, открытие с клавиатуры, открытость после возврата на Canvas.
- Решено без владельца, подтверждено владельцем 2026-10-16: при Session из одних `done` в rail видна только строка
  «Done (N)», без надписи «No Subagents yet»; ключ открытости — id Session-а Claude Code, поэтому
  у live Session открытость сбрасывается один раз, когда Claude Code даёт ей свой id.

Снимки (группа свёрнута и открыта, светлая и тёмная тема):
[свёрнута, светлая](../evidence/21-subagents-rail-closed-light.png),
[свёрнута, тёмная](../evidence/21-subagents-rail-closed-dark.png),
[открыта, светлая](../evidence/21-subagents-rail-open-light.png),
[открыта, тёмная](../evidence/21-subagents-rail-open-dark.png).

### Gate оркестратора (2026-10-15)

- Wave 3 Epic-а под Autopilot: Ticket-ы 14, 16, 17, 18, 19, 21, 23, 25 параллельно, затем 20 и 15 (их «Готово, когда» требует прогонов под нагрузкой). Один verifier на круг, глубина около low; UI-Ticket-ы — снимки в обеих темах. Worktree — `.claude/worktrees/pol-<NN>`.
- Gate — один круг: `VERIFIED` на head PR ([комментарий в PR #364](https://github.com/IDSAD-XL/worfy/pull/364#issuecomment-6198134740)). Verifier сам: lint и typecheck — 0; `pnpm test` красный только на 15 s timeout-ах в четырёх contract-файлах вне diff, отдельно — 129 passed; `subagent-nodes.test.tsx` — 28 passed (с `SubagentsRail.tsx` из main — 4 failed); пять мутантов красные; `pnpm build` — 0; e2e `subagent-tree.spec.ts` под замком — 6 passed; снимки в обеих темах.
- Merge: `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `b9aeff2`.
- Act on, Consider, Dismissed — нет.
- Noted: [low] самодельный store состояния «группа открыта» (`SubagentsRail.tsx:61-71`), Canvas для того же использует zustand; [low] третья копия SVG chevron (`SubagentsRail.tsx:73-78`) — общий компонент — отдельный Ticket.
- Noted (**решено без владельца, подтверждено владельцем 2026-10-16**): когда все Subagent-ы завершены, видна только строка «Done (N)»; открытое состояние живой Session сбрасывается один раз, когда Claude Code даёт ей id.

Решение владельца 2026-10-16: принято. Session из одних `done` показывает в rail
только строку «Done (N)»; открытость группы у live Session сбрасывается один раз, когда Claude Code
даёт ей id.
