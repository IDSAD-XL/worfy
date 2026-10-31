# 08 — Topic Sessions

Type: task
Status: open
Blocked by: 05
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/sessions.md`, `docs/features/transcripts-and-usage.md` до одного экрана. Страницы остаются источником и полной версией.

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

- `src/renderer/guide/`, `docs/features/sessions.md`, `docs/features/transcripts-and-usage.md` — только чтение страниц.

## Итог

Topic `sessions` (`src/renderer/guide/topics/sessions/`): `Scene.tsx` (простой уровень, `viewBox` 976×500, 10 блоков,
10 связей, 5 шагов проигрывателя), `Flow.tsx` (поток данных в Under the hood, 976×476, 10 блоков, 12 связей, по контракту
Ticket-а 07: `underTheHood.flow`), `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts`. `topic.json` сверен с
`docs/features/sessions.md` (7f869dfe) и `docs/features/transcripts-and-usage.md` (6fb2efec). Блоки Map-а Session,
Subagent и Limits теперь открывают этот Topic. Блок Canvas на схеме ведёт в Topic `canvas` (Ticket 07), пока его нет —
на страницу `canvas.md`. Остальные блоки только подсвечиваются: своих Topic-ов у них нет.

Решено без владельца: на схеме простого уровня Claude Code — отдельный блок вне Canvas (процесс, который worfy запускает
на Session), а «Outside worfy» — терминал или Claude desktop. В Under the hood блок Claude Code стоит в колонке
«CLAUDE CODE», хотя query SDK живёт в main process: колонка показывает процесс Claude Code, который query запускает.
Связь `rate_limit_event` идёт из Session в LimitsTracker: в коде её снимает обёртка query (`observe`), а не сама Session.

**Утверждения и их источники.** `s.md` = `docs/features/sessions.md` на 7f869dfe, `t.md` =
`docs/features/transcripts-and-usage.md` на 6fb2efec.

| Что на схеме или в тексте | Источник |
|---|---|
| Session — один разговор с Claude Code | `CONTEXT.md:157-159`, `s.md:3` |
| worfy запускает свои Session-ы сам, у каждой один Node на Canvas (подпись «one Node per Session» у Canvas) | `s.md:11`, `src/renderer/claude-home/session-nodes.ts:1-3` |
| Orchestrator — главная Session Project-а | `CONTEXT.md:161-163`, `src/main/agent/orchestrator.ts:1`, `:610-618` |
| Session-ы из терминала или Claude desktop видны только для чтения; блок «Read-only Session», «started outside worfy»; «Outside worfy: a terminal or Claude desktop» | `s.md:17`, `src/renderer/claude-home/session-nodes.ts:7-11`, `:36-37`, `t.md:80-82` |
| Claude Code хранит разговор в файле в своей папке (Claude home, `~/.claude`, «with the transcripts»); «writes the file» | `t.md:77`, `:85`, `:108`, `src/main/claude-home/registry.ts:8`, `src/shared/transcript/parse.ts:1` |
| worfy только читает этот файл; «worfy reads it»; в Claude home ничего не пишет | `t.md:77`, `src/main/claude-home/registry.ts:21`, `src/main/claude-home/subagents.ts:11` |
| Transcript — разговор на экране: файл, затем живые события («live events», шаг 2) | `t.md:19`, `src/renderer/session/SessionView.tsx:151`, `src/renderer/session/store.ts:227` |
| Limits в toolbar — доля окон на 5 часов и 7 дней; «reports the Limits» | `t.md:172`, `src/renderer/shell/toolbar/LimitsMeter.tsx:5`, `src/shared/agent/limits.ts:24`, `src/main/agent/app-registry.ts:199` |
| Claude Code — «one process per Session»; «your messages» от Orchestrator и Session | `src/main/agent/session.ts:1-2`, `src/main/agent/app-registry.ts:92`, `:164` |
| Шаг 1: писать из Node или из Session view; сообщение во время хода ждёт в очереди | `s.md:16`, `:40`, `src/main/agent/session.ts:17-18`, `:286-300` |
| Subagent «started by a Session», «starts»; шаг 3: Node справа от своей Session, со статусом | `CONTEXT.md:165-167`, `s.md:244-245`, `src/renderer/canvas/sources/subagents.ts:1-2`, `src/renderer/canvas/nodes/SubagentNode.tsx:15`, `:70` |
| Шаг 4 и связь «Resume, once finished»: Resume только законченной Session, Node только для чтения становится живым на месте | `s.md:56`, `:67`, `src/main/agent/resume.ts:3-5`, `src/main/agent/node-sessions.ts:218-220` |
| «read-only Node» из Claude home (реестр живых Session-ов) | `t.md:80-82`, `src/main/claude-home/registry.ts:4` |
| UTH: одна Session — один долгий query SDK в main, вход — очередь, новое сообщение не запускает процесс (блоки Session «states, queue, Interrupt», Claude Code «one long-running SDK query», связь «input queue») | `s.md:158-159`, `src/main/agent/session.ts:1-2`, `:17-18`, `src/main/agent/session/input-queue.ts` |
| UTH: сообщения SDK становятся AgentEvent-ами и идут во все окна по `agent.event` («SDK messages», «agent.event») | `s.md:221-222`, `src/main/agent/session.ts:4`, `src/main/ipc/agent.ts:3`, `:50`, `src/shared/ipc/agent.ts:115` |
| UTH: `agent.send` из Session view в Session | `s.md:219`, `src/shared/ipc/agent.ts:46` |
| UTH: файл — запись, renderer store ничего не сохраняет; «newest 5000 events per Session» | `t.md:46`, `src/renderer/session/store.ts:22`, `:33-34` |
| UTH: строки транскрипта — те же AgentEvent-ы, одна свёртка рисует оба; parse не падает на входе | `t.md:43-45`, `src/shared/transcript/parse.ts:3-5`, `:13` |
| UTH: Transcript reader «reads from a cursor», «new lines», `claudeHome.transcript` в Session view; Session view «joins file and live events» | `t.md:49-50`, `:65-67`, `src/main/claude-home/subagents.ts:7-8`, `src/shared/ipc/claude-home.ts:120`, `src/renderer/session/SessionView.tsx:151` |
| UTH: SubagentReader «reads what was appended» из `subagents/`, `claudeHome.subagents` дереву (rail и Node-ы на Canvas) | `s.md:305-307`, `src/main/claude-home/subagents.ts:1-10`, `:185`, `src/shared/ipc/claude-home.ts:154`, `src/renderer/session/rail/SubagentsRail.tsx:22` |
| UTH: LimitsTracker «merges, saves limits.json», `limits.changed` полоскам; полоски перерисовываются раз в 60 s | `t.md:209-211`, `src/main/agent/limits.ts:1-2`, `:16`, `:28`, `:58`, `src/shared/ipc/limits.ts:11`, `src/renderer/limits/useLimits.ts:8` |
| UTH: Session принадлежит Project-у, когда рабочая папка — корень, worktree или папка внутри | `t.md:87`, `src/main/claude-home/registry.ts:12` |
| UTH: три источника Limits — `rate_limit_event`, `rate_limits` status line, запрос usage | `t.md:182-183`, `src/main/agent/limits.ts:4-10`, `src/main/agent/limits-usage.ts:1-4` |
| Таблица файлов: назначение каждого из восьми | `s.md:200-217`, `t.md:56-63`, `:121-128`, `:202-207`; шапки самих файлов |
| Лимит: до 20 вложений, картинка до 3,75 МБ, копия файла до 20 МБ | `s.md:101-105`, `src/shared/agent/attachments.ts:25-32` |
| Лимит: Transcript открывается на последних 4 МБ, Load earlier — дальше назад; 5000 живых событий | `t.md:15-17`, `src/shared/ipc/claude-home.ts:95`, `src/renderer/session/SessionView.tsx:149`, `src/renderer/session/store.ts:34` |
| Лимит: продолжить можно только законченную Session | `s.md:56`, `src/main/agent/resume.ts:3-5` |
| Лимит: окно autocompact 100K–1M, по умолчанию 400K Orchestrator и 500K остальные | `s.md:119-121`, `src/shared/settings/app-settings.ts:75-83` |
| Лимит: запрос usage раз в 30 минут, пропускается при свежих пассивных источниках, токенов модели не тратит | `t.md:184-186`, `src/main/agent/limits-usage.ts:1-6`, `:26`, `:70-73` |

**Снимки** (Playwright против сборки ветки, окно 1280×800, обе темы в каждом файле-паре):
[EN](../evidence/08-sessions-en-light.png) / [dark](../evidence/08-sessions-en-dark.png),
[RU](../evidence/08-sessions-ru-light.png) / [dark](../evidence/08-sessions-ru-dark.png),
[подсветка Claude home](../evidence/08-sessions-lit-en-light.png), [шаг 2](../evidence/08-sessions-step-en-light.png),
[reduced motion, RU](../evidence/08-sessions-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/08-sessions-under-the-hood-en-light.png) / [RU dark](../evidence/08-sessions-under-the-hood-ru-dark.png),
[таблица файлов EN](../evidence/08-sessions-under-the-hood-files-en-light.png) / [RU](../evidence/08-sessions-under-the-hood-files-ru-light.png),
[подсветка Session на потоке данных](../evidence/08-sessions-flow-lit-en-light.png); у каждого есть пара `-dark`.
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей и связей обеих схем, 133 текста) против
своего фона, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет ни одного.

**Tokens.** Автор: около 200 тыс. токенов контекста к концу работы (точного счётчика у агента нет; оценка по объёму
прочитанного и написанного). Проверка: ещё нет, её делает второй агент.
