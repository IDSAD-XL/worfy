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
4. **`responseTooManyFailedAttempts` с `httpStatusCode` 429**: Codex уже исчерпал свои повторы по rate limit. Такой
   ход читается как `other` — повтора Auto-continue нет; это не временный обрыв потока. Сегодня `turnFailureKind`
   (`src/shared/agent/turn-failure.ts:45`) даёт для любого `responseTooManyFailedAttempts` `transient` `stream`:
   `httpStatusCode` до него не доходит. Нужны код в `terminalReason` (п. 3) и отдельный случай 429 в классификаторе;
   `turn-failure.ts` и его unit test тогда входят в «Где в коде» этого Ticket-а. Contract test — ход `failed` с
   `responseTooManyFailedAttempts` и `httpStatusCode` 429 → `retry-refused` `not-transient`, продолжение не ушло.

## Готово, когда

- [ ] Contract test: Codex, `serverOverloaded`, затем удачный — `turn-retry`, `resumed`, одно продолжение.
- [ ] Contract test: `willRetry: true` — worfy ничего не шлёт, `turn-retry` нет.
- [ ] Contract test: квота без сброса — остановка с причиной, ожидания нет.
- [ ] Новые скрипты проходят проверку схемы `codex-fake.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/codex-auto-continue.test.ts` (новый).
- Сначала падающий: `serverOverloaded` — ожидание `turn-retry` красное, если классификатор не знает кода.
- Прогнать `test/contract/codex-*.test.ts`, `test/contract/autopilot*.test.ts`.

## Где в коде

- `test/contract/codex-auto-continue.test.ts` (новый)
- `test/fixtures/codex-scripts/auto-continue-*.jsonl` (новые)
- `src/main/vendors/codex/items.ts` (только если нужен `httpStatusCode`)

Только читать: `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/limits.ts`,
`test/fixtures/codex-app-server/fake-app-server.mjs`, `test/contract/codex-orchestrator.test.ts`.
