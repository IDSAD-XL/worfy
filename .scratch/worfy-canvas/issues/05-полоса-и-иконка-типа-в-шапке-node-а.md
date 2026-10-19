# 05 — Полоса и иконка типа в шапке Node-а; finished — приглушённая непрозрачность

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), решения владельца 7 и 8;
[ADR-0077](../../../docs/adr/0077-node-kind-tokens.md) (цвет по типу Node-а: роли `kind-*`), пункты 1–3 и
6; исследование [2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md),
P3, вариант 3a. Код перечитан по main `7dab925f`.

## Что происходит

- Все Node-ы, кроме Terminal, — одна поверхность `.w-node-surface` (`src/renderer/theme/tokens.css:167`).
  Тип Node-а виден только по содержимому.
- Обёртка каждого типа — `NodeChrome` (`src/renderer/canvas/NodeChrome.tsx:60`; регистрация —
  `src/renderer/canvas/withNodeChrome.ts`). Шапки — в файлах типов.
- Шапка Epic frame-а с прогрессом — `src/renderer/canvas/nodes/EpicFrameNode.tsx:100`.
- Токены `kind-*` вносит Ticket 04; до его мержа этот Ticket не начинать.
- Общие файлы с PR #530 (`worfy-polish/33`): `src/renderer/canvas/epic-frame.css`. Ждать его мержа.

## Что делаем

1. **Полоса типа** — 4 px сверху шапки цветом `band` своей роли: Orchestrator, Session, Epic frame.
   Subagent — пунктирная полоса цвета Session. Ticket, Card, Note, Terminal, HANDOFF — без полосы.
2. **Фон шапки** — `tint` своей роли у тех же трёх типов.
3. **Иконка типа** в шапке — `src/renderer/canvas/kind-icons.tsx` (новый): Orchestrator — своя, Session —
   prompt `>_`, Subagent — своя, Epic frame — своя; цвет `band`. У иконки `aria-hidden`, тип назван в
   `aria-label` Node-а.
4. **Orchestrator** — двойная рамка (ADR-0077: тип отличается не только цветом).
5. **Finished Session** — непрозрачность Node-а около 60 % и слово в chip-е статуса (как сейчас); оттенок не
   меняется. Наведение и выделение возвращают полную непрозрачность.
6. Текст статуса и chip статуса цвет типа не берут (ADR-0077, пункт 3).
7. **F-SPEC** — раздел «Node header» (новый, после Tokens): полоса, tint, иконка, finished; только роли
   таблицы Tokens.

## Готово, когда

- [ ] Unit `test/unit/node-kind-header.test.tsx`: у Session, Orchestrator, Subagent-а, Epic frame-а —
      полоса и иконка своей роли; у Ticket-а, Card, Note — нет; chip статуса не использует `--kind-*`
      (вычисленный стиль); finished Session — непрозрачность меньше 1 и слово «finished» в chip-е.
- [ ] e2e `test/e2e/node-kinds.spec.ts`: снимки `node-kinds` (Session, Orchestrator, Subagent, Epic frame,
      Ticket рядом) в обеих темах; контраст текста шапки на `tint` — проверка `kind-tokens.test.ts`
      Ticket-а 04 зелёная.
- [ ] Мутант красный: chip статуса Session красится `--kind-session`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit «у Session есть полоса `--kind-session`».
- Unit `test/unit/node-kind-header.test.tsx` (новый); e2e `test/e2e/node-kinds.spec.ts` (новый).

## Где в коде

- `docs/design/F-SPEC.md` (после таблицы Tokens, `:40`)
- `src/renderer/canvas/NodeChrome.tsx` (`:60`)
- `src/renderer/canvas/node-chrome.css`
- `src/renderer/canvas/kind-icons.tsx` (новый)
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `src/renderer/canvas/nodes/SubagentNode.tsx`
- `src/renderer/canvas/nodes/OrchestratorNode.tsx`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx` (шапка `:100`)
- `src/renderer/canvas/epic-frame.css`
- `test/unit/node-kind-header.test.tsx` (новый)
- `test/e2e/node-kinds.spec.ts` (новый)

## Вне скоупа

- Вид Node-а на дальнем zoom — Ticket 06.
- Цвет у Ticket, Card, Note, Terminal, HANDOFF (решение 7).

## Итог

Заполняется при закрытии.
