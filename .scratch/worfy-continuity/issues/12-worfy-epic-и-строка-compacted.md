# 12 — worfy: `WORFY_EPIC`, дописка к system prompt, Codex `compact_prompt`, строка «Context compacted»

Type: task
Status: open
Blocked by: 11
Source: [spec.md](../spec.md), «Ticket-ы», 12; «Решения по реализации» → «Compaction», пункт «worfy (12)»; «Истории
пользователя», 10; «Риски», 13

Кто: агент.

Не платформенный Ticket (main process, driver-ы, renderer). Глубина ревью — `medium`; снимок экрана строки в Session view.

## Что происходит

- Окружение Session собирает `sessionEnv` (`src/main/vendors/claude/options.ts:745`); переменная вида Session —
  `WORFY_SESSION_KIND` (`:400`). Epic-а в окружении нет.
- Дописка к system prompt — поле `instructions` (`options.ts:396`), уходит в конец (`:824`).
- Codex: `config` уже уходит в `thread/start` (`src/main/vendors/codex/session.ts:961–967`); `compact_prompt` — поле
  `Config` протокола (`src/main/vendors/codex/protocol/ts/v2/Config.ts:25`). Когда Codex сжимает контекст, worfy не
  знает (`src/main/vendors/codex/items.ts:123`).
- На `compact_boundary` worfy только заново спрашивает заполнение контекста
  (`src/main/vendors/claude/session.ts:535–536`): ни строки в Session view.
- Session Orchestrator-а для Wave запускает `src/main/actions/launch.ts` (`waveBriefText` — `:139`).

## Что делаем

1. `WORFY_EPIC` в окружении Session Orchestrator-а, которую запустил Run или действие «Run wave», рядом с
   `WORFY_SESSION_KIND`.
2. Epic и Ticket-ы Wave — ещё и в дописке к system prompt (`instructions`), если «Итог» spike-а 01 (вопрос 4) показал,
   что она переживает compaction. Иначе — не добавлять и записать причину в «Итог».
3. Codex: `compact_prompt` с инструкциями Ticket-а 10 в `config` thread-а; если spike показал, что элемент
   `contextCompaction` приходит, — та же строка в Session view.
4. На `compact_boundary` Session view показывает строку «Context compacted (auto) · 812K → 41K» из `compact_metadata`:
   `trigger`, `pre_tokens` и `post_tokens`, когда он есть.
5. Английская страница `docs/features/sessions.md`: строка «Context compacted»; перевод — Ticket 14.

## Готово, когда

- [ ] Unit test `sessionEnv`: Session Wave-а несёт `WORFY_EPIC`; обычная Session — нет.
- [ ] Unit test: `compact_boundary` с `compact_metadata` даёт строку «Context compacted (auto) · 812K → 41K»; без
      `post_tokens` — без второго числа.
- [ ] Contract test на fake agent (`WORFY_AGENT=fake`): сценарий с `compact_boundary` — строка в событиях Session view.
- [ ] Contract test на fake app-server Codex: `compact_prompt` в `config` `thread/start`.
- [ ] Английская страница `sessions.md` описывает строку «Context compacted».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Unit для `src/main/vendors/claude/options.ts` и `src/shared/vendors/claude/events.ts`; сценарий fake agent в
  `test/fixtures/agent-scripts/`; contract Codex на `test/fixtures/codex-app-server/fake-app-server.mjs`. Каждый test
  сначала красный.

## Где в коде

- `src/main/vendors/claude/options.ts`
- `src/main/actions/launch.ts`
- `src/main/vendors/claude/session.ts`
- `src/shared/vendors/claude/events.ts`
- `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/items.ts`
- `src/renderer/session/` (строка в Session view)
- `test/fixtures/agent-scripts/` (новый сценарий)
- `docs/features/sessions.md`

Только читать: «Итог» Ticket-а 01, `harness/hooks/rules/compaction.md` (Ticket 10).

## Вне скоупа

- Своё сжатие контекста («якорные» summary) — вне Epic-а.
