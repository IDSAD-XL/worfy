# 05 — Полоса и иконка типа в шапке Node-а; finished — приглушённая непрозрачность

Type: task
Status: done 2026-10-21T05:35Z
PR: #657
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

- [x] Unit `test/unit/node-kind-header.test.tsx`: у Session, Orchestrator, Subagent-а, Epic frame-а —
      полоса и иконка своей роли; у Ticket-а, Card, Note — нет; chip статуса не использует `--kind-*`
      (вычисленный стиль); finished Session — непрозрачность меньше 1 и слово «finished» в chip-е.
- [x] e2e `test/e2e/node-kinds.spec.ts`: снимки `node-kinds` (Session, Orchestrator, Subagent, Epic frame,
      Ticket рядом) в обеих темах; контраст текста шапки на `tint` — проверка `kind-tokens.test.ts`
      Ticket-а 04 зелёная.
- [x] Мутант красный: chip статуса Session красится `--kind-session`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Ветка `worfy-canvas/05`. Влит squash-ом c0fb4b32 (PR #657).

- Полоса типа — 4 px сверху шапки цветом `band` своей роли у Orchestrator, Session и Epic frame (у рамки
  — на всю ширину). Subagent — пунктирная полоса цвета Session (`--kind-subagent`). У Ticket, Card, Note,
  Terminal, HANDOFF полосы нет.
- Фон шапки — `tint` своей роли у Orchestrator, Session и Epic frame; у рамки — новый элемент
  `.w-epic__ground` под шапкой, у свёрнутой рамки — на всю рамку. У Subagent-а `tint` нет.
- `src/renderer/canvas/kind-icons.tsx` (новый): `KindIcon`, `KindBand` — иконки Orchestrator, Session
  (`>_`), Subagent, Epic frame. Иконка `aria-hidden`; тип назван в доступном имени Node-а
  (`role="group"`, «Orchestrator», «Session <title>», «Subagent <name>»; у рамки было «Epic <epic>»).
  Иконка Epic-а — внутри тега «Epic» (12 px, отступ 4 px).
- Orchestrator — двойная рамка 3 px; выделение по-прежнему красит её цветом accent.
- Finished Session — 60 % непрозрачности поверхности Node-а и прежний chip «finished»; наведение и
  выделение возвращают 1. Это CSS только Canvas-а (`.w-canvas .react-flow__node`), без inline-стиля и без
  `!important`; плитка focus mode держит свою рамку и показывает finished Session без приглушения.
  Признак finished берётся из состояния Session, не из текста chip-а; закрытая живая Session тоже finished.
- Chip-ы и текст статуса цвет типа не берут.
- `HEADER_CHROME_WIDTH` 470 → 535 (`epic-layout.ts`): замер с запущенным Autopilot — 517.5 px рядом с
  именем, иконка типа включена; рамка с коротким именем теперь шириной в свою шапку.
- F-SPEC: новый раздел «Node header» после таблицы Tokens; размер и место иконки — как сделано.
- Test-ы: новый unit `node-kind-header.test.tsx` (полоса и иконка своей роли у Session, Orchestrator,
  Subagent-а (пунктир), Epic frame-а; нет у Ticket, Card, Note; chip статуса — ни inline, ни вычисленный
  стиль не называет `--kind-*`; finished Session — непрозрачность < 1 и «finished», выделенная — 1; живой
  Session Node: running, new, finished, closed, selected, focus; плитки focus mode; настоящий CSS в порядке
  bundle-а). Новый e2e `node-kinds.spec.ts`: цвета полосы и фона каждого типа в обеих темах против
  значений Tokens из F-SPEC, пунктир Subagent-а, Ticket без полосы, доступные имена, finished 0.6 → 1 при
  наведении → 0.6; снимки `node-kinds` и `node-kinds-finished` в обеих темах. Локаторы группы View в
  e2e — точное совпадение.
- Мутанты: chip статуса Session красится `--kind-session` — 2 unit test-а красные; непрозрачность
  finished 1 — красный; сплошная полоса Subagent-а — красный.
- Круг ревью 1 (high): BLOCK на 3 medium correctness — запас ширины шапки был 5 px, а не 17; двойная
  рамка Orchestrator-а в focus mode; finished Session навсегда приглушена в focus mode — и 2 medium
  пробела test-ов (живой Session Node без test-а). Исправлено вторым коммитом. Круг 2 (medium): PASS.
- Gate full Mac (2026-10-21, b53e179b + PR): e2e один раз красный на `checks-badges.spec.ts:578` — гонка
  в самом test-е, её исправил #659; повтор e2e зелёный, 288 passed.
- Долг (low из ревью) — Ticket [19](19-долг-после-review-wave-3.md).
