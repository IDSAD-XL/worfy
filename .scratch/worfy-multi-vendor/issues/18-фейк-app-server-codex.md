# 18 — Фейк app-server Codex (`WORFY_CODEX=fake`)

Type: task
Status: done 2026-11-02T18:46Z
PR: #1253
Blocked by: 17
Source: [spec.md](../spec.md), «Фейк и test-ы», «Соглашения»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), таблица механизмов)

## Что происходит

- Фейк Claude — `WORFY_AGENT=fake` (`src/main/agent/app-registry.ts:170-190`), сценарии —
  `test/fixtures/agent-scripts/<имя>.jsonl`, лог — `WORFY_AGENT_LOG`.
- Для Codex фейка нет; test-ы не должны запускать настоящий Codex и входить в аккаунт.

## Что делаем

1. `test/fixtures/codex-app-server/fake-app-server.mjs` — Node-скрипт: JSON-RPC по stdio по строке на сообщение,
   как app-server. Шаги сценария: ответ на request, notification, server→client request (approval) и ожидание ответа
   worfy.
2. Сценарии — `test/fixtures/codex-scripts/<имя>.jsonl`: `turn` (простой ход), `steer`, `interrupt`, `approval`
   (команда и правка файлов), `resume`, `account-plus`, `account-pro` (одно недельное окно), `signed-out`,
   `login`, `limits-two-windows`, `usage-limit-window` (окно 100 % с `resetsAt`), `usage-limit-quota` (без окна),
   `threads` (для `thread/list` и `thread/read`).
3. `src/main/vendors/codex/launch.ts` — как стартует app-server: бинарник из Ticket-а 17 или, при
   `WORFY_CODEX=fake`, `process.execPath` с фейком. `WORFY_CODEX_SCRIPT`, `WORFY_CODEX_LOG` (request-ы worfy строками
   JSON), `WORFY_CODEX_HOME` (thread-ы фейка). `CODEX_HOME` процесса — из окружения test-а.
4. Каждое сообщение сценариев проверяется `ajv` по сгенерированной JSON Schema (`src/main/vendors/codex/protocol/json/`,
   Ticket 17): сценарий с полем или видом, которого нет в схеме закреплённой версии, — красный test. Схем руками нет.
5. Изоляция всех test-ов: `test/setup-contract.ts` и `test/e2e/launch-env.ts` выставляют `WORFY_CODEX=fake` и
   `CODEX_HOME` во временной папке (как `WORFY_CLAUDE_HOME`, `test/setup-contract.ts:98-103`,
   `test/e2e/launch-env.ts:84-85`). Ни один test не запускает настоящий Codex и не читает `~/.codex` разработчика.

Платформенный: запуск процесса фейка и пути `CODEX_HOME` на Windows.

## Готово, когда

- [ ] Contract test: фейк проходит `initialize` → `initialized`, `thread/start`, `turn/start` и отдаёт notification-ы
      сценария `turn`; лог содержит request-ы worfy.
- [ ] Contract test: под test-ами `launch.ts` не запускает бинарник `@openai/codex` (подменённый spawn видит только
      `process.execPath`) и ничего не пишет вне временных папок.
- [ ] Каждый сценарий проходит проверку `ajv` по сгенерированной JSON Schema; контрольный сценарий с лишним полем — красный.
- [ ] Contract test: без явного env процесс test-а видит `WORFY_CODEX=fake` и `CODEX_HOME` во временной папке (setup).
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/fixtures/codex-app-server/fake-app-server.mjs`, `test/fixtures/codex-scripts/` (новые)
- `src/main/vendors/codex/launch.ts` (новый)
- `test/contract/codex-fake.test.ts` (новый)
- `test/setup-contract.ts` — `:98-103` (рядом); `test/e2e/launch-env.ts` — `:44`, `:84-85`

Только читать: `src/main/agent/app-registry.ts:170-190`, `src/main/vendors/claude/fake-query.ts` (после Ticket-а 13).

## Итог

- Формат сценария — строка на шаг: `expect` (request worfy с `result` или `error`; без них — notification worfy),
  `notify`, `request` (server→client, фейк ждёт ответ). После последнего шага каждый request получает ошибку;
  request не по сценарию — ошибку с именем ожидаемого шага. Повтора сценария, как у фейка Claude, нет.
- Сгенерированные схемы открыты: лишнее поле их проходит. Test закрывает каждый объект копии bundle
  (`additionalProperties: false`; у объекта с ветками `oneOf` закрываются ветки, с полями объекта вокруг) и
  сверяет params по методу, ответ — по схеме `<Метод>Response`, выведенной из `<Метод>Params`. Контрольный сценарий
  с лишним полем — строкой в test-е, не в `test/fixtures/codex-scripts/`.
- `WORFY_CODEX_HOME`: фейк кладёт thread из ответа `thread/start` / `thread/resume` в `<home>/threads/<id>.json` и
  отказывает в `thread/resume` thread-а, которого там нет; без переменной `resume` отвечает по сценарию. Тексты
  ошибок (`no rollout found…`, `signed-out` для `account/rateLimits/read`) не сняты с живого Codex — сверит Ticket 30.
- `launch.ts` под vitest без `WORFY_CODEX=fake` бросает исключение — настоящий Codex не стартует ни в unit, ни в
  contract test-ах. Setup contract-проекта ставит `WORFY_CODEX` и `CODEX_HOME` всегда, даже если они есть в
  окружении разработчика; e2e — `CODEX_HOME` = `<профиль запуска>/.codex`.
- Вне списка файлов, по необходимости: `scripts/ci-scope.mjs` (папки фейка — в `E2E_FIXTURES`: их читает
  `src/main`, этого требует `test/contract/ci-workflow.test.ts`) и `test/contract/script-node.test.ts` (новый test
  читает `process.execPath` — строка в списке исключений).
