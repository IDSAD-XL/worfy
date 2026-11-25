# 09 — MCP-сервер `worfy-app`: чтение, предложения, действия по режимам, чужой текст как данные

Type: task
Status: open
Blocked by: 03, 07
Source: [spec.md](../spec.md), «Ticket-ы», строка 09; «Решение», слой 2; «Решения по реализации» → «MCP-сервер
`worfy-app`»; «Границы», 1–4; «Решения по test-ам», Б; истории 21, 22, 24 и 25; «Волны», Wave 3

Кто: агент.

## Что строить

MCP-сервер `worfy-app` — единственный набор tools Session Assistant-а (Ticket 10).

1. **Привязан к приложению**, а не к cwd Session. Нынешние серверы worfy вне Project-а не работают.
2. **Чтение:** Project-ы и машины, пункты журнала, workflow Project-а, нити PR, хвост Session, Run Autopilot-а, Limits.
   Поиск и чтение описаний функций worfy — Ticket 17.
3. **Предложения:** создать, обновить, снять. У Prepare — точный текст будущей Session.
4. **Действия** — только те, что разрешает режим обязанности (Ticket 07), и только через функции main, у которых есть
   свои проверки. Например, pr-follow отказывает, пока идёт Autopilot; `autopilot_start` всегда открывает диалог.
5. **Чужой текст** помечен как данные, с источником и автором. Секретов в ответах нет.

## Где в коде

- Нынешние MCP-серверы worfy — `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts`,
  `src/main/mcp/mind-map-server.ts`, транспорт — `src/main/mcp/http-server.ts`; описания tools —
  `src/shared/canvas/tools.ts`, `src/shared/browser/tools.ts`, `src/shared/product/tools.ts`.
- Образцы contract test-ов — `test/contract/canvas-tools.test.ts`, `test/contract/browser-tools.test.ts`,
  `test/contract/mind-map-tools.test.ts`.
- Ядро внимания — Ticket 03; обязанности и режимы — Ticket 07.

## Решения

- Session Assistant-а работает с одним MCP-сервером `worfy-app` (spec, «Решение», слой 2).
- Привязка к приложению, состав чтения, предложений и действий, чужой текст как данные, без секретов (spec, «MCP-сервер
  `worfy-app`»).
- Границы 1–4: только tools `worfy-app`; чужой текст — только данные с источником и автором; Session с текстом, который
  написал Assistant, стартует только по щелчку пользователя, и пользователь видит этот текст до старта; наружу — только
  существующий щелчок Send (spec, «Границы»).

## Test-ы

Стык Б (spec, «Решения по test-ам»): contract test tools `worfy-app` — запросы к tools и ответы на них; чужой текст
помечен как данные; действие вне закрытого списка отклоняется; секретов в ответах нет. Образцы — contract test-ы tools
`worfy-canvas`, `worfy-browser` и `worfy-mind-map`.

## Готово, когда

- [ ] `worfy-app` работает у Session, cwd которой вне всех Project-ов.
- [ ] Contract test: tools чтения отвечают — Project-ы и машины, пункты журнала, workflow Project-а, нити PR, хвост
      Session, Run Autopilot-а, Limits.
- [ ] Contract test: предложение создаётся, обновляется и снимается; у Prepare в ответе — точный текст будущей Session.
- [ ] Contract test: действие вне закрытого списка или вне режима обязанности отклоняется.
- [ ] Contract test: действие идёт через функцию main с её проверками — pr-follow отказывает, пока идёт Autopilot;
      `autopilot_start` открывает диалог, а не запускает Run.
- [ ] Contract test: чужой текст в ответе помечен как данные, с источником и автором.
- [ ] Contract test: в ответах нет секретов.
- [ ] Ни один tool `worfy-app` не отправляет ничего вовне: ответа в PR среди tools нет.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
