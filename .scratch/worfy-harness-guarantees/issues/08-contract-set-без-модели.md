# 08: Contract set без модели

Type: task
Status: open
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
- [ ] Runner и шесть case-ов (или пять — с причиной из spike-а 01 в «Итог»); runner отличает «не смог запустить» от
      «guard не отказал».
- [ ] `test/contract/harness-guarantees.test.ts` идёт в `pnpm test` на binary SDK на macOS и Windows; копия Harness со
      сломанным `hooks.json` даёт красный case.
- [ ] Шапка набора называет его бесплатной половиной Ticket-а 15 worfy-harness-eval.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.
