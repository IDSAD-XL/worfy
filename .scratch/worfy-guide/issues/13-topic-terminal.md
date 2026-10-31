# 13 — Topic Terminal

Type: task
Status: claimed 2026-10-31T21:42Z
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/terminal.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

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

- `src/renderer/guide/`, `docs/features/terminal.md` — только чтение страниц.

## Итог

Topic `terminal` (`src/renderer/guide/topics/terminal/`): `Scene.tsx` (простой уровень, `viewBox` 900×410, 8 блоков,
10 связей, 5 шагов проигрывателя), `Flow.tsx` (поток данных в Under the hood, 976×496, 8 блоков, 12 связей), обе схемы
в `spec.ts`, как у `autopilot/`; `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts` (ключи поиска
`terminal ai`, `shell`, `zsh`). `topic.json` сверен с `docs/features/terminal.md` на a36324a0 — последний commit
страницы. Блок Terminal на Map of worfy и на схеме Topic-а Canvas теперь открывает этот Topic. Блок Canvas на схеме
ведёт в Topic `canvas`, блок Limits — в Topic `sessions` (как на Map); остальные блоки только подсвечиваются.

Решено без владельца: Topic охватывает обе Feature страницы — Terminal и Terminal AI. Цвета: Terminal, его shell и
Terminal AI — группа `tools` (`scene-colours.ts`: «Cards, the Terminal, the Browser»), Claude Code — `agents`, Limits и
«Another screen» (окно или Linked machine с доступом на запись) — `machine`, как на Map; в Under the hood то, что main только хранит или
считает для shell-а (ReplayBuffer, headless-экран), — нейтральный `machine`. Блок Claude Code не ведёт в Topic Sessions:
процесс Terminal AI — не Session. Про историю Git Bash на Windows Topic молчит: запись истории после каждой команды —
открытый worfy-windows 118, не сделано.

Ключи поиска проверены временным test-ом через `rankItems(buildCommands(…))` (удалён до commit): ни одна команда
палитры не уступает первое место строке Guide по своим словам и ключам; `terminal` по-прежнему находит сначала
`new:terminal`, Guide: Terminal — вторым; `terminal ai`, `shell`, `zsh` других команд не находят (у `shell` ниже идут
только нечёткие совпадения First-run checks и Archive finished sessions).

**Утверждения и их источники.** `t.md` = `docs/features/terminal.md` на a36324a0. «UTH» — Under the hood.

| Что на схеме или в тексте | Источник |
|---|---|
| Terminal — Node на Canvas с вашим shell; агенты им не пользуются (summary, «your shell; agents do not use it») | `t.md:3`, `:10`, `CONTEXT.md:41-42` |
| Terminal AI — помощь модели Claude, предлагает текст для строки ввода; только zsh (summary, «zsh only») | `t.md:3-4`, `:170`, `:271`, `CONTEXT.md:219-220` |
| «never runs a command»; шаг 4 «Enter stays with you» | `t.md:170`, `src/main/terminal-ai/fix.ts:1-3`, `src/main/terminal-ai/protocol.ts:15` |
| Canvas: «New terminal in its menu»; шаг 1: New terminal в меню Canvas создаёт Node | `t.md:12`, `src/renderer/canvas/nodes/TerminalNode.tsx:86`, `src/renderer/canvas/overlays/CanvasMenu.tsx:4` |
| Project folder «the root of the Project», связь «starts in»; шаг 1: shell стартует в папке Project-а | `t.md:13-14`, `src/main/ipc/terminal.ts:3-4`, `src/main/terminal/pty.ts:4-5` |
| Shell «login shell; PowerShell on Windows»; шаг 1: login shell на macOS, PowerShell или Git Bash на Windows | `t.md:17`, `:65-71`, `src/main/terminal/pty.ts:5-7` |
| Связи «your keys» и «output» между Node и shell | `t.md:143-148`, `src/shared/ipc/terminal.ts:4-7`, `:129`, `:146` |
| Шаг 2: shell работает, когда Node не виден или окно перезагружено; следующий вид перерисовывает последний вывод; закрытие Node-а завершает shell | `t.md:20-22`, `:14-15`, `src/main/terminal/pty.ts:8-9`, `src/main/ipc/terminal.ts:6-8` |
| «Another screen: a window, or a Linked machine with write access» (и описание схемы: «a window or a Linked machine with write access, opens the same shell»), «the same shell»; шаг 3: окна и Linked machine с доступом на запись видят тот же shell и печатают; размер — у экрана, который печатал или кликал последним | `t.md:40-43`, `:48`, `src/main/ipc/terminal.ts:10-13`, `src/shared/ipc/terminal.ts:140` |
| Связи «the line» и «grey text» между shell и Terminal AI; шаг 4: серый текст после курсора из истории или от Claude, → принимает | `t.md:174-179`, `:186`, `:300-303`, `src/main/terminal-ai/protocol.ts:13`, `src/main/terminal-ai/socket.ts:1-2` |
| Связь «Fix, ⌘I» из Node-а в Terminal AI; шаг 5: Fix в шапке после упавшей команды просит исправленную команду и вставляет её в строку | `t.md:203-208`, `:222-226`, `:302-303`, `src/main/terminal-ai/fix.ts:1-6`, `src/renderer/canvas/nodes/TerminalNode.tsx:74`, `src/shared/ipc/terminal-ai-request.ts:1` |
| Claude Code «one turn per request, no tools», связь «asks» | `t.md:277-283`, `src/main/terminal-ai/assist.ts:1-7` |
| Limits «5-hour and 7-day windows», связь «reports the Limits» | `t.md:243`, `src/main/terminal-ai/assist.ts:23-25`, `src/shared/agent/limits.ts:1` |
| Связь «may pause it»; шаг 5: у порога Limits автоматический серый текст (Suggestion, Next command) встаёт на паузу до сброса окна, а Fix останавливается, только когда Limits отказывают (`rejected`) | `t.md:243-251`, `src/main/terminal-ai/limits-gate.ts:5-12`, `src/main/terminal-ai/assist.ts:346` |
| UTH-схема: Terminal Node «xterm.js, 5000 lines» | `t.md:22`, `:136`, `src/renderer/canvas/nodes/TerminalNode.tsx:267` |
| UTH-схема: TerminalRegistry «start, subscribers, size»; «open, input» (каналы `terminal.open` и `terminal.input`), «terminal.output», «writes», «chunks» | `t.md:127`, `:143-148`, `src/main/terminal/pty.ts:339`, `src/shared/ipc/terminal.ts:4-7`, `:64`, `:129`, `:146`, `src/main/terminal/pty.ts:814` |
| UTH-схема: ReplayBuffer «last 256 KB, with sizes» (стоит под TerminalRegistry), связь «appends» | `t.md:21-22`, `:130`, `:145`, `src/main/terminal/replay-buffer.ts:1-4`, `:13` |
| UTH-схема: Headless screen «in a worker thread», «posts», «answers once» | `t.md:91-96`, `:146`, `src/main/terminal/cursor-answers.ts:14-23`, `:37-40`, `src/main/terminal/pty.ts:574-578` |
| UTH-схема: «ask, Unix socket», ShellLink «routes an ask to its function», «show, insert» | `t.md:300-303`, `:325`, `src/main/terminal-ai/shell-link.ts:1-8`, `src/main/terminal-ai/socket.ts:1-2`, `src/main/terminal-ai/protocol.ts:13-15` |
| UTH-схема: AssistService «one request in flight», «request»; Claude Code «spare process, one turn» | `t.md:281-286`, `:341-343`, `src/main/terminal-ai/assist.ts:5-14`, `:269` |
| UTH-схема: «terminalAi.fix.run» из Node-а в AssistService | `t.md:345-347`, `src/shared/ipc/terminal-ai-fix.ts:42`, `src/main/terminal-ai/fix.ts:11-14` |
| UTH-текст: main владеет shell-ом, вид только рисует; shell переживает вид, несколько экранов делят один; renderer называет Project и Node, не папку и не программу | `t.md:82-85`, `src/main/ipc/terminal.ts:3-5` |
| UTH-текст: скрипт worfy в zsh отмечает prompt и команды OSC 633 с nonce, которого программы не знают | `t.md:97-102`, `src/main/terminal/osc.ts:3-15` |
| UTH-текст: Terminal AI — не Session; у его процесса Claude Code нет tools и транскрипта | `t.md:277-279`, `src/main/terminal-ai/assist.ts:1-3`, `CONTEXT.md:220` |
| Таблица файлов: назначение каждого из шести | `t.md:125-136`, `:316`, `:325`; шапки самих файлов |
| Лимит: 256 КБ вывода для следующего вида, 5000 строк scrollback | `t.md:21-22`, `src/main/terminal/replay-buffer.ts:13`, `src/renderer/canvas/nodes/TerminalNode.tsx:267` |
| Лимит: 5 с Suggestion, 8 с Next command, 30 с Command request и Fix | `t.md:288-293`, `src/main/terminal-ai/options.ts:25` |
| Лимит: Suggestion и Next command — пауза выше 80 % окна на 5 часов или при `allowed_warning`; Command request и Fix — только на `rejected` | `t.md:246-248`, `src/main/terminal-ai/limits-gate.ts:5-7`, `:20` |

**Снимки** (Playwright против сборки head-а доработки 430b5d14, версия в toolbar `0.3.0+430b5d14` без `.dirty`, окно
1280×800, у каждого пара `-dark`): [EN](../evidence/13-terminal-en-light.png), [RU](../evidence/13-terminal-ru-light.png),
[подсветка Terminal AI](../evidence/13-terminal-lit-en-light.png), шаг 5 [EN](../evidence/13-terminal-step-en-light.png) /
[RU](../evidence/13-terminal-step-ru-light.png), [reduced motion, RU](../evidence/13-terminal-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/13-terminal-under-the-hood-en-light.png) / [RU](../evidence/13-terminal-under-the-hood-ru-light.png),
[таблица файлов и лимиты EN](../evidence/13-terminal-under-the-hood-files-en-light.png) / [RU](../evidence/13-terminal-under-the-hood-files-ru-light.png),
на потоке данных подсветка TerminalRegistry [EN](../evidence/13-terminal-flow-lit-en-light.png) /
[RU](../evidence/13-terminal-flow-lit-ru-light.png), ShellLink [EN](../evidence/13-terminal-flow-lit-ai-en-light.png) /
[RU](../evidence/13-terminal-flow-lit-ai-ru-light.png) и Terminal Node [EN](../evidence/13-terminal-flow-lit-node-en-light.png) /
[RU](../evidence/13-terminal-flow-lit-node-ru-light.png). Контраст текста: каждый видимый текст Topic-а (HTML, подписи
блоков, областей и связей обеих схем) против своего фона, обе темы, EN и RU, без подсветки и с подсветкой блоков обеих
схем — 24 замера по 114–115 текстов, минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет ни одного.

**Доработка после REJECTED (PR #1164, ревью medium, 2 medium + 2 low).** Шаг 5 в EN и RU сужен: у порога Limits
встаёт на паузу только автоматический серый текст, Fix останавливается, только когда Limits отказывают
(`t.md:246-248`, `limits-gate.ts:5-7`). В Under the hood ReplayBuffer перенесён под TerminalRegistry, связь «appends»
идёт вниз, а «posts» — из верхней кромки registry прямо к headless-экрану, не задевая другие блоки; колонка main
сдвинута на 20 единиц вправо, подпись «terminal.open, input» сокращена до «open, input», так что подпись больше не
закрывает наконечник стрелки. «Another screen» в подписи блока и в описании схемы — «a Linked machine with write
access» (`t.md:48`: Linked machine с доступом только на чтение Terminal не получает). Снимки сняты заново, все.

**Tokens.** Автор: около 230 тыс. токенов контекста за первый раунд и около 50 тыс. за доработку (точного счётчика у
агента нет; оценка по объёму прочитанного и написанного). Проверка: оценку ревьюера даёт Orchestrator.
