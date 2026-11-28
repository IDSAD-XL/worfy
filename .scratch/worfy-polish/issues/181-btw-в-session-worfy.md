# 181 — `/btw` в Session worfy: короткий вопрос в сторону из поля ввода

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 (тема claude-projects-parity, Q5, пункт 5д: «все да») —
[просьба Product Session](../../../docs/product/claude-projects-parity/для-orchestrator-а-polish.md), раздел 2;
[заметка темы](../../../docs/product/claude-projects-parity/research-что-уже-есть-разговор-library-удобства.md),
раздел C, строки C1 и C19.

Кто: агент. Глубина review — `medium`.

## Что происходит

- `/btw` в Claude Code — короткий вопрос в сторону, который не попадает в основной контекст. Своего такого действия у
  worfy нет.
- Slash-команды из поля ввода Session доходят до Claude Code. Перехватывается только `/worfy:epic-wave`
  (`src/main/ipc/agent.ts:278`, `parseChatCommand`); остальной текст уходит сообщением пользователя.
- Меню «/» строится из того, что сообщает сам Claude Code: `supportedCommands()` и `system/init`
  (`src/main/agent/commands.ts`; `docs/features/sessions.md:125-129`).
- Но типы SDK 0.3.289 описывают `/btw` как отдельный control request (side question), а не как текст. Текстом `/btw`
  может не сработать — не проверено.
- В `node_modules` основного checkout лежит SDK 0.3.289, а `package.json` закрепляет 0.3.322 (`package.json:29`).
- Неизвестная запись transcript-а становится событием `unknown` (`docs/features/transcripts-and-usage.md:57`).

## Что строить

1. Проверить на SDK, который закрепляет `package.json`, работает ли `/btw`, если набрать его в поле ввода Session
   worfy.
2. Если нет — поддержать `/btw` в Session worfy.

## Где в коде

- `src/main/ipc/agent.ts` — отправка сообщения Session и перехват `/worfy:epic-wave`.
- `src/main/agent/commands.ts` — slash-команды для меню «/».
- `package.json` — версия SDK.

## Готово, когда

- [ ] Сначала — проверка SDK: поддерживает ли версия SDK, которую закрепляет `package.json` на origin/main (сейчас
  0.3.322), `/btw` как control request (side question) и работает ли `/btw`, набранный текстом в поле ввода Session
  worfy. Ответ записан в «Итог» этого Ticket-а: версия, место в типах SDK, как проверено и где виден ответ. Если `/btw`
  уже работает — Ticket закрывается этим ответом. Если в SDK нет control request-а для `/btw` — implementer
  останавливается и сообщает Orchestrator-у; обходной путь не строится.
- [ ] Если поддержка нужна: `/btw <вопрос>` из поля ввода Session worfy получает ответ, и вопрос с ответом не попадают
  в основной контекст Session. Test на это, красный до правки.
- [ ] (вручную) Сделай: в Stable worfy в Session с разговором набери в поле ввода `/btw` и короткий вопрос → Должно
  быть: ответ виден в Session, а следующее обычное сообщение агент продолжает так, будто вопроса в сторону не было.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
