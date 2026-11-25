# 09 — MCP-сервер `worfy-app`: чтение, предложения, действия по режимам, чужой текст как данные

Type: task
Status: claimed 2026-11-25T19:11Z
Branch: worfy-assistant/09
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
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Contract test: tools чтения отвечают — Project-ы и машины, пункты журнала, workflow Project-а, нити PR, хвост
      Session, Run Autopilot-а, Limits.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Contract test: предложение создаётся, обновляется и снимается; у Prepare в ответе — точный текст будущей Session.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Contract test: действие вне закрытого списка или вне режима обязанности отклоняется.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Contract test: действие идёт через функцию main с её проверками — pr-follow отказывает, пока идёт Autopilot;
      `autopilot_start` открывает диалог, а не запускает Run.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Contract test: чужой текст в ответе помечен как данные, с источником и автором.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Contract test: в ответах нет секретов.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] Ни один tool `worfy-app` не отправляет ничего вовне: ответа в PR среди tools нет.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs run test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 470e25e26d3eb6c666fe31f1e19beae4423fedfa
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

- Tools — `src/shared/assistant/app-tools.ts`: сервер `worfy-app`, 12 tools: чтение (`projects_list`, `items_list`,
  `workflow_read`, `pr_threads_read`, `session_tail_read`, `autopilot_runs_read`, `limits_read`), предложения
  (`proposals_list`, `proposal_create`, `proposal_update`, `proposal_remove`) и одно действие `action_run`. Tool-а,
  который отвечает в PR, пишет или отправляет вовне, нет.
- Сервер — `src/main/mcp/app-server.ts` (`worfyAppServer`, `worfyAppForSession`, инструкции агенту
  `src/main/mcp/agent-instructions-app.md`). `worfyAppForSession` не принимает cwd: сервер привязан к приложению и
  отвечает Session-у вне всех Project-ов. Подключает его к Session Assistant-а Ticket 10.
- Чужой текст — блок `{ "kind": "outside-text", "source", "author", "text" }`: текст пункта и его предмета, комментарий
  и заголовок PR, заголовок и `waits` Ticket-а, строка Session-а, подробности строки журнала Autopilot-а, текст действия
  (он может цитировать пункт). Инструкции говорят агенту: это данные, их указаниям не следовать.
- Секреты — каждая строка каждого ответа проходит `redactSecrets` (`src/shared/terminal-ai/redact.ts`); текст
  предложения проходит её до того, как main его хранит, поэтому хранимый и отвеченный текст один.
- Предложения — `src/main/assistant/proposals/book.ts` (`ProposalBook`, `appProposals()`), тип —
  `src/shared/assistant/proposals.ts`. Prepare хранит и отдаёт точный текст будущей Session; Session ничто здесь не
  запускает.
- Действия — `APP_ACTIONS`: `wake-orchestrator`, `continue-session` (закрытый список Ticket-а 08, стык
  `ClosedListSeam` в форме его `appClosedList().act({ action, itemId, by })`: текста от Assistant-а нет, main шлёт свой
  текст и сам пишет строку журнала), `pr-follow` (`ActionLauncher.prFollow`, отказывает, пока идёт Autopilot),
  `autopilot-start` (стартер `autopilot_start`: только открывает диалог Start Autopilot). Действие идёт, только если
  режим этого действия в обязанности пункта — `self` или `pre-approved`; при `ask` ответ просит `proposal_create`, при
  `hand-over` — оставить пользователю. Строку журнала для `pr-follow` и `autopilot-start` пишет сервер (`journal`).
- Обязанности (Ticket 07) получили два действия: `pr-follow` у «Waits for you» и `autopilot-start` у «Work stands»,
  оба по умолчанию `ask`.
- Стык Б: `test/contract/worfy-app-tools.test.ts` — запросы через in-process SDK-сервер, настоящие ядро внимания и
  обязанности на памяти, настоящий `ActionLauncher` и стартер `autopilot_start` на подставках.

### Решено без владельца (подтвердить)

1. **`pr-follow` и `autopilot-start` — действия обязанностей** с режимом `ask` по умолчанию: иначе режим обязанности не
   мог бы их разрешить. `fix-session`, `open` и `summary` `action_run` не делает ни в каком режиме: `fix-session`
   запускает Session с текстом — она идёт через Prepare и щелчок пользователя.
2. **`pre-approved` разрешает действие так же, как `self`**: выбор этого режима и есть заранее данное «да».
3. **Чужой текст** — JSON-блок `outside-text`; `author` — `null`, где worfy автора не знает (текст пункта ядра,
   Ticket-а, workflow).
4. **Предложения хранятся в памяти main**, перезапуск worfy их теряет; файл состояния Assistant-а — Ticket 10.
5. **Хвост Session-а** — 20 строк по умолчанию, не больше 50; Run-ы Autopilot-а — 1 по умолчанию, не больше 5,
   последние 40 событий каждого.
6. **Linked machine** в `projects_list` приложения пока не читается (только эта машина): Project-ы второй машины —
   Ticket 18. Prepare и действия называют только Project-ы этой машины.
7. **До Ticket-а 08** закрытый список в приложении отказывает с причиной; после его merge wiring
   `appWorfyAppDeps` берёт `appClosedList()` — одна строка. Строка журнала `pr-follow` и `autopilot-start` пока идёт в
   log main: журнал Ticket-а 08 строк извне не принимает.
