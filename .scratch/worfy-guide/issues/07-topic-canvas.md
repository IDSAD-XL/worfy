# 07 — Topic Canvas

Type: task
Status: done 2026-10-31T20:23Z
PR: #1158
Blocked by: 05
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/canvas.md`, `docs/features/epic-frames.md`, `docs/features/focus-mode.md` до одного экрана. Страницы остаются источником и полной версией.

## Что делаем

1. Простой уровень: живая схема и короткий текст, понятный без знания кода. Объём судит автор по этому Feature: текст должен читаться быстро, но его не режут под число слов (Q5).
2. Under the hood, свёрнут: техническая схема потока данных, короткий текст, таблица главных файлов и важные лимиты.
3. Английский и русский в одном PR; технические термины и названия UI по-английски.
4. Страницы-источники и их SHA в реестре Topic-ов.

## Готово, когда

- [ ] Каждое утверждение и подпись на схемах сверены с кодом вторым агентом.
- [ ] Снимки: обе темы, оба языка, reduced motion, развёрнутый Under the hood, в `.scratch/worfy-guide/evidence/`.
- [ ] Topic читается быстро: второй агент называет места, которые можно убрать.
- [ ] Tokens автора и проверки в `## Итог`.

## Тесты

Новых нет: test-ы реестра из Ticket-а 03 покрывают Topic.

## Где в коде

- `src/renderer/guide/`, `docs/features/canvas.md`, `docs/features/epic-frames.md`, `docs/features/focus-mode.md` — только чтение страниц.

## Итог

Topic Canvas — `canvas` (`src/renderer/guide/topics/canvas/`), строка в `registry.ts` после Map of worfy; блок Canvas
на Map теперь ведёт в этот Topic. Схема `Scene.tsx` и `spec.ts` (`viewBox` 940×470, 13 блоков, 5 связей, 3 шага), схема потока
данных `Flow.tsx` в Under the hood (960×430, 8 блоков, 10 связей, 4 шага), тексты EN и RU, 10 главных файлов,
4 ограничения. `topic.json` сверен с `docs/features/canvas.md`, `epic-frames.md`, `focus-mode.md` на e3c54550.

**Общий слой для Topic-ов пилота** (по слову Orchestrator-а, отдельными commit-ами до Topic-а, 06 и 08 строятся на
них): у Topic-а может быть `Flow.tsx` — вторая схема, первой внутри свёрнутого Under the hood, с текстами
`underTheHood.flow` (`description`, `labels`) в обоих языках (`content.ts`, `GuideWindow.tsx`; test
`guide-content` требует файл и ключ вместе). У схемы свой `data-testid` (`guide-flow`), группа называется строкой
Guide `dataFlow` («Data flow» / «Поток данных»). Тестовый Topic получил маленький `Flow.tsx` как образец для test-ов
окна. Test-ы окна, Map и палитры берут список Topic-ов из реестра, а не перечисляют руками: новый Topic их не красит.
e2e «the diagram moves its dots only while…» теперь видит и вторую схему: развёрнутая и в поле зрения, она движется,
а схема Topic-а вне поля зрения стоит; шаг «ни одного кадра» остался для закрытого Guide. В Command palette строка
Guide уступает команде, найденной тем же видом совпадения (`yields` в `search-index.ts`): «canvas» находит Switch to
Canvas раньше «Guide: Canvas»; между видами совпадения порядок прежний.

**Слова поиска Topic-а** — только `done shelf` и `focus mode`: по каждому палитра находит одну строку «Guide: Canvas».
`node` (обгонял любой Node), `layout` (ключ Tidy up) и `epic frame` (рядом с ключом Re-pack `epic frames`) убраны.
Проверено разовым test-ом на контексте `palette-commands.test.tsx`: «canvas» → Switch to Canvas, Guide: Canvas;
«layout» → Tidy up; «epic frames» → Re-pack.

**Снимки** (Playwright, окно 1280×800, обе темы каждый раз):
[EN](../evidence/07-canvas-en-light.png) ([dark](../evidence/07-canvas-en-dark.png)),
[RU](../evidence/07-canvas-ru-light.png) ([dark](../evidence/07-canvas-ru-dark.png)),
[подсвечен Ticket 01](../evidence/07-canvas-lit-en-light.png) ([dark](../evidence/07-canvas-lit-en-dark.png)),
[шаг 3](../evidence/07-canvas-step-en-light.png) ([dark](../evidence/07-canvas-step-en-dark.png)),
[reduced motion, RU](../evidence/07-canvas-reduced-motion-ru-light.png) ([dark](../evidence/07-canvas-reduced-motion-ru-dark.png)),
Under the hood развёрнут: [схема EN](../evidence/07-canvas-under-the-hood-en-light.png)
([dark](../evidence/07-canvas-under-the-hood-en-dark.png)), [схема RU](../evidence/07-canvas-under-the-hood-ru-light.png)
([dark](../evidence/07-canvas-under-the-hood-ru-dark.png)), [файлы и лимиты EN](../evidence/07-canvas-under-the-hood-files-en-light.png)
([dark](../evidence/07-canvas-under-the-hood-files-en-dark.png)), [файлы и лимиты RU](../evidence/07-canvas-under-the-hood-files-ru-light.png)
([dark](../evidence/07-canvas-under-the-hood-files-ru-dark.png)), [подсвечен LayoutStore](../evidence/07-canvas-flow-lit-en-light.png)
([dark](../evidence/07-canvas-flow-lit-en-dark.png)).

**Контраст.** Одноразовый spec (не в PR) мерил каждый видимый текст Topic-а — подписи схем, абзацы, таблицу, лимиты,
кнопки — против самого частого пикселя под ним на снимке, в обеих темах, во всех состояниях выше: 494 замера, минимум
5,6:1 (светлая тема, `--text-muted` на `--canvas`: подпись вкладки «drawn from the workflow» и подписи областей).
Погашенные при подсветке блоки (прозрачность 0,2 по стилю Living Canvas) не мерились.

**Утверждения и их источники** (страницы — `docs/features/*.md` на e3c54550; код — на 0fdcfad7):

| Что на схеме или в тексте | Источник |
|---|---|
| Canvas — бесконечная плоскость, одна на Project («one per Project») | `canvas.md:12`; `CONTEXT.md:13-14`; `src/main/layout/store.ts:374` (`layout.json` в папке Project-а) |
| Всё на ней — Node (на схеме: Session, Card, Terminal, Browser, Note, картинка) | `CONTEXT.md:17-18`; `src/renderer/canvas/nodes/SessionNode.tsx:59`, `CardNode.tsx:26`, `TerminalNode.tsx:81`, `BrowserNode.tsx:69`, `NoteNode.tsx:10`, `ImageNode.tsx:23` |
| Node-ы не перекрываются | `canvas.md:81`; `src/shared/layout/free-place.ts:1-2`, `:12` |
| выравниваются («snap into line») | `canvas.md:87-89`; `src/renderer/canvas/snapping.ts:8-10` |
| ⌘Z отменяет перемещение | `canvas.md:115`; `src/renderer/canvas/history.ts:1` |
| Epic — рамка своих Ticket-ов, по колонкам «что кого блокирует» (Level 1 … n по `Blocked by`) | `epic-frames.md:11`, `:23`; `src/renderer/canvas/epic-layout.ts:6-8`, `:181` |
| Готовый Epic со свёрнутой рамкой — плашка на Done shelf | `epic-frames.md:106`; `src/renderer/canvas/epic-layout.ts:638-639`; `src/renderer/canvas/sources/epics.ts:26-28` |
| Выделить Node-ы и ⌘↩ открывает focus mode | `focus-mode.md:12`; `src/shared/shortcuts.ts:91`; `src/renderer/canvas/overlays/FocusEntry.tsx:1-2` |
| Плитки рядом, в них Node работает | `focus-mode.md:3`, `:70`; `src/renderer/focus/FocusMode.tsx:1`, `:12-13` |
| Canvas под focus mode остаётся как был | `focus-mode.md:4`, `:128`; `src/renderer/focus/FocusMode.tsx:7-10` |
| Вкладка «Epic frame», «drawn from the workflow» | `epic-frames.md:11`; `src/renderer/canvas/sources/epics.ts:1-4` |
| Плашка «Ready wave · 1» над колонкой Level 1, Ticket 01 (test `guide-canvas.test.tsx`) | `epic-frames.md:26`; `src/renderer/canvas/nodes/EpicFrameNode.tsx:137-140`; `src/renderer/canvas/epic-layout.ts:352` |
| Ticket 01 «Level 1: ready now» → Ticket 02 «Level 2: Blocked by 01», связь «blocks» от блокирующего к блокируемому | `epic-frames.md:23`, `:26`; `src/renderer/canvas/edges/blocking.ts:1-2` |
| Ticket 01 → Ready wave «ready now» | `epic-frames.md:26`; `src/renderer/canvas/epic-layout.ts:102`, `:352` |
| «Done shelf: ✓ old-epic 4/4» — плашка другого, готового Epic-а; связи к ней нет: Epic уходит на полку целиком, когда все его Ticket-ы готовы и рамка свёрнута (шаг 2) | `epic-frames.md:106`, `:109`, `:118`; `src/renderer/canvas/nodes/DoneShelfNode.tsx:3`; `epic-layout.ts:638-639` |
| Session «one Claude Code conversation» | `CONTEXT.md:157-158` |
| Card «an HTML app an agent built» | `CONTEXT.md:21-22` |
| Terminal «your shell» | `CONTEXT.md:41-42` |
| Browser «built-in Chromium» | `CONTEXT.md:45-46` |
| Note «double-click the plane» | `canvas.md:38`; `src/renderer/canvas/Canvas.tsx:368-375` |
| Image «pasted or dropped» | `canvas.md:302-304`; `src/renderer/canvas/overlays/ImageDrop.tsx:1-3` |
| «A LAYER OVER IT»: focus mode — слой над Canvas; Session, Card, Terminal → Focus mode «⌘↩», «the selection as tiles» | `focus-mode.md:3`, `:22`; `src/renderer/focus/FocusMode.tsx:1-2`; `src/shared/shortcuts.ts:91` |
| Шаг 2: готовые сейчас образуют Ready wave | `epic-frames.md:26`; `epic-layout.ts:102` |
| Under the hood, текст: Layout — места и размеры Node-ов, пишет только main | `canvas.md:164`; `CONTEXT.md:25-26`; `src/renderer/canvas/history.ts:3` |
| Flow, шаг 1: окно двигает Node сразу и отправляет операцию по IPC (`layout.apply`) | `canvas.md:207`; `src/renderer/canvas/Canvas.tsx:250`; `src/renderer/canvas/useLayout.ts:95-98`; `src/shared/ipc/layout.ts:23` |
| Flow, шаг 2: Canvas MCP tools агента вызывают тот же `LayoutStore.apply` («the same operations») | `canvas.md:164-165`; `src/main/mcp/canvas-server.ts:1-4`, `:176` |
| Flow, шаг 2: LayoutStore проверяет операцию и отодвигает Node от соседей («checks, keeps Nodes apart») | `canvas.md:208`; `src/main/layout/store.ts:420-428`, `:110-115` |
| Flow, шаг 3: сохраняет `layout.json` в папке данных worfy через 250 ms тишины | `canvas.md:208-209`; `src/main/layout/store.ts:66`, `:74`, `:374`, `:551-554`; `CONTEXT.md:25-26` |
| Flow, шаг 3: каждое окно получает `layout.changed` и берёт самую новую revision | `canvas.md:209-210`; `src/main/ipc/layout.ts:20`; `src/shared/ipc/layout.ts:74`; `src/renderer/canvas/useLayout.ts:22-28` |
| Текст: отклонённая операция возвращает Node-ы на место | `canvas.md:210`; `src/renderer/canvas/Canvas.tsx:188-190` |
| Flow, шаг 4: Epic frame-ы и Ticket-ы не хранятся, вычисляются из workflow; ELK раскладывает рамку в Web Worker | `epic-frames.md:66-67`, `:72`; `src/renderer/canvas/sources/epics.ts:1-4`; `src/renderer/canvas/elk/client.ts:61` |
| Текст: Layout хранит только сдвиг рамки и `collapsed` | `epic-frames.md:72-74`; `src/renderer/canvas/sources/epics.ts:4-10` |
| Undo живёт в окне, каждый экран отменяет только свои жесты | `canvas.md:171`; `src/renderer/canvas/history.ts:21-22` |
| Focus mode — дерево разбиений в памяти, операций Layout не шлёт | `focus-mode.md:153-156`; `src/renderer/focus/split-tree.ts:1-2`; `src/renderer/focus/FocusMode.tsx:7-10` |
| Flow: области WINDOW (RENDERER) и MAIN PROCESS; React Flow «moves the Node at once» → useLayout «operation» | `canvas.md:207`; `src/renderer/canvas/Canvas.tsx:246-250` |
| useLayout → React Flow «Nodes»; «keeps the newest revision» | `src/renderer/canvas/Canvas.tsx:162-163`; `src/renderer/canvas/useLayout.ts:22-28` |
| useLayout → LayoutStore «layout.apply»; LayoutStore → useLayout «layout.changed» | `src/renderer/canvas/useLayout.ts:98`; `src/main/ipc/layout.ts:20` |
| LayoutStore → layout.json «after 250 ms of quiet»; «in worfy's data folder» | `src/main/layout/store.ts:66`, `:74`, `:374`, `:551-554` |
| Workflow model «main reads the Tickets» → sources/epics.ts «workflow.changed» | `src/main/workflow/reader.ts:1-3`; `src/renderer/workflow/useWorkflow.ts:78`; `src/renderer/canvas/sources/epics.ts:38` |
| sources/epics.ts «frames, computed» → ELK «layout request», ELK → epics «places»; ELK «in a Web Worker» | `src/renderer/canvas/sources/epics.ts:1-4`, `:40`; `src/renderer/canvas/elk/client.ts:61`, `:98` |
| sources/epics.ts → React Flow «frames, Tickets» | `epic-frames.md:91-92`; `src/renderer/canvas/Canvas.tsx:162` |
| Файл: `store.ts` — применяет или отклоняет, разводит, сохраняет | `canvas.md:187`; `src/main/layout/store.ts:420-428` |
| Файл: `types.ts` — Node, Layout, операции и лимиты | `canvas.md:184` |
| Файл: `free-place.ts` — одно правило для main и превью перетаскивания | `canvas.md:168-169`; `src/shared/layout/free-place.ts:1-7` |
| Файл: `canvas-server.ts` — Canvas MCP tools | `src/main/mcp/canvas-server.ts:1-4` |
| Файлы: `Canvas.tsx`, `useLayout.ts`, `history.ts` | `canvas.md:194-195`, `:202`; `src/renderer/canvas/useLayout.ts:95` (`sendLayoutOp`) |
| Файлы: `sources/epics.ts` (рамки, Ticket-ы, Done shelf), `epic-layout.ts` (размеры, Level-ы, полоса, Done shelf) | `epic-frames.md:80-81`, `:141-142` |
| Файл: `FocusMode.tsx` — слой, плитки, Esc | `focus-mode.md:181-182` |
| Лимит: zoom от 0.2 до 2.5; координаты до ±10 000 000 | `canvas.md:41`, `:212`; `src/shared/layout/types.ts:10-11`, `:18` |
| Лимит: зазор 16; притяжение в пределах 6 пикселей экрана, иначе сетка 8 | `canvas.md:81`, `:87-89`; `src/shared/layout/free-place.ts:12`; `src/renderer/canvas/snapping.ts:23`, `:26` |
| Лимит: ⌘Z — 40 шагов жестов этого экрана; агента и другого экрана там нет | `canvas.md:115-116`; `src/renderer/canvas/history.ts:11-13`, `:21-22`, `:48` |
| Лимит: Trash держит 3 дня; архив Session Node-ов через 24 ч по умолчанию, а при готовом Ticket — через час после последней записи; ничего не удаляется | `canvas.md:122`, `:129`, `:131`; `src/main/layout/archive.ts:55`, `:197`; `src/shared/ipc/trash.ts:13`; `src/shared/settings/app-settings.ts:141`; `src/main/layout/archive.ts:3`, `:71` |

**Цвета групп** (`scene-colours.ts`). Своей группы у кода worfy нет: окно (React Flow, useLayout), LayoutStore,
`layout.json`, ELK в Web Worker и focus mode нарисованы самой нейтральной группой, Machine. Canvas — Project,
Ticket-ы, рамки, плашки, модель workflow и `sources/epics.ts` — Workflow, Session и Canvas MCP tools — Agents, Card,
Terminal, Browser, Note и картинка — Tools.

**Раунд доработки** (ревью #1158, REJECTED: 2): стрелка от Ticket 02 к Done shelf убрана, плашка Ready wave стоит над
колонкой Level 1 (test `test/unit/guide-canvas.test.tsx`, красный, если плашку вернуть на x 300), цвета групп, правило
архива «через час после готового Ticket», сокращения текста (список Node-ов в summary, абзацы 1–2 Under the hood,
лимит Read only), test-ы нижних уровней `tierOf` и места Flow сразу после summary.

**Tokens.** Автор: точного счётчика у агента нет; Orchestrator берёт число из отчёта агента. Ревью: около 110 тысяч на
Topic и около 90 тысяч на общий слой (по словам Orchestrator-а).
