# 04 — Токены `kind-*` в F-SPEC и `tokens.css`; Minimap по типу Node-а

Type: task
Status: done 2026-10-19T21:39Z
PR: #537
Branch: worfy-canvas/04
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

- [x] Unit `test/unit/kind-tokens.test.ts`: три правила контраста и различимости проходят для обеих тем;
      токен вне таблицы Tokens F-SPEC — красный test (имена `--kind-*` в `tokens.css` и в F-SPEC совпадают).
- [x] e2e `test/e2e/minimap-kinds.spec.ts`: в Minimap у Session, Orchestrator, Subagent-а и рамки Epic-а
      цвет их роли (вычисленный `fill`/`stroke`); снимок `minimap-kinds` в обеих темах.
- [x] Мутанты красные: светлый `--kind-session` = Okabe–Ito #56B4E9 (2.31:1); `--kind-epic` тёмной темы =
      цвет ready.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

**Окончательные значения** — черновик ADR-0077, пункт 2, без сдвигов: все правила пункта 4 он проходит.
`tint` в ADR не было — значения подобраны здесь.

| Роль | band, светлая | tint, светлая | band, тёмная | tint, тёмная |
| --- | --- | --- | --- | --- |
| `kind-orchestrator` | #A0527F | #F6EAF1 | #CC79A7 | #2D2028 |
| `kind-session` | #2B8BC6 | #E6F2FA | #56B4E9 | #1B2730 |
| `kind-subagent` | = `kind-session`, только контур | — | = `kind-session` | — |
| `kind-epic` | #9A7A00 | #F6F0D9 | #F0E442 | #2A2716 |

Замеры (`test/unit/kind-tokens.test.ts`): `band` к `surface`/`surface raised` — от 3.35:1 (Session, светлая) до
13.15:1; `--text`, `--text-secondary` и `--text-muted` на `tint` — от 5.11:1 (muted на тёмном tint Epic-а);
наименьшая ΔE пары типов под симуляцией — 18.2 (Orchestrator и Epic, тританопия, светлая). Формулы
проверены на цифрах самого ADR (3.35, 13.15, 18.2 — test «reproduce the figures ADR-0077 recorded»).

**Правило сверх пункта 4 ADR.** Мутант «`--kind-epic` тёмной темы = цвет ready» ни одно правило пункта 4 не
ловит (контраст высокий, ΔE с другими типами большая). Добавлено правило «цвет типа — не цвет статуса»: ΔE
(CIE76, без симуляции) каждого `band` до `--ready-dot/-text`, `--working-dot/-text`, `--blocked-ring/-text` —
не меньше 15 (наименьшее сейчас 23.1: Epic и ready, тёмная). Основание — ADR-0077, пункты 2–3 («оттенки
статусов заняты»). Под протанопией Epic и ready по-прежнему близки (ΔE 8.0) — компромисс пункта 5.

**Мутанты** (в своём worktree, восстановлены из копии): светлый `--kind-session` = #56B4E9 — красный «band
at least 3:1»; тёмный `--kind-epic` = #C8F25A — красный «no status colour»; лишний `--kind-ticket` в
`tokens.css` — красный «declares exactly the --kind-* tokens the table names»; значение в `tokens.css`
не совпадает с F-SPEC — красный «every band and tint has the value of the table».

**Minimap.** Session, Orchestrator, Epic frame — заливка `var(--kind-*)`; Subagent — контур 1.5 px цвета
`--kind-subagent` без заливки (`OUTLINED_KINDS` в `MiniMapOverlay.tsx`; толщина в пикселях экрана,
`vector-effect: non-scaling-stroke` в `minimap.css`). Ticket, Note, Card, Terminal, HANDOFF — как были.
Рамка Epic-а рисуется под своими Ticket-ами: они серые поверх охры.

**Круг 2 ревью.** Функции окраски Minimap вынесены из `MiniMapOverlay.tsx` в
`src/renderer/canvas/overlays/minimap-paint.ts` (файл `.ts` glob overlay-ев `overlays/*.tsx` не подхватывает).
Новый unit `test/unit/minimap-paint.test.tsx` (jsdom, идёт в Linux CI) проверяет по настоящему реестру типов:
заливку по kind, контур Subagent-а без заливки, нейтральные Ticket, Note, Card, Terminal, HANDOFF и
неизвестный kind, класс pinned рядом с классом контура. Он же проверяет текстом `minimap.css`: `stroke-width: 0`
у всех, `vector-effect: non-scaling-stroke` и толщину в px у контура. Мутанты красные: пустой `OUTLINED_KINDS`,
нет `vector-effect`, нет класса pinned, Session снова серый, заливка у Subagent-а. e2e
`test/e2e/pin-tags.spec.ts` ждал у Orchestrator-а заливку по умолчанию `var(--text-muted)`; теперь
`var(--kind-orchestrator)`.

Снимки Minimap: [светлая](../evidence/04-minimap-kinds-light.png), [тёмная](../evidence/04-minimap-kinds-dark.png).
