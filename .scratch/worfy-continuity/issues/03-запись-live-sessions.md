# 03 — `live-sessions.json`: запись Session-ов с turn-ом или очередью

Type: task
Status: claimed 2026-11-17T23:32Z
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решения по реализации» → «Запись о работающих Session-ах»;
«Решения по test-ам», Unit; «Риски», 7 и 14

Кто: агент.

Не платформенный Ticket (main process; запись файла через временный файл и rename). Глубина ревью — `medium`.

## Что происходит

- Session, которую запустил worfy, принадлежит приложению и кончается вместе с ним (`docs/features/sessions.md:19–20`):
  на `will-quit` registry закрывает все Session-ы (`src/main/agent/app-registry.ts:67`).
- Очередь сообщений не переживает свою Session (`docs/features/sessions.md:104`). После перезапуска worfy не знает,
  какие Session-ы были в turn-е и что лежало в их очередях.
- У registry уже есть подписки на события и на ввод: `observeInput` (`src/main/agent/session/registry.ts:69`) и
  `observe` (`:91`); на них подписан Auto-continue (`src/main/agent/orchestrator-continue.ts`, шапка файла).
- Собственные файлы Project-а worfy держит в его подпапке данных, рядом с `bindings.json`
  (`docs/features/storage-and-diagnostics.md:177`).

## Что делаем

1. Файл `live-sessions.json` в подпапке Project-а, рядом с `bindings.json`. Не в репозитории Project-а и не в
   `~/.claude` (ADR-0005).
2. Запись на Session: id Node-а; session id SDK или thread id Codex; Vendor; вид — Orchestrator или Session Node;
   состояние — `busy` или ждёт разрешения; очередь — тексты, ссылки на вложения, held или нет; id Run-а, если Session
   им владеет; время последнего события; счёт автоматических продолжений за час. На весь файл — поле `version`.
3. Новый наблюдатель `src/main/agent/live-sessions.ts`, подписанный на `observe` и `observeInput` registry. Пишет
   только main, атомарно (временный файл и rename), на каждое изменение. Запись Session уходит, когда она стала idle с
   пустой очередью.
4. Чистый reader: незнакомая `version` или битый JSON — файл не читается, в log одна строка.
5. Binding в файл не копируется: при старте он читается заново из транскриптов (ADR-0002).
6. Английская страница `docs/features/storage-and-diagnostics.md`: строка таблицы о `live-sessions.json`; перевод —
   Ticket 14.

## Готово, когда

- [ ] Unit test reader-а: правильный файл; незнакомая `version`; битый JSON; пустой файл — в двух последних случаях
      записей нет и одна строка в log.
  - evidence: test-run pass · `pnpm test test/unit/live-sessions.test.ts` exit 0 · mac - · ae2d9832d
- [ ] Contract test на fake agent (`WORFY_AGENT=fake`): Session Node в turn-е с двумя сообщениями в очереди — запись
      в файле; Interrupt делает очередь held — запись говорит held; turn кончился и очередь пуста — записи нет.
  - evidence: test-run pass · `pnpm test test/contract/live-sessions.test.ts` exit 0 · mac - · ae2d9832d
- [ ] Contract test: Orchestrator под Run-ом — в записи id Run-а.
  - evidence: test-run pass · `pnpm test test/contract/live-sessions.test.ts` exit 0 · mac - · ae2d9832d
- [ ] Contract test: файл пишется через временный файл и rename — после записи в папке нет временного файла.
  - evidence: test-run pass · `pnpm test test/contract/live-sessions.test.ts` exit 0 · mac - · ae2d9832d
- [ ] Английская страница `docs/features/storage-and-diagnostics.md` называет `live-sessions.json`.
  - evidence: commit pass · worfy-continuity/03: record Sessions with a turn or a queue in live-sessions.json · - - · ae2d9832d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Новый `test/unit/live-sessions.test.ts` (reader) и contract рядом с `test/contract/node-sessions.test.ts`. Каждый test
  сначала красный.

## Где в коде

- `src/main/agent/live-sessions.ts` (новый)
- `src/shared/agent/live-sessions.ts` (новый: формат и reader)
- `src/main/agent/app-registry.ts` (подключение наблюдателя)
- `test/unit/live-sessions.test.ts` (новый)
- `test/contract/live-sessions.test.ts` (новый)
- `docs/features/storage-and-diagnostics.md`

Только читать: `src/main/agent/session/registry.ts`, `src/main/agent/orchestrator-continue.ts`,
`src/main/layout/bindings.ts`.

## Вне скоупа

- Чтение файла при старте и продолжение — Ticket 05; распознавание внешних вызовов без результата — Ticket 16.
