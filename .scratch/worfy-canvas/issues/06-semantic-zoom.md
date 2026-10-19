# 06 — Semantic zoom: три уровня вида Node-а по zoom; заголовок рамки Epic-а постоянного экранного размера

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), решение владельца 11 (semantic zoom — параллельно с токенами);
[ADR-0077](../../../docs/adr/0077-node-kind-tokens.md), пункты 3 и 7 (блок цвета типа на дальнем zoom);
исследование [2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md),
P3, вариант 3c. Код перечитан по main `7dab925f`.

## Что происходит

- На дальнем zoom карточки — мелкие нечитаемые пятна; тип не узнать (снимок владельца, исследование 2.6).
- Свой порог есть только у Card: ниже `LIVE_ZOOM_MIN = 0.4` она не рисует живое содержимое
  (`src/renderer/canvas/nodes/CardNode.tsx:27`).
- `onlyRenderVisibleElements` (`src/renderer/canvas/Canvas.tsx:542`) на дальнем zoom не помогает: видно всё.
- Общие файлы с PR #530 (`worfy-polish/33`): `epic-frame.css`, `nodes/TicketNode.tsx`. Ждать его мержа.

## Что делаем

1. **Уровни** — `src/renderer/canvas/zoom-level.ts` (новый): `full` (zoom ≥ 0.6), `compact` (0.3–0.6),
   `far` (< 0.3). Hook `useZoomLevel()` подписан на уровень, не на zoom: Node перерисовывается только при
   смене уровня (шаблон React Flow «contextual zoom»).
2. **`full`** — карточка как сейчас.
3. **`compact`** — шапка с заголовком и chip статуса, без тела. Рисует `NodeChrome`
   (`src/renderer/canvas/NodeChrome.tsx:60`) по данным шапки типа.
4. **`far`** — блок цвета `band` типа (ADR-0077; нейтральный — у типов без цвета) с крупным заголовком;
   размер шрифта заголовка постоянный на экране (масштаб обратный zoom).
5. **Epic frame** — заголовок и прогресс читаются на любом zoom: на `far` шапка рамки постоянного
   экранного размера, Ticket-ы — блоки без текста (`src/renderer/canvas/nodes/EpicFrameNode.tsx`,
   `src/renderer/canvas/nodes/TicketNode.tsx`).
6. **Card** — порог `LIVE_ZOOM_MIN` заменяется уровнем `full` (одно правило вместо двух).
7. **F-SPEC** — раздел «Zoom levels» (новый): пороги, вид каждого уровня, роли из таблицы Tokens.

## Готово, когда

- [ ] Unit `test/unit/zoom-level.test.tsx`: границы 0.3 и 0.6; смена zoom внутри уровня не перерисовывает
      Node (счётчик рендеров), смена уровня — перерисовывает.
- [ ] e2e `test/e2e/semantic-zoom.spec.ts`: на zoom 0.15 видны имена Epic-ов и тип каждой карточки (текст
      заголовка и атрибут уровня); снимки `zoom-full`, `zoom-compact`, `zoom-far` в обеих темах.
- [ ] Мутант красный: hook подписан на zoom, а не на уровень (счётчик рендеров растёт при панораме zoom).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `zoom-level.test.tsx` на счётчик рендеров.
- Unit `test/unit/zoom-level.test.tsx` (новый); e2e `test/e2e/semantic-zoom.spec.ts` (новый).

## Где в коде

- `docs/design/F-SPEC.md`
- `src/renderer/canvas/zoom-level.ts` (новый)
- `src/renderer/canvas/NodeChrome.tsx` (`:60`)
- `src/renderer/canvas/node-chrome.css`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx`
- `src/renderer/canvas/epic-frame.css`
- `src/renderer/canvas/nodes/CardNode.tsx` (`LIVE_ZOOM_MIN` `:27`)
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `test/unit/zoom-level.test.tsx` (новый)
- `test/e2e/semantic-zoom.spec.ts` (новый)

## Вне скоупа

- Предел числа Node-ов и виртуализация Canvas.
- Цвет Ticket-а — он нейтральный (решение 7).

## Итог

Заполняется при закрытии.
