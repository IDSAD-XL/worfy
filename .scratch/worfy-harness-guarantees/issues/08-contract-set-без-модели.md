# 08: Contract set без модели

Type: task
Status: claimed 2026-11-28T02:37Z
PR: #2345
Branch: worfy-harness-guarantees/08
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 08; «Решение», 4; «Решения по реализации» («Contract set без модели»);
«Решения по test-ам», Seams (contract set), «Сначала падающий test», 08, «Windows» и «Без модели и без денег»;
«Связан с» (worfy-harness-eval 15); «Волны», Wave 2;
[critic 2026-11-28](../../../docs/product/critic/worfy-harness-guarantees-2026-11-28.md), возражение 3

Кто: агент. Глубина ревью — `medium`.

Платформенный PR (ADR-0056, пункт 2): набор идёт на binary SDK на macOS и на Windows; до merge нужен Windows verdict.

## Что происходит

- На настоящем binary Claude Code проверяется только hook SessionStart (`test/contract/harness-plugin.test.ts:103`).
  Полный набор eval-ов Harness идёт только при смене SDK, модели или Stable copy (`harness/README.md:247-251`), CI
  eval-ов не запускает.
- PR, который поднимает SDK (`package.json:29`), не краснеет, если hooks Harness на новом binary перестали работать.
- worfy-harness-eval (принят 2026-11-24) планирует платные case-ы тех же hook-ов: Ticket 15 «Case-ы: hook guard,
  hook-и stop и gate, subagent scout» (`docs/product/harness-eval/drafts/worfy-harness-eval.md:352`).

## Что строить

- `src/main/harness/contract/` (новая папка): case-ы, runner и stand-in Messages API.
  - Stand-in переезжает из `test/contract/messages-api-stand-in.ts`, чтобы набор запускало и приложение (Ticket 09).
    Импорты в `test/contract/harness-plugin.test.ts`, `assistant-session-claude.test.ts`,
    `ask-user-question-sdk.test.ts` переходят на новое место.
  - Runner: `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions` с копией Harness как
    plugin-ом; окружение — `claudeEnv` (`test/contract/messages-api-stand-in.ts:157`: фиктивный ключ, HOME во временной
    папке). Stand-in отвечает заранее записанными tool_use.
  - Runner отличает «не смог запустить» (binary, stand-in, API) от «guard не отказал»: Health (Ticket 09) пишет это
    разными строками.
- Шесть case-ов:
  1. plugin загружен, `plugin_errors` пуст;
  2. правила SessionStart пришли — case берёт проверку `harness-plugin.test.ts:103`;
  3. skills и агенты `worfy:` есть в init;
  4. `git reset --hard` при незакоммиченной правке отказан;
  5. Stop hook держит ход при красном gate (gate — stub);
  6. hook Subagent-а видит поле Subagent-а (`agent_type` или `agent_id` — по ответу spike-а 01), если spike показал,
     что stand-in ведёт ход Subagent-а; иначе case не пишется, и «Итог» это называет.
- Ticket 06 добавляет case-ы своих областей и правила Ticket-а 03, Ticket 05 — case merge: набор открыт для новых case-ов
  без правки runner-а.
- Решение владельца 2026-11-28 (critic, возражение 3): case-ы (4), (5) и case-ы отказов из 03, 05, 06 — бесплатная
  половина Ticket-а 15 worfy-harness-eval. На вопрос «отказал ли guard, держит ли Stop ход» отвечает этот набор;
  платный case 15 берёт только то, для чего нужна модель, — что агент делает после отказа. Комментарий в шапке набора
  это называет.
- `test/contract/harness-guarantees.test.ts` запускает набор в `pnpm test` на binary SDK, на macOS и Windows.

## Где в коде

- `src/main/harness/contract/` (новая папка) — case-ы, runner, stand-in
- `test/contract/messages-api-stand-in.ts` — переезжает (`claudeEnv` `:157`)
- `test/contract/harness-guarantees.test.ts` (новый)
- `test/contract/harness-plugin.test.ts`, `test/contract/assistant-session-claude.test.ts`,
  `test/contract/ask-user-question-sdk.test.ts` — импорт stand-in-а
- `test/fixtures/harness-broken-hooks/` (новый fixture, имя — предложение) — копия Harness со сломанным `hooks.json`
- Только читать: `harness/hooks/hooks.json`, `harness/hooks/guard.mjs`, `harness/hooks/stop.mjs`,
  `docs/product/harness-eval/drafts/worfy-harness-eval.md:352`

## Test-ы

- Contract set — `test/contract/harness-guarantees.test.ts` на binary SDK и stand-in, без модели.
- Сначала падающий test: копия Harness со сломанным `hooks.json` (fixture) даёт красный case; это пишется в «Итог».
- Windows: тот же test на Windows-binary SDK в CI.
- Без моделей и без денег: ни один test не ходит к модели; настоящий Codex binary не запускается.

## Готово, когда

- [ ] Stand-in Messages API лежит в `src/main/harness/contract/`; старые contract test-ы импортируют его оттуда и зелёные.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · d7f28800186fb001f3c95d8fcf571e8636bedea2
- [ ] Runner и шесть case-ов (или пять — с причиной из spike-а 01 в «Итог»); runner отличает «не смог запустить» от
      «guard не отказал».
  - evidence: test-run pass · `pnpm test test/contract/harness-guarantees.test.ts` exit 0 · mac - · d7f28800186fb001f3c95d8fcf571e8636bedea2
- [ ] `test/contract/harness-guarantees.test.ts` идёт в `pnpm test` на binary SDK на macOS и Windows; копия Harness со
      сломанным `hooks.json` даёт красный case.
  - evidence: test-run pass · `pnpm test test/contract/harness-guarantees.test.ts` exit 0 · mac - · d7f28800186fb001f3c95d8fcf571e8636bedea2
- [ ] Шапка набора называет его бесплатной половиной Ticket-а 15 worfy-harness-eval.
  - evidence: commit pass · worfy-harness-guarantees/08: contract set of the Harness on the SDK binary without a model · - - · d7f28800186fb001f3c95d8fcf571e8636bedea2
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.

## Итог

Сделано 2026-11-28 на `@anthropic-ai/claude-agent-sdk` 0.3.322 (Claude Code 2.1.322, binary пакета SDK), macOS arm64.
Модели, ключа и входа нет; настоящий Codex не запускался.

- **Stand-in** переехал в `src/main/harness/contract/messages-api-stand-in.ts` (`git mv`); три старых contract test-а и
  `scripts/spikes/harness-hooks/probe.ts` импортируют его оттуда. Добавлен `startScriptedStandIn` — цепочка вызовов на
  разговор по метке в первом сообщении, как в spike-е 01: ход Subagent-а (Agent у главного потока, Bash у Subagent-а)
  идёт без модели. `startMessagesApiStandIn` (один вызов на прогон) остался как был; `claudeEnv` берёт только `url`.
- **Runner** — `src/main/harness/contract/runner.ts`: `claude -p … --output-format stream-json --verbose
  --include-hook-events --permission-mode bypassPermissions --plugin-dir <Harness>`, окружение `claudeEnv` плюс
  `HARNESS_HOME` во временной папке прогона. Ответ — `passed`, `failed` (прогон был, Harness не сделал своё; причина
  называет, чего нет) или `not-run` (binary не стартовал, stand-in не слушает, нет `system/init`, Claude Code не спросил
  stand-in, нет `result` или он с ошибкой API, прогон не уложился в предел и остановлен по своему pid). Case — данные
  (`ContractCase`): новый case — ещё одна строка `CONTRACT_CASES`, runner не правится.
- **Шесть case-ов** — `src/main/harness/contract/cases.ts`; шапка файла называет набор бесплатной половиной Ticket-а 15
  worfy-harness-eval.
  1. `plugin-loaded` — в `plugins` есть имя из manifest-а, `plugin_errors` пуст.
  2. `session-start-rules` — первые строки `rules/orchestrator.md` и `rules/common.md` есть в первом запросе к stand-in-у,
     то есть правила дошли до модели.
  3. `skills-and-agents` — каждая папка `skills/*/SKILL.md` и каждый `agents/*.md` есть в init как `worfy:<имя>`.
  4. `guard-reset-hard` — `git reset --hard` при незакоммиченной правке: `tool_result` с `is_error` и текстом guard-а,
     правка на месте.
  5. `stop-holds-on-red` — gate — stub: resolver-stub (`CLAUDE_GATE_RESOLVE`) называет репозиторий
     зарегистрированным, в state лежит маркер `red-<key>-<tag>`, как после красного `gate.mjs fast`; после Stop приходит
     ещё один запрос главного потока с «The quality gate is red».
  6. `subagent-agent-id` — Bash внутри Subagent-а; PostToolUse hook Harness-а `hooks/calls.mjs` пишет лог
     `<session>.<agent_id>.jsonl`, то есть hook видит `agent_id`.
- **Test** — `test/contract/harness-guarantees.test.ts`: каждый case отдельным test-ом на `harness/` и binary SDK
  (`bundledClaudeBinary`), плюс два test-а runner-а: копия `harness/` с наложенным fixture
  `test/fixtures/harness-broken-hooks/hooks/hooks.json` (не JSON) даёт `failed` с `hook-load-failed`, несуществующий
  binary — `not-run` с «could not start». Весь файл на Mac — около 4 с; предел прогона runner-а — `ms(12_000)`, ниже
  предела contract test-а, так что зависший прогон приходит как `not-run` с выводом, а не как timeout test-а.
- **Сначала падающий test.** Test написан до кода и был красным (`Cannot find module '../../src/main/harness/contract/cases'`).
  После кода копия Harness со сломанным `hooks.json` даёт красный case `plugin-loaded`. Отдельно, руками (временный test,
  не в PR), четыре мутации копии Harness: без правила `reset --hard` в `guard.mjs`, `stop.mjs` с `return 0` вместо `2`,
  `calls.mjs` без `agent_id`, `hooks.json` без части orchestrator — каждая краснит ровно свой case (4, 5, 6, 2), остальные
  зелёные.

Отличия от текста тикета (по фактам spike-а 01 и кода):
- Fixture — не полная копия Harness, а один `hooks/hooks.json`, который test кладёт поверх временной копии `harness/`:
  полная копия в `test/fixtures/` отставала бы от `harness/`.
- Case 6 проверяет `agent_id`, не `agent_type`: `agent_type` есть и у главного потока Session с `--agent` (spike 01, п. 3).
  Поле видит настоящий hook Harness-а (`calls.mjs`), а не hook-проба.
- Case 2 не забирает test `harness-plugin.test.ts:103`: тот проверяет, что `WORFY_SESSION_KIND` доходит до hook-а (три вида
  Session на plugin-пробе), case — что правила полного Harness-а доходят до модели. Оба остаются.
- Windows локально не проверен: verdict — job Windows в CI.

Review round 1 (PR #2345, REJECTED на 32785ef5e). Каждое исправление — с test-ом, который был красным на 32785ef5e:
- **[high] Сломанный Harness выходил как `not-run`.** Копия, где `hooks/stage-lines.mjs` (UserPromptSubmit) выходит с
  кодом 2, давала «Claude Code never asked the stand-in … (exit code 0)». Теперь решение о прогоне — функция `judgeRun`
  (`src/main/harness/contract/runner.ts`): пришёл `system/init`, а хода к stand-in-у нет — `failed`, с блокирующим hook-ом
  в причине. Блокирующий hook — `hook_response` с `exit_code` 2 (`outcome: "error"`, так его пишет 2.1.322) или с JSON
  `decision: "block"` / `continue: false`. `not-run` остался для: binary не стартовал, нет `system/init`, stand-in не
  слушает, и — когда ни один hook не блокировал — ошибка API, нет `result`, предел времени. Test «a UserPromptSubmit hook
  that blocks every prompt»: на 32785ef5e `not-run`, теперь `failed`.
- **[med] Исключение в `check` роняло весь набор.** `check` теперь в try/catch: `failed` с «the check threw: …», набор
  отвечает за каждый case. Test «a check that throws»: на 32785ef5e — SyntaxError из `runContractSet`.
- **[med] Предел времени всегда давал `not-run`.** Stop, который держит каждый ход, на case-е `subagent-agent-id` давал
  «did not finish … 20 turns». С блокирующим hook-ом это теперь `failed` с его именем. Stop, который всегда выходит с
  кодом 2, на 2.1.322 сам заканчивает ход через 9–15 с, и test на нём зависел бы от времени. Поэтому test «a Stop hook
  that holds the turn and then hangs» держит ход один раз, а потом висит, пока жив Claude Code: hook пишет пробел раз в
  200 мс и выходит, когда его stdout рвётся (не позже 60 с). Предел runner-а `ms(5_000)`. На 32785ef5e (проверено во
  временном detached worktree) — `not-run: … did not finish in 15000 ms … 2 turns`.
- **[low] Тело запроса stand-in читал по кускам.** Символ на границе двух chunk-ов становился U+FFFD. Теперь байты
  собираются и декодируются один раз; так же stdout и stderr Claude Code в runner-е. Test «reads a character split between
  two chunks»: на 32785ef5e `MARKER ��� split`.
- Ветки «нет init», «ошибка API», «нет result», «предел времени» с блоком и без — unit test
  `test/unit/harness-contract-judge.test.ts` (13 test-ов, без процессов).
- `test/fixtures/sdk-messages/README.md:30` называет новый путь stand-in-а рядом со старым.
