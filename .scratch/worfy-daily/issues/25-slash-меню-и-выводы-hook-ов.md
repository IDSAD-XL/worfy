# 25 — Slash-меню без дублей; выводы hook-ов без ложной ошибки

Type: task
Status: blocked — blocked by 06, 07, 08, 09, 14
Blocked by: 06, 07, 08, 09, 14
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

- [ ] Фикстура `system/init` и `supportedCommands()` с обеими формами имён plugin skill и MCP prompt: у каждой команды одна строка, с описанием. Unit-test.
- [ ] (вручную) Собранное приложение, настоящий Claude Code: команда plugin skill и MCP prompt, выбранные из меню после первого хода, запускаются. Итог — в «Итог».
- [ ] Вложения `hook_system_message` и `hook_additional_context` из транскрипта разбираются как успешный hook с текстом: contract-test на фикстуре.
- [ ] Session view рисует их без красного креста и с текстом; hook с ненулевым exit code — с крестом, как раньше. Unit-test.

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
