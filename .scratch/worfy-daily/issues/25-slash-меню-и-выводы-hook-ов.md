# 25 — Slash-меню без дублей; выводы hook-ов без ложной ошибки

Type: task
Status: done 2026-10-06
PR: #63
Blocked by: 06, 07, 08, 09, 14, 30
Source: [spec.md](../spec.md), тема C; ручные проверки 2026-10-06, ночь — Ticket 20 worfy-mvp (`.scratch/worfy-mvp/issues/20-поле-ввода-slash-и-вложения.md:120`) и Ticket 14 worfy-mvp (`.scratch/worfy-mvp/issues/14-внешние-сессии-только-чтение.md:146`); HANDOFF, «Риски и долги»

## Что делаем

Два мелких дефекта Session view. Оба видны каждый день: slash-меню открывают в каждой Session, а
hook SessionStart срабатывает при каждом старте Session.

**1. Дубли в slash-меню.** После первого хода в меню 18 лишних строк без описания:

- 12 plugin skills: `/docs` рядом с `/anthropic-skills:docs`;
- 6 MCP prompts: `/github:AssignCodingAgent (MCP)` рядом с `/mcp__github__AssignCodingAgent`.

Причина: имена из `system/init` сравниваются с `supportedCommands()` буквально
(`src/main/agent/commands.ts:69-75`), а Claude Code пишет их по-разному. Пометка `skill` достаётся
строке без описания.

Правка: имена приводятся к одному виду до сравнения. Одна команда — одна строка, с описанием из
`supportedCommands()` и верной пометкой. В поле ввода вставляется та форма имени, которую Claude
Code принимает. Это проверяется вживую, итог — в «Итог».

**2. Красный крест у успешного hook-а.** Обычные выводы успешного hook SessionStart
(`hook_system_message`, `hook_additional_context`) Session view рисует красным крестом без текста.
Причины:

- `src/shared/transcript/parse.ts:203-210` берёт исход из типа вложения (`hook_` + исход) и не
  читает `attachment.content`;
- `src/renderer/session/Transcript.tsx:255` считает ошибкой всё, кроме `success`.

Правка: такие вложения — успешный вывод hook-а с текстом из `attachment.content`. Крест — только у
исходов ошибки и у ненулевого exit code. Какие исходы — ошибки, видно по транскриптам Claude Code;
список — в «Итог».

## Готово, когда

- [x] Фикстура `system/init` и `supportedCommands()` с обеими формами имён plugin skill и MCP prompt: у каждой команды одна строка, с описанием. Unit-test.
- [ ] (вручную) Собранное приложение, настоящий Claude Code: команда plugin skill и MCP prompt, выбранные из меню после первого хода, запускаются. Итог — в «Итог».
  2026-10-07: plugin skill из меню после первого хода запускается; MCP prompt не проверен — у серверов из списка по умолчанию (qmd, worfy-canvas) prompts нет, решение за владельцем — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- [x] Вложения `hook_system_message` и `hook_additional_context` из транскрипта разбираются как успешный hook с текстом: contract-test на фикстуре.
- [x] Session view рисует их без красного креста и с текстом; hook с ненулевым exit code — с крестом, как раньше. Unit-test.

## Тесты

- `test/unit/slash-commands.test.ts` — дубли по двум формам имён.
- `test/contract/transcript-parse.test.ts` — вложения hook-ов с `content`.
- `test/unit/transcript-hooks.test.tsx` (новый) — крест только у ошибки.
- Сначала падающий test: на фикстуре с `/docs` и `/anthropic-skills:docs` в списке команд две строки.

## Где в коде

- `src/main/agent/commands.ts`
- `src/shared/transcript/parse.ts`
- `src/renderer/session/Transcript.tsx`
- `test/unit/slash-commands.test.ts`
- `test/contract/transcript-parse.test.ts`
- `test/unit/transcript-hooks.test.tsx` (новый)

## Итог

**1. Slash-меню.** Как Claude Code 2.1.291 пишет имена (прочитано в его бинарнике, функции
`system/init` и ответа `initialize`): `slash_commands` и `skills` в `system/init` несут собственное
имя команды, `supportedCommands()` — имя из меню Claude Code, а собственное кладёт в `aliases`, когда
оно другое и в нём есть `:`.

- plugin skill: `anthropic-skills:docs` в `system/init`, `docs` с `aliases: ["anthropic-skills:docs"]`
  в `supportedCommands()`;
- MCP prompt: `mcp__github__AssignCodingAgent` в `system/init`, `github:AssignCodingAgent (MCP)` в
  `supportedCommands()`, без alias. Часть сервера в собственном имени — имя сервера, где всё, кроме
  `[a-zA-Z0-9_-]`, заменено на `_` (у серверов `claude.ai …` ещё схлопнуты `_`).

`CommandCatalog.list` (`src/main/agent/commands.ts`) сводит строку `supportedCommands()` (или
`system/commands_changed`) и имя `system/init` одной команды в одну строку: описание и подсказка —
из строки, имя — из `system/init`, пометка `skill` — по `skills`. Alias, который совпадает с
показанным именем другой строки (`/cost` у `/usage`, когда есть строка `/cost`), команду не
забирает. До первого хода (`system/init` ещё нет) MCP prompt получает имя `mcp__<сервер>__<prompt>`
вместо имени с пробелом: поле ввода считает имя команды до первого пробела.

Решено без владельца, подтверждено владельцем 2026-10-12: в поле вставляется собственное имя (`/anthropic-skills:docs`,
`/mcp__github__AssignCodingAgent`), а не имя из меню Claude Code. Довод: по собственному имени
Claude Code находит команду всегда, а короткое `docs` может совпасть со встроенной командой или
skill-ом пользователя (в `SlashCommand.builtin` SDK описано, что тогда `/docs` запускает встроенную).
Цена: до первого хода plugin skill в меню — `/docs`, после — `/anthropic-skills:docs`. Что обе формы
запускаются в настоящем Claude Code: форма после первого хода проверена 2026-10-07 (подраздел
[«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07)), форма до первого хода не проверялась.

**2. Выводы hook-ов.** Типы вложений hook-ов в транскриптах Claude Code (транскрипты в
`~/.claude/projects`, только чтение, и бинарник 2.1.291):

- вывод успешного hook-а: `hook_success` (stdout, exitCode), `hook_system_message` (`content` —
  строка), `hook_additional_context` (`content` — массив строк);
- ошибки: `hook_non_blocking_error` (stderr, exitCode), `hook_blocking_error`
  (`blockingError.blockingError`, `blockingError.command`), `hook_error_during_execution`
  (`content`), `hook_cancelled` (timedOut), `hook_stopped_continuation` (`message`: hook остановил ход);
- не ошибки и не вывод: `hook_permission_decision`, `hook_deferred_tool`.

`src/shared/transcript/parse.ts`: `hook_system_message` и `hook_additional_context` — исход
`success`, текст `content` в stdout (строки массива через перевод строки); пустой `content` —
hook не показывается, как молчаливый hook. Текст ошибки `hook_error_during_execution` и
`hook_blocking_error` — в stderr, `message` у `hook_stopped_continuation` — в stdout.

`src/renderer/session/Transcript.tsx`: крест — у исходов `error`, `cancelled` (live Session,
`hook_response`), `blocked` (сводка Stop hook-ов) и пяти ошибок выше, и у ненулевого exit code.
Остальные исходы — галочка.

Снимок: собранное приложение, транскрипт внешней Session с четырьмя hook-ами SessionStart —
[25-hook-rows.png](../evidence/25-hook-rows.png). Три успешных с галочкой и текстом, крест только у
`exit 127`.

Test-ы: `test/unit/slash-commands.test.ts` (обе формы имён, `commands_changed`, до `system/init`,
alias чужой строки), `test/contract/transcript-parse.test.ts` (раздел «hook attachments»),
`test/unit/transcript-hooks.test.tsx` (новый).


### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M11 второго круга ручных проверок). Stable copy из 5060858
(pid 74430, CDP 9351), Session view Node-а «New session» (Session 03d83bd0, Claude Code pid 56399)
после двух ходов, модель Sonnet.

- «/» открыл slash-меню: 130 строк (94 skill, 36 command). У всех строк есть описание, повторов
  имён нет. codebase-design — одна строка `/mattpocock-skills:codebase-design`, дубля без префикса
  нет. Пары code-review и deep-research — разные команды с разными описаниями (встроенный skill и
  synced skill), это не дубли.
- Щелчок мышью ОС по отфильтрованной строке вставил в поле «/mattpocock-skills:codebase-design ».
  Дописана просьба, отправлено по Return в 05:44:36Z. В транскрипте — `command-name`
  `/mattpocock-skills:codebase-design` и meta-сообщение «Base directory for this skill:
  …/codebase-design». Ответ — «Skill codebase-design загружен.» (`claude-sonnet-5-5`, 1.5 с).
  «Unknown skill/command» — 0.
- MCP prompt не проверен: строк «(MCP)» и `mcp__` в меню нет (3 совпадения `mcp__` — только в
  описаниях skill-ов). Session получила `allowedMcpServers` = qmd, worfy-canvas: поля `mcp` в Profile
  нет (`profile --field mcp` — exit 4). У qmd только tools (get, multi_get, query, status), в коде
  worfy нет `registerPrompt`.
- Решение за владельцем: добавить в `mcp.allowed` Profile-а сервер с prompts или закрыть подпункт
  как неприменимый.
  Владелец решил 2026-10-12: закрыть как неприменимый; проверить вживую, когда появится сервер с prompts.
- Вердикт: plugin skill — проверено; MCP prompt — не проверено, пункт остаётся `[ ]`.
- Снимки (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M11-before.png`,
  `M11-menu-open.png`, `M11-menu-filtered.png`, `M11-composed.png`, `M11-skill-run.png`.

### Долги из HANDOFF (2026-10-08)

- [low] `src/renderer/session/Transcript.tsx:149-157` и `:343` — ошибки hook-ов заданы перечнем:
  неизвестный будущий исход получит галочку.
- [low] `src/shared/transcript/parse.ts:203-218` — SessionStart hook с `additionalContext` даёт две строки.
- [low] `src/renderer/session/session.css:732-738` — колонка имени slash-меню 160 px обрезает длинные
  MCP-имена, `title` нет.
