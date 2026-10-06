# 25 — Slash-меню без дублей; выводы hook-ов без ложной ошибки

Type: task
Status: open
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
  не проверено: агенту Ticket-а запрещено запускать настоящий Claude Code (запись в `~/.claude`) и GUI-проверки; пункт — для Orchestrator-а или владельца.
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

Решено без владельца, подтвердить: в поле вставляется собственное имя (`/anthropic-skills:docs`,
`/mcp__github__AssignCodingAgent`), а не имя из меню Claude Code. Довод: по собственному имени
Claude Code находит команду всегда, а короткое `docs` может совпасть со встроенной командой или
skill-ом пользователя (в `SlashCommand.builtin` SDK описано, что тогда `/docs` запускает встроенную).
Цена: до первого хода plugin skill в меню — `/docs`, после — `/anthropic-skills:docs`. Что обе формы
запускаются в настоящем Claude Code, не проверено — ручной пункт выше открыт.

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

