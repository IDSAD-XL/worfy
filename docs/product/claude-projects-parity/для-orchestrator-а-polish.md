# Для Orchestrator-а: четыре Ticket-а в `worfy-polish`

Решение владельца 2026-11-28, тема `claude-projects-parity`, вопрос Q5, пункт 5д: «все да». Это удобства Session из
PR #2270, которых в worfy нет или которые есть частично. Источник фактов —
[заметка темы](research-что-уже-есть-разговор-library-удобства.md), раздел C. Ссылки даны на `c66e7215a`.

## 1. Fork Session с выбранного сообщения

- Что: в transcript-е Session пункт «Fork from here» на сообщении. Он открывает новую Session Node, которая продолжает
  разговор с этого места; исходная Session не меняется.
- Почему: в Claude Code это `/fork` (с 2.1.77 — `/branch`, с 2.1.212 копия идёт фоновой Session), в Claude Projects —
  отдельные thread-ы. worfy fork не вызывает никогда: «the SDK takes it there only together with forkSession, which
  worfy never asks for» (`src/main/vendors/claude/options.ts:286-290`).
- Проверить в работе: есть ли в SDK 0.3.322 продолжение с конкретного сообщения, а не только с конца разговора.

## 2. `/btw` в Session worfy

- Что: проверить на SDK 0.3.322, работает ли `/btw` (короткий вопрос в сторону, который не попадает в основной
  контекст), если набрать его в поле ввода Session worfy. Если нет — поддержать.
- Почему: slash-команды доходят до Claude Code, перехватывается только `/worfy:epic-wave`
  (`src/main/ipc/agent.ts:278`). Но типы SDK 0.3.289 описывают `/btw` как отдельный control request, а не как текст.
  В `node_modules` основного checkout лежит 0.3.289, а `package.json` закрепляет 0.3.322.

## 3. Модели по ролям в Edit profile

- Что: поля модели и effort для ролей implementer, reviewer, scout и verifier в форме Edit profile.
- Почему: в Profile эти поля есть (`harness/profiles/draft.schema.json:136-142`), но в UI их пишет только Eco mode
  (`docs/features/orchestrator-modes.md:30-31`). В Edit profile их нет (`docs/features/projects.md:434-438`).

## 4. Пауза Project-а

- Что: одна кнопка, после которой в Project-е ничего нового не стартует, а идущие turn-ы доходят до конца. Снятие паузы
  возвращает всё как было.
- Почему: мягкая остановка есть только у Autopilot (`docs/features/autopilot-faults.md:77`, `:85`). Паузы на весь
  Project нет.
- Размер средний: паузу надо провести через три механизма. Это продолжение Session после перезапуска worfy
  (`docs/features/sessions.md:36-37`), Auto-continue (`docs/features/sessions.md:342-343`) и Wake the Orchestrator у
  Assistant-а (`docs/features/assistant.md:258-260`).

## Не берём

Это тоже решение 5д:
- перезапуск координатора без остановки исполнителей: ADR-0031 — закрытая Session кончает свои Subagent-ы;
- экспорт и sharing transcript-а: пользователь worfy один;
- resolve и reopen: уже есть Archive и Restore;
- расход по Session и Ticket-у: он уже в черновике `worfy-limits-ledger`.
