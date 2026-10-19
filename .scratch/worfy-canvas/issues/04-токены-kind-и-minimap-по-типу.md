# 04 — Токены `kind-*` в F-SPEC и `tokens.css`; Minimap по типу Node-а

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), решения владельца 7 и 8;
[ADR-0077](../../../docs/adr/0077-node-kind-tokens.md) (цвет по типу Node-а: роли `kind-*`), пункты 1–4 и
6; исследование [2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md),
P3, варианты 3a и 3d. Код перечитан по main `7dab925f`.

## Что происходит

- Таблица Tokens F-SPEC (`docs/design/F-SPEC.md:18-40`) — только поверхности, текст, primary и роли
  статусов. Цвета типа нет.
- `tokens.css`: светлая тема — `:root` (`src/renderer/theme/tokens.css:9`), тёмная — `@media
  (prefers-color-scheme: dark)` (`:82-83`).
- Minimap красит Node по `minimapColor` его типа (`src/renderer/canvas/overlays/MiniMapOverlay.tsx:20-23`),
  без него — `--text-muted` (`:17`). Объявляют три типа, все серые: Session — `--text-secondary`
  (`src/renderer/canvas/nodes/SessionNode.tsx:56`), Subagent — `--border-strong` (`nodes/SubagentNode.tsx:22`),
  Note — `--border-strong` (`nodes/NoteNode.tsx:12`). У Orchestrator и Epic frame `minimapColor` нет.

## Что делаем

1. **Токены.** В `tokens.css` для обеих тем: `--kind-orchestrator`, `--kind-session`, `--kind-epic`
   (значение `band`) и `--kind-orchestrator-tint`, `--kind-session-tint`, `--kind-epic-tint` (значение
   `tint`). `--kind-subagent` — ссылка на `--kind-session`. Начальные значения — черновик ADR-0077,
   пункт 2.
2. **F-SPEC.** Строки `kind-orchestrator`, `kind-session`, `kind-subagent`, `kind-epic` в таблицу Tokens —
   с окончательными значениями обеих тем; под таблицей — правило ADR-0077, пункт 3 (где цвет типа можно, где
   нельзя).
3. **Проверка скриптом** — unit `test/unit/kind-tokens.test.ts` читает `tokens.css` и считает по ADR-0077,
   пункт 4:
   - `band` к `surface` и `surface raised` — не меньше 3:1 в обеих темах;
   - текст (`--text`) на `tint` — не меньше 4.5:1;
   - ΔE (CIE76) каждой пары цветов типа под симуляцией протанопии, дейтеранопии и тританопии (Machado
     2009) — не меньше 15.

   Значение, которое не проходит, сдвигается по светлоте в том же оттенке; итог — в F-SPEC и в «Итог».
4. **Minimap.** `minimapColor` из `kind-*`: Session — `var(--kind-session)`, Orchestrator —
   `var(--kind-orchestrator)`, Epic frame — `var(--kind-epic)`; Subagent — контур цвета Session без заливки
   (`nodeStrokeColor` в `MiniMapOverlay.tsx`). Ticket, Note, Card, Terminal, HANDOFF — нейтральные, как
   сейчас.

## Готово, когда

- [ ] Unit `test/unit/kind-tokens.test.ts`: три правила контраста и различимости проходят для обеих тем;
      токен вне таблицы Tokens F-SPEC — красный test (имена `--kind-*` в `tokens.css` и в F-SPEC совпадают).
- [ ] e2e `test/e2e/minimap-kinds.spec.ts`: в Minimap у Session, Orchestrator, Subagent-а и рамки Epic-а
      цвет их роли (вычисленный `fill`/`stroke`); снимок `minimap-kinds` в обеих темах.
- [ ] Мутанты красные: светлый `--kind-session` = Okabe–Ito #56B4E9 (2.31:1); `--kind-epic` тёмной темы =
      цвет ready.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `kind-tokens.test.ts` (токенов ещё нет).
- Unit `test/unit/kind-tokens.test.ts` (новый); e2e `test/e2e/minimap-kinds.spec.ts` (новый).

## Где в коде

- `docs/design/F-SPEC.md` (таблица Tokens `:18-40`)
- `src/renderer/theme/tokens.css` (`:root` `:9`, тёмная тема `:82-83`)
- `src/renderer/canvas/nodes/SessionNode.tsx` (`minimapColor` `:56`)
- `src/renderer/canvas/nodes/SubagentNode.tsx` (`minimapColor` `:22`)
- `src/renderer/canvas/nodes/OrchestratorNode.tsx`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx`
- `src/renderer/canvas/overlays/MiniMapOverlay.tsx` (`:17`, `:20-23`)
- `test/unit/kind-tokens.test.ts` (новый)
- `test/e2e/minimap-kinds.spec.ts` (новый)

## Вне скоупа

- Полоса и иконка в шапке Node-а — Ticket 05.
- Блок цвета типа на дальнем zoom — Ticket 06.

## Итог

Заполняется при закрытии.
