# 15 — Topic Cards

Type: task
Status: claimed 2026-10-31T22:17Z
Branch: worfy-guide/15
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/cards.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

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

- `src/renderer/guide/`, `docs/features/cards.md` — только чтение страниц.

## Итог

Topic `cards` (`src/renderer/guide/topics/cards/`): `spec.ts` с двумя схемами, `Scene.tsx` (простой уровень,
`viewBox` 820×510, 8 блоков, 9 связей, 4 шага проигрывателя), `Flow.tsx` (поток данных в Under the hood, 942×496,
10 блоков, 12 связей, 3 шага), `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts` перед строкой `skeleton`.
`topic.json` сверен с `docs/features/cards.md` на 02be335e (последний commit страницы). Блоки Card на Map of worfy и в
Topic `canvas` уже ведут в `cards`: с этим PR они открывают Topic, а не страницу. Блок Workflow ведёт в Topic `workflow`
(Ticket 11), пока его нет — на `workflow.md`.

Решено без владельца:
- Диалог `Message from a Card` не нарисован отдельным блоком: связи Card → Session и Card → Orchestrator подписаны
  `worfy.ask`, а диалог и кнопку `Send` называет шаг 4. С отдельным блоком диалога его связи к двум Session-ам
  пересекали Card.
- Цвета: Card и CardNode — Tools (как на Map), файлы и данные Card — Machine (папка данных worfy, не репозиторий), Session и
  Claude Code — Agents, Orchestrator — Harness, Canvas MCP — Agents, как блок `mcp` в потоке данных Topic-а Canvas.
- Связь Claude Code → canvas-server.ts подписана «create_card and its writes»: `create_card` — вызов инструмента
  сервера, а Write и Edit сервер не выполняет, он видит их в событиях Session (`editRecorder`) и пишет последнего автора.
- Ключи поиска: `card api`, `canvas mcp`, `create_card`, `window.worfy`. Ключа `card` / `cards` нет. Проверено временным
  test-ом (удалён до commit): для каждой команды `buildCommands` её заголовок и её ключи по-прежнему не отдают первое
  место строке `guide:cards`.

**Утверждения и их источники.** `c.md` = `docs/features/cards.md` на 02be335e.

| Что на схеме или в тексте | Источник |
|---|---|
| Card — маленькое HTML-приложение, которое строит агент, работает в Node-е на Canvas («an HTML app in a Node») | `c.md:3`, `CONTEXT.md:21-22`, `src/renderer/canvas/nodes/CardNode.tsx:15-16` |
| Canvas «one per Project» | `CONTEXT.md:13-14` |
| Orchestrator — «the Project's main Session»; группа Harness | `CONTEXT.md:161-162`, `src/renderer/guide/scene-colours.ts:19-20` |
| Session «the agent that builds it»; агент создаёт Card инструментом и пишет файлы обычными инструментами для файлов («writes the files»), сборки нет (шаг 1) | `c.md:11-14`, `:247`, `src/main/agent/options.ts:488`, `src/main/cards/store.ts:2-3` |
| `create_card` от Session к Canvas MCP; «makes the folder», «makes the Node» (шаг 1; поток: «makes the folder») | `c.md:259`, `:333-334`, `src/main/mcp/canvas-server.ts:199-210` |
| Canvas MCP — «the agent's Canvas tools» | `c.md:246-248`, `src/main/mcp/canvas-server.ts:1-4` |
| Card files — «index.html and the rest»; в потоке `cards/<id>/` в PROJECT DATA FOLDER | `c.md:13`, `:76`, `src/main/cards/store.ts:1-2`, `src/main/cards/protocol.ts:4-5` |
| «runs, reloads on change»; шаг 2: перезагрузка в течение секунды | `c.md:29`, `src/main/cards/store.ts:4`, `src/renderer/canvas/nodes/CardNode.tsx:18-19` |
| Шаг 2: при zoom ниже 0.4 незакреплённая Card показывает заголовок, страница не работает; лимит: с 0.4, закреплённая или в плитке focus mode — при любом zoom | `c.md:21-25`, `src/renderer/canvas/nodes/CardNode.tsx:19-21`, `:30-31` |
| Шаг 3: страница не достаёт до окна worfy и другой Card, в сеть — только https | `c.md:43`, `:50`, `src/main/cards/protocol.ts:8-10`, `:59` |
| Workflow «Epics and Tickets», «read-only snapshot»; шаг 3: читает workflow, изменить не может | `c.md:160-163`, `src/shared/cards/bridge.ts:12`, `src/renderer/canvas/card-bridge.ts:6-7` |
| Saved data «survives a restart», `worfy.data` | `c.md:157-158`, `src/main/cards/data.ts:1-4` |
| Шаг 4 и связи «worfy.ask: the last editor», «or the Orchestrator»: точный текст, только `Send` отправляет; Session, которая правила Card последней, если живая в worfy, иначе Orchestrator | `c.md:168-173`, `src/main/cards/ask.ts:1-5`, `src/main/ipc/card-api.ts:54-57` |
| Summary: страница отделена от worfy, хранит данные, читает workflow, просит отправить сообщение в Session | `c.md:79`, `:155-161`, `src/renderer/canvas/card-bridge.ts:1-7` |
| UTH-поток: колонки CARD PAGE, WINDOW (RENDERER), MAIN PROCESS, CLAUDE CODE над PROJECT DATA FOLDER | `c.md:132-134`, `:231-233`, `:333-336` |
| UTH: Card page «on its own origin»; текст: origin `worfy-card://<card id>.<project label>`, до окна и другой Card не достаёт | `c.md:79-83`, `src/main/cards/protocol.ts:5-11` |
| UTH: CardStore «watches, raises the revision», «after 100 ms of quiet» (шаг 2 потока) | `c.md:30`, `:90-92`, `:132-133`, `src/main/cards/store.ts:17-19`, `:36`, `:287` |
| UTH: `cards.changed` во все окна; CardNode «a new iframe per revision», «new iframe» | `c.md:133-134`, `src/main/ipc/cards.ts:11-12`, `src/renderer/canvas/nodes/CardNode.tsx:133-135` |
| UTH: `worfy-card://` «only the Card's files, CSP», «reads», «files + window.worfy» в начале head каждого HTML-файла | `c.md:85-86`, `:190-192`, `src/main/cards/protocol.ts:13-21` |
| UTH: `postMessage`; card-bridge.ts «checks sender and schema», «answer to its origin»; шаг 3 потока | `c.md:189`, `:193`, `:231-233`, `src/card-runtime/worfy-card.ts:10-12`, `src/renderer/canvas/card-bridge.ts:2-7`, `:91`, `:97` |
| UTH: «data, ask over IPC» в card-api.ts «data, the dialog of worfy.ask»; «saves» в `card-data/<id>.json` | `c.md:193-194`, `:222`, `src/main/ipc/card-api.ts:1-8`, `:97`, `src/main/cards/data.ts:1-2` |
| UTH: canvas-server.ts «Canvas MCP, the last editor»; Claude Code «the Session's agent» | `c.md:229`, `:323`, `src/main/mcp/canvas-server.ts:10-12`, `:324-334` |
| UTH-текст: CSP с каждым файлом; main отказывает в новых окнах и web-разрешениях | `c.md:85-87`, `src/main/cards/protocol.ts:13-17`, `src/main/window.ts:381-383` |
| UTH-текст: последний автор — по вызову инструмента записи файла (Write, Edit…) в папку Card, не по словам агента; Bash не считается | `c.md:198-202`, `src/shared/cards/last-editor.ts:1-4`, `:13-17` |
| Таблица файлов: назначение каждого из семи | `c.md:117-118`, `:126`, `:219`, `:222-223`, `:226`, `:323`; шапки самих файлов |
| Лимит: `worfy.data` до 1 МБ JSON; `worfy.ask` до 10 000 символов, один вопрос на Card, ждёт не больше 10 минут | `c.md:158-159`, `:176-177`, `src/shared/cards/bridge.ts:21`, `:23`, `src/main/cards/ask.ts:11-13`, `:21` |
| Лимит: Find читает до 100 000 символов работающей Card и ждёт 2 секунды | `c.md:57-58`, `src/shared/cards/bridge.ts:25`, `src/renderer/canvas/card-bridge.ts:77` |
| Лимит: папка и данные удалённой Card ждут в Trash Project-а 3 дня | `c.md:60-61`, `src/shared/ipc/trash.ts:13` |

**Снимки** (Playwright против сборки ветки, окно 1280×800; временный spec удалён до commit):
[EN](../evidence/15-cards-en-light.png) / [dark](../evidence/15-cards-en-dark.png),
[RU](../evidence/15-cards-ru-light.png) / [dark](../evidence/15-cards-ru-dark.png),
[подсветка Card](../evidence/15-cards-lit-en-light.png), [шаг 4](../evidence/15-cards-step-en-light.png),
[reduced motion, RU](../evidence/15-cards-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/15-cards-under-the-hood-en-light.png) / [RU](../evidence/15-cards-under-the-hood-ru-light.png),
[таблица файлов и лимиты EN](../evidence/15-cards-under-the-hood-files-en-light.png) / [RU](../evidence/15-cards-under-the-hood-files-ru-light.png),
[подсветка card-bridge.ts на потоке данных](../evidence/15-cards-flow-lit-en-light.png); у каждого есть пара `-dark`.
Контраст текста: каждый видимый текст Topic-а (HTML и подписи SVG обеих схем; от 27 до 42 текстов на снимок) против
самого частого цвета пикселей под ним, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет
ни одного.

**Объём.** EN: простой уровень 64 слова; Under the hood — текст 73, лимиты 71, таблица файлов 58 (вместе около 200,
у пилотных Topic-ов 250–267). RU: 47 и около 170.

**Tokens.** Автор: около 230 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и
написанного). Проверка: ещё не было.
