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

Сделано по «Что делаем», с отступлениями — причины ниже.

- **Compact рисует не `NodeChrome`** (пункт 3). Каждый тип Node помечает свою строку шапки
  `NODE_HEADER` и заголовок `NODE_TITLE` (`src/renderer/canvas/zoom-level.ts`), а уровни рисует CSS по
  атрибуту `data-zoom-level` корня React Flow (`node-chrome.css`). Причина: шапки типов разные (chip
  статуса, кнопки, путь), и общий `NodeChrome` пришлось бы учить данным каждой шапки; пометка же —
  две строки на тип, и тело остаётся смонтированным (Terminal не теряет pty, Card — состояние).
  Unit test проверяет, что каждый `nodes/*Node.tsx` помечен или стоит в списке исключений.
- **Исключения** (остаются full на любом уровне): Browser (страница — `<webview>` поверх Canvas),
  TicketNode и EpicFrameNode (у них свой far в `epic-frame.css`), BindingAnchorNode (невидимый якорь) и
  DoneShelfNode: полка — ряд chip-ов, размещённых по позиции, без шапки; помечать нечего, а свой far-вид
  полки в этот ticket не входит.
- **Zoom 0.15 недостижим**: нижний zoom Canvas — `ZOOM_MIN` = 0.2 (`src/shared/layout/types.ts`). e2e
  проверяет far на 0.2 и на первом far-шаге (≈ 0.29).
- **Ничто в потоке Node не меняет размер**: скрытое — `visibility: hidden`, шапка остаётся в потоке,
  far-блок и заголовок лежат поверх Node (`position: absolute`). Terminal сохраняет rows и cols — без
  SIGWINCH при смене уровня (e2e сверяет rows и размер экрана на compact и far).
- **Far**: блок рисует `KindBand`, растянутый на Node (цвета задаёт `kind-icons.tsx`); выбранный Node
  обведён `accent`. Шапка рамки Epic не выходит за рамку: шириной рамки, от её верхнего края вниз,
  поверх её Ticket-ов (на far они без текста). Для этого на far рамка поднята над своими Ticket-ами
  (z-index), а мышь пропускает везде, кроме шапки. Имя и chevron — первая строка (имя переносится),
  прогресс — вторая. Известный предел (`shortcut:` в `epic-frame.css`): у рамки ниже шапки на экране
  (свёрнутая; один Ticket и имя в две строки на 0.2) шапка выходит за нижний край.
- **Card** запускает страницу на full, а также закреплённая или в focus tile на любом уровне; длинный
  заголовок Card — в одну строку с «…», целиком в tooltip.
- **Фокус**: поле или кнопка, которые уровень прячет, теряют фокус при смене уровня.
- Мутанты (красные): hook на zoom вместо уровня; `>=` → `>` на 0.6; заголовок обрезан; шапка Terminal
  absolute на far; нет обводки выбора на far; шапка Epic шириной `max-content`; шапка Epic растёт вверх;
  рамка не поднята над Ticket-ами; рамка ловит мышь над Ticket-ами; Card live только на full; нет blur.
