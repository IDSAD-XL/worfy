# 19 — Клиент app-server Codex

Type: task
Status: done 2026-11-02T21:37Z
PR: #1256
Blocked by: 17, 18
Source: [spec.md](../spec.md), «Codex: бинарник и совместимость» (процесс на Session, без experimental), «Windows» (процесс); решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), «Как встраивать», «Главный риск»); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что делаем

1. `src/main/vendors/codex/rpc.ts` — JSON-RPC 2.0 поверх строк stdio: request с id и ответ, notification-ы,
   server→client request-ы с ответом worfy, ошибки JSON-RPC, время ожидания ответа. Каждое входящее сообщение
   проверяется `ajv` по сгенерированной JSON Schema (`protocol/json/`, Ticket 17); не прошедшее — событие `unknown`
   с именем метода и запись в log, а не исключение. Типы TypeScript — из `protocol/ts/`. Чистый модуль: вход и
   выход — строки.
2. `src/main/vendors/codex/app-server.ts` — процесс: запуск через `launch.ts` (Ticket 18) без shell, `initialize`
   с `clientInfo.name = 'worfy'` и без `experimentalApi`, затем `initialized`; stderr сохраняется, чтобы объяснить
   падение; `close()` ждёт выхода процесса, как `ClaudeCodeProcess` (`src/main/agent/session/types.ts:30-36`);
   падение процесса — ошибка всем ждущим request-ам.
3. Один процесс на Session; общего процесса нет (ADR-0094, Considered Options).

Глубина review — `high` (driver Codex). Платформенный: запуск и остановка процесса на Windows.

## Готово, когда

- [ ] Unit test `rpc.ts`: сообщение, которое не проходит схему, даёт `unknown`, а не исключение.
- [ ] Unit test `rpc.ts`: ответ находит свой request при перемешанных notification-ах; server→client request
      получает ответ; битая строка — ошибка, а не исключение; время ожидания — отказ с понятным текстом.
- [ ] Contract test на фейке: `initialize` с `clientInfo.name = 'worfy'`; фейк, упавший посреди хода, даёт ошибку
      ждущим request-ам; `close()` ждёт выхода.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/rpc.ts`, `src/main/vendors/codex/app-server.ts` (новые)
- `src/main/vendors/codex/launch.ts` (Ticket 18): вызов и guard от настоящего Codex — `VITEST` читается и из
  `process.env`, не только из переданного `env` (low-находка ревью Ticket-а 18)
- `test/unit/codex-rpc.test.ts`, `test/contract/codex-app-server.test.ts` (новые)
- `test/contract/codex-fake.test.ts`: test пути к настоящему бинарнику сам выключает `VITEST` (stub), иначе его
  останавливает новый guard

Только читать: `src/main/agent/session/types.ts:30-36`, `src/main/agent/session/process.ts`.

## Итог

- `rpc.ts` — чистый модуль JSON-RPC поверх строк; входящее сообщение проверяется `ajv` по схеме pinned Codex,
  не прошедшее — событие `unknown`, битая строка — событие `error`, ни то ни другое не бросает исключение.
- `app-server.ts` — процесс на Session через `launch.ts` без shell; `initialize` с `clientInfo.name = 'worfy'` и
  `capabilities: null` (без `experimentalApi`), затем `initialized`. Выход процесса отклоняет все ждущие request-ы
  ошибкой `CodexAppServerExit` с exit code и концом stderr; `close()` закрывает stdin и ждёт выхода, SIGKILL —
  после `EXIT_WAIT_MS`.
- Круг 2 (находки verifier-а, три пробела в test-ах; код `app-server.ts` не менялся) — contract test-ы в
  `test/contract/codex-app-server.test.ts`:
  - процесс, который не запустился (spawn несуществующего файла: только `error` и `close`, без `exit`), — `start()`
    отклоняется с «did not start» сразу, а не по времени ожидания `initialize`;
  - фейк закрыл свой stdin и жив — запись worfy получает EPIPE при `writable === true`; это warning, не
    uncaught error. Preload test-а закрывает fd 0 явно: `process.stdin.destroy()` его не закрывает;
  - `initialize` отвечен ошибкой — после отказа `start()` процесс уже вышел (exit code 0, по закрытию stdin).
  Каждый из трёх test-ов краснеет на своём mutant-е `app-server.ts` (строки 100, 87, 118). `afterEach` убивает по pid
  процесс, который test оставил живым, — без этого mutant строки 118 оставлял бы фейк после прогона.
- Windows: scope `runner` (`scripts/windows-verdict-scope.mjs`, exit 0) — вердикт Windows дал job
  `windows / full-suite` в зелёном `ci-ok` на `f414127b`; gate full на ПК этому PR не нужен. На Windows закрытие fd 0
  в фейке не ломает pipe для пишущей стороны: EPIPE нет (CI run 41522598755). Поэтому test с настоящим EPIPE —
  `it.skipIf(win32)`, а обработчик `error` stdin на всех ОС проверяет test, который сам шлёт `error` в stdin процесса;
  mutant строки 87 краснит оба.
- Ревью (PR #1256): ступень `high` по тексту тикета — решено без владельца, подтвердить. Круг 1 — verifier, два
  reviewer-а, три sceptic-а: REJECTED, три пробела test-ов (выше), 396 178 subagent-токенов. Круг 2 — verifier и
  reviewer test-ов (`medium`): VERIFIED; debt, 103 447 токенов.
- Consider (low, долги для тикета 20 и дальше):
  - `rpc.ts:227` — `emit` зовёт `onEvent` без try/catch: исключение обработчика выходит из `receive()`, хотя
    комментарий `rpc.ts:158` обещает «Never throws»;
  - `rpc.ts:113-119` — если `JSON.stringify` или `write` бросает, запись в `pending` и её таймер живут до timeout;
  - `app-server.ts:80` — request в незаписываемый stdin ждёт весь timeout вместо отказа сразу;
  - `rpc.ts:174` — ответ-ошибка с `id: null` (parse error JSON-RPC) не находит request, тот ждёт timeout;
  - `rpc.ts:88` — строка `null` от сервера бросает исключение;
  - `rpc.ts:19` — bundle схемы 750 KB импортируется статически; когда `session.ts` импортирует `app-server.ts`, он
    грузится при каждом старте, и у тех, кто работает только с Claude: dynamic import при первой проверке (Ticket 20);
  - безопасность: `CodexAppServerExit` кладёт до 16 KB stderr, а `rpc.ts:206` — сырую строку в `Error.message`;
    куда эти тексты пойдут (UI, log), решает Ticket 20;
  - вне диффа: `launch.ts:47-59` (Ticket 18) передаёт настоящему Codex весь `process.env` worfy без фильтра;
  - вопрос к Ticket 20: `start()` нельзя прервать во время `initialize`.
- Noted (low): выжившие mutant-ы test-ов по списку reviewer-а круга 1 (снятие таймера после ответа `rpc.ts:200/219`,
  ожидание вывода после exit `app-server.ts:33/95`, хвост stderr `:90`, опции `:83/:84/:131`, `respondError` `:140`,
  второй `close()` `:155`, SIGKILL против SIGTERM `:166`, коды JSON-RPC в test-е сверяются с константами, а не
  литералами `codex-rpc.test.ts:157`); у linger test-а нет верхней границы времени
  (`codex-app-server.test.ts:233`); crash test может потерять stderr, если `close` придёт позже 1 s под нагрузкой.
- Debt круга 2 (low): `codex-app-server.test.ts:247-248` — на Windows `close()` может вернуться (опрос ОС раз в
  50 ms) раньше события `exit` Node, и `hasExited(child)` / exit code 0 могут мигать; тот же приём в `:297`/`:308`
  проходит Windows CI. Исправление — сначала `if (!hasExited(child)) await once(child, 'exit')`.
- Dismissed: подозрение на гонку `wake` в `fake-app-server.mjs:98-108` — три оставшихся процесса фейка несли
  `WORFY_TEST_LINGER=1` и остались от mutant-ов без SIGKILL; три чистых прогона `codex-app-server.test.ts` (exit 0)
  процессов не оставили.
