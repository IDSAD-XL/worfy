# 180 — Fork Session с выбранного сообщения: «Fork from here» в transcript-е

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 (тема claude-projects-parity, Q5, пункт 5д: «все да») —
[просьба Product Session](../../../docs/product/claude-projects-parity/для-orchestrator-а-polish.md), раздел 1;
[заметка темы](../../../docs/product/claude-projects-parity/research-что-уже-есть-разговор-library-удобства.md),
раздел C, строка C2.

Кто: агент. Глубина review — `medium`.

## Что происходит

- Действия Fork в worfy нет ни в transcript-е Session, ни на Session Node.
- worfy fork не вызывает никогда. Комментарий у `sessionId` в `src/main/vendors/claude/options.ts:289`: «the SDK takes it
  there only together with forkSession, which worfy never asks for».
- В Claude Code это `/fork` (с 2.1.77 — `/branch`, с 2.1.212 копия идёт фоновой Session), в Claude Projects — отдельные
  thread-ы.
- Типы SDK 0.3.289 (лежит в `node_modules` основного checkout) описывают `forkSession` с `upToMessageId`. `package.json`
  на origin/main закрепляет `@anthropic-ai/claude-agent-sdk` 0.3.322 (`package.json:29`); 0.3.322 никто не проверял.
- Fork пишет новый transcript, поэтому правило «two processes must not write one transcript»
  (`docs/features/sessions.md:161`) не задето.

## Что строить

1. На сообщении transcript-а Session — пункт «Fork from here». Он открывает новую Session Node, которая продолжает
   разговор с этого места.
2. Исходная Session не меняется.

## Где в коде

- `src/main/vendors/claude/options.ts` — `resume` и `sessionId` в опциях запуска Session; `forkSession` worfy не
  передаёт.
- `src/renderer/session/Transcript.tsx` — transcript Session.
- `package.json` — версия SDK.

## Готово, когда

- [ ] Сначала — проверка SDK: есть ли в версии SDK, которую закрепляет `package.json` на origin/main (сейчас 0.3.322),
  продолжение с конкретного сообщения, а не только с конца разговора. Ответ записан в «Итог» этого Ticket-а: версия,
  имя опции и место в типах SDK, как проверено. Если SDK такого не умеет — implementer останавливается и сообщает
  Orchestrator-у; обходной путь не строится.
- [ ] «Fork from here» на сообщении открывает новую Session Node, которая продолжает разговор с этого сообщения;
  исходная Session и её transcript не меняются. Test на это, красный до правки.
- [ ] (вручную) Сделай: в Stable worfy открой Session с разговором, на сообщении в середине выбери «Fork from here» →
  Должно быть: появилась новая Session Node, она помнит разговор до этого сообщения и не помнит, что было после;
  исходная Session не изменилась.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
