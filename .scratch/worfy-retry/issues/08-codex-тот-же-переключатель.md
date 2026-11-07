# 08 — Codex: тот же переключатель для Orchestrator-а на Codex

Type: task
Status: done 2026-11-07T08:58Z
PR: #1562
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
  - evidence: gate pass · `gate fast` (pnpm test: test/contract/codex-auto-continue.test.ts) exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: review pass · PR #1562 · - - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3
- [ ] Contract test: `willRetry: true` — worfy ничего не шлёт, `turn-retry` нет.
  - evidence: gate pass · `gate fast` (pnpm test: test/contract/codex-auto-continue.test.ts) exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: review pass · PR #1562 · - - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3
- [ ] Contract test: квота без сброса — остановка с причиной, ожидания нет.
  - evidence: gate pass · `gate fast` (pnpm test: test/contract/codex-auto-continue.test.ts) exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: review pass · PR #1562 · - - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3
- [ ] Unit test: `responseTooManyFailedAttempts` с `httpStatusCode` 429 → `other`; без кода и с 5xx — как сейчас.
  - evidence: gate pass · `gate fast` (pnpm test: test/unit/turn-failure.test.ts, test/unit/codex-items.test.ts) exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: review pass · PR #1562 · - - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3
- [ ] Contract test: ход Codex с `collabAgentToolCall` без результата, затем `serverOverloaded` → `retry-refused` `in-flight`.
  - evidence: gate pass · `gate fast` (pnpm test: test/contract/codex-auto-continue.test.ts) exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: review pass · PR #1562 · - - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3
- [ ] Новые скрипты проходят проверку схемы `codex-fake.test.ts`.
  - evidence: gate pass · `gate fast` (pnpm test: test/contract/codex-fake.test.ts, test/contract/codex-compat.test.ts) exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: review pass · PR #1562 · - - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 545f0e6b5eef1f61a4fe3df26709ea805f0cf098
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42355777159/job/128358952836 · ci - · 81b6bcc0a1a5daad3fea93f12f30d876c1a415f3

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

## Итог

Переключатель Auto-continue на Orchestrator-е Codex проверен contract test-ами `test/contract/codex-auto-continue.test.ts`
на fake app-server (временный `CODEX_HOME`, настоящий `codex` не запускается): Run Autopilot-а и ручной ход, по четыре
сценария, плюс чтение окон перед продолжением ручного хода.

- **Сначала падающий.** `serverOverloaded` и квота Run-а прошли сразу: классификатор worfy-retry 03 уже знал
  `serverOverloaded`, а Run worfy-retry 04/05 — Codex. Красными до правки `src/` были: `collabAgentToolCall` без
  результата (Run — `timed out waiting for run 1 to stop`, ручной ход — другая строка вместо «not retried»), unit test-ы 429 и
  `httpStatusCode`, и чтение окон ручного хода (`timed out waiting for the second wait`).
- **`httpStatusCode` в `terminalReason`** (`items.ts`, `errorKind`): ключ `codexErrorInfo` и `:<код>`, когда Codex его
  дал (`responseTooManyFailedAttempts:429`, `httpConnectionFailed:503`); без кода — один ключ, как раньше.
  `turnFailureKind` читает ключ и код: 429 — `other` при любом ключе, остальные коды — по ключу, как сейчас.
- **`collabAgentToolCall` → `tool_use`/`tool_result`** с именем `collabAgentToolCall` (вход: `tool`,
  `receiverThreadIds`, `prompt`; результат — состояния агентов, ошибка при статусе не `completed`). Для
  `continue-plan.ts` это внешнее действие (не из `LOCAL_TOOLS`); строка ручного хода:
  ``worfy: not retried: `collabAgentToolCall` may or may not have run``. История Codex (`history.ts`) не меняется: там
  такие элементы раньше идут в `subagentEvents`.
- **`willRetry: true`** — строка «It tries again», хода не кончает: Run без `turn-retry`, ручной ход без таймера и строк.
- **Квота без сброса**: Run — `limits-hit` `reason: quota` и `run-stopped` `vendor-quota`, без `waiting-until`; ручной
  ход — `worfy: not continued: the Limits refused the turn by a quota, and nothing resets`, без ожидания.
- **Пробел worfy-retry 06 закрыт (решение владельца, передано Orchestrator-ом 2026-11-07).** Модуль ручного хода
  перед продолжением после ожидания Limits на Codex читает окна заново тем же путём, что Run: общий
  `LimitsWait.stillRefused` (`src/main/autopilot/limits-wait.ts`), `run.ts stillRefused` теперь зовёт его. В
  `app-orchestrators.ts` модулю даны `windows` (`appLimits().windowsOf`) и `usage` (`refreshAppUsage`, бесплатный
  `account/rateLimits/read`). Окно всё ещё исчерпано — ничего не уходит, новое ожидание до нового сброса и строка
  `worfy: waiting for the Limits, resumes HH:MM`; окно открыто — одно продолжение. На Claude Code путь прежний и
  синхронный: окна не читаются. `shortcut:` про это в `orchestrator-continue.ts` убран.
- Новые скрипты: `auto-continue-server-overloaded`, `-will-retry`, `-quota`, `-collab-in-flight`, `-limits-window`,
  `-limits-poll-used-up`; все проходят схему `codex-fake.test.ts` и формы записей `codex-compat.test.ts`.

- **Раунд ревью 1 (mutation testing).** Добавлены test-ы на чтение окон перед продолжением ручного хода, каждый
  проверен своим мутантом. Чтение окон держится, пока test его не отпустит; за это время человек пишет, выключают
  Auto-continue, открывают New conversation или приложение выходит. После этого чтение отвечает «окно открыто», и
  ничего не уходит (`test/contract/codex-auto-continue.test.ts`, мутант без `isCurrent` после чтения). Чтение
  падает: решают известные окна, unhandled rejection нет; для ручного хода и для Run-а
  (`codex-auto-continue.test.ts`, `codex-orchestrator.test.ts`, мутант, где `stillRefused` пробрасывает ошибку).
  Проводка `windows` и `usage` в `sharedOrchestratorContinue` проверена (`test/contract/app-orchestrators-continue.test.ts`).
  `LimitsWait.stillRefused` с `cutShort` проверен unit test-ом (`test/unit/limits-wait-still-refused.test.ts`).
  Код не менялся: ни один новый test дефекта не показал.

Решено без владельца:

- 429 — `other` при любом ключе `codexErrorInfo`, не только у `responseTooManyFailedAttempts`: так шапка
  `turn-failure.ts` («429 и любой rate limit — `other`») и Q4 (а). Сейчас 429 у других ключей Codex не встречался.
- Имя `tool_use` — `collabAgentToolCall`, не `Agent`: `Agent` читают дерево Subagent-ов и Flight Recorder как вызов
  Claude Code (`AGENT_TOOLS`), это поменяло бы их поведение на Codex. Цена — строка называет вызов
  `collabAgentToolCall`, а не `Agent (spawnAgent)`.
- Любой вызов `collabAgentToolCall` (и `wait`, и `listAgents`) — внешний: безопасная сторона, как у `Agent`.
- Строка ручного хода для `serverOverloaded` — `API error 529` (`ERROR_WORDS` модуля 06 по виду `overloaded`), не
  «server overloaded».
- `faultRun` получил необязательный `publish` (`test/contract/autopilot-faults-setup.ts`): Session Codex меняет id на
  id thread-а (`renamed`), и модулю ручного хода нужен новый view, как в приложении.

Вне следа тикета изменены (с разрешения Orchestrator-а для пробела 06 и по правилу страниц функций):
`src/main/agent/orchestrator-continue.ts`, `src/main/agent/app-orchestrators.ts`, `src/main/autopilot/limits-wait.ts`,
`src/main/autopilot/run.ts`, `test/unit/codex-items.test.ts`, `test/contract/autopilot-faults-setup.ts`,
`docs/features/sessions.md`, `docs/features/autopilot-faults.md` (страница Autopilot разделена в #1564; абзац о Codex и
строка test-а легли в раздел «Retry after an API error» и таблицу test-ов новой страницы).
