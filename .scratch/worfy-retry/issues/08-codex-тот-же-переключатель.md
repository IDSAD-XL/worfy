# 08 — Codex: тот же переключатель для Orchestrator-а на Codex

Type: task
Status: open
Blocked by: 04, 06
Source: [spec.md](../spec.md), «Как работает» → «Повтор после ошибки API (A)», п. 1 и 7, «Продолжение после Limits (B)», п. 2; «Сценарии» (строки Ticket-а 08); «Вопросы владельцу», Q6; [worfy-multi-vendor 37](../../worfy-multi-vendor/issues/37-orchestrator-и-autopilot-на-codex.md)

## Что происходит

- Orchestrator может быть Session Codex (worfy-multi-vendor 37). Вид ошибки хода — `terminalReason` из
  `codexErrorInfo` (`src/main/vendors/codex/items.ts:74-78`, `:257`, `:269`); `willRetry: true` — строка «It tries
  again», хода не кончает (`:254`).
- Отказ Limits — `usageLimitExceeded` → `limit_reached` (`src/main/vendors/codex/session.ts:259`), `reason` `window` или
  `quota`.
- Fake Codex — `test/fixtures/codex-app-server/fake-app-server.mjs` (`WORFY_CODEX=fake`), скрипты
  `test/fixtures/codex-scripts/`; схему каждой строки сверяет `test/contract/codex-fake.test.ts`.

## Что делаем

1. Contract test-ы Run-а и ручного хода на fake Codex с временным `CODEX_HOME`; настоящий `codex` не запускается.
2. Скрипты: `auto-continue-server-overloaded.jsonl` (ход `failed` с `serverOverloaded`, затем удачный),
   `auto-continue-will-retry.jsonl` (`error` с `willRetry: true`, затем удачный конец хода),
   `auto-continue-quota.jsonl` (`usageLimitExceeded`, квота без сброса).
3. Если `httpStatusCode` из `codexErrorInfo` нужен для вида ошибки (500 против 503) и теряется — передать его в
   `terminalReason` в `items.ts`; иначе `src/` не правится.
4. **`responseTooManyFailedAttempts` с `httpStatusCode` 429 — `other`** (решение Orchestrator-а 2026-11-04, PR #1387):
   Codex уже исчерпал свои повторы по rate limit, и повтор Auto-continue его не лечит; Claude `API Error: 429` уже
   `other`. В worfy-retry 03 это не сделано: `httpStatusCode` до `turnFailureKind` не доходит. `errorKind`
   (`src/main/vendors/codex/items.ts:74-78`) берёт из `codexErrorInfo` только ключ, а `TurnEndInput`
   (`src/shared/agent/turn-failure.ts`) кода не имеет. Поэтому сегодня любой `responseTooManyFailedAttempts` — `transient`
   `stream` (`turn-failure.ts:45`). Здесь: передать код в `terminalReason` (например, `responseTooManyFailedAttempts:429`)
   и в `turnFailureKind` читать 429 как `other`, остальные коды — как сейчас.
5. **Subagent-ы Codex не видны `externalActions`** (`src/shared/agent/continue-plan.ts`, worfy-retry 03): элемент
   `collabAgentToolCall` (запуск Subagent-а Codex) в `toolUse` (`src/main/vendors/codex/items.ts:101-111`) не становится
   событием `tool_use`, поэтому ход Codex, который запустил Subagent, читается так, будто внешнего действия не было.
   Здесь: отобразить `collabAgentToolCall` в `tool_use` (и его конец — в `tool_result`) с именем, которое
   `continue-plan.ts` читает как внешнее (любое имя не из `LOCAL_TOOLS` — внешнее; `Agent` даст строку `Agent (…)`).

## Готово, когда

- [ ] Contract test: Codex, `serverOverloaded`, затем удачный — `turn-retry`, `resumed`, одно продолжение.
- [ ] Contract test: `willRetry: true` — worfy ничего не шлёт, `turn-retry` нет.
- [ ] Contract test: квота без сброса — остановка с причиной, ожидания нет.
- [ ] Unit test: `responseTooManyFailedAttempts` с `httpStatusCode` 429 → `other`; без кода и с 5xx — как сейчас.
- [ ] Contract test: ход Codex с `collabAgentToolCall` без результата, затем `serverOverloaded` → `retry-refused` `in-flight`.
- [ ] Новые скрипты проходят проверку схемы `codex-fake.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/codex-auto-continue.test.ts` (новый).
- Сначала падающий: `serverOverloaded` — ожидание `turn-retry` красное, если классификатор не знает кода.
- Прогнать `test/contract/codex-*.test.ts`, `test/contract/autopilot*.test.ts`.

## Где в коде

- `test/contract/codex-auto-continue.test.ts` (новый)
- `test/fixtures/codex-scripts/auto-continue-*.jsonl` (новые)
- `src/main/vendors/codex/items.ts` (`httpStatusCode` в `terminalReason`, `collabAgentToolCall` в `tool_use`)
- `src/shared/agent/turn-failure.ts`, `test/unit/turn-failure.test.ts` (429 → `other`)

Только читать: `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/limits.ts`,
`test/fixtures/codex-app-server/fake-app-server.mjs`, `test/contract/codex-orchestrator.test.ts`.
