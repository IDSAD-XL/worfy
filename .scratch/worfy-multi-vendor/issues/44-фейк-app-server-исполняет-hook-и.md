# 44 — Фейк app-server исполняет hook-и по правилам Codex

Type: task
Status: done 2026-11-03T16:45Z
PR: #1300
Blocked by: —
Source: [spec.md](../spec.md), «Фейк и test-ы», «Гарантии workflow на Codex», «Решения владельца» (Q5 — parity suite на фейке); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), таблица и «Гарантии Harness без механизма в Codex»); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Фейк app-server (Ticket 18) играет сценарии, но hook-ов plugin-ов не запускает. Гарантии Harness на Codex
  (Ticket 36) держатся hook-ами, поэтому parity suite (Ticket 45) нужен фейк, который исполняет hook-и так, как их
  исполняет Codex.
- Ticket 36 выбирает один из двух путей read-only для reviewer и scout: отказ `PreToolUse` по `agent_type` или
  отдельный thread Codex с sandbox `read-only`. Оба пути должны проверяться на фейке до этого выбора.

## Что делаем

1. `test/fixtures/codex-app-server/hook-runner.mjs`: фейк читает `hooks/hooks.json` установленного plugin-а
   (временный `CODEX_HOME`) и исполняет его по правилам Codex закреплённой версии (источник —
   `codex-rs/hooks` той же версии, ссылки — в шапке файла):
   - события, которые Codex знает: `SessionStart`, `SubagentStart`, `PreToolUse`, `Stop`, `SubagentStop`,
     `SessionEnd`; незнакомые (`TaskCompleted`, `TeammateIdle`) — молча пропускаются;
   - matcher-ы `Bash`, `apply_patch` (алиасы `Edit`, `Write`), MCP tool-ы;
   - `PreToolUse`: `permissionDecision: "deny"` или exit 2 — действие не выполняется;
   - `Stop` / `SubagentStop`: `decision: "block"` или exit 2 — ход продолжается, `reason` — новый prompt;
   - `SessionEnd`: timeout 3 s;
   - вход hook-а — как у Codex: `agent_type`, `agent_id` у Subagent-а, `cwd`, `tool_name`, `tool_input`; форма —
     из записей входа hook-ов Ticket-а 30 (`test/fixtures/codex-messages/hooks/`);
   - доверие: hook-и исполняются, только если hash папки plugin-а подтверждён (файл подтверждения во временном
     `CODEX_HOME`); иначе — пропуск, как у Codex.
2. Sandbox `read-only` thread-а — как у Codex: thread, открытый с `sandbox: "read-only"`, не применяет правку файла
   (`apply_patch`, item `fileChange`) и не выполняет команду, которая пишет на диск; форма отказа — по сгенерированной
   JSON Schema протокола (Ticket 17). Запись команды фейк определяет по списку сценария (команда помечена «пишет»), а не
   разбором shell. Чтение и команды без записи идут как обычно.
3. Шаги сценариев: «агент вызывает tool X как `agent_type` Y», «агент заканчивает ход», «Subagent заканчивает ход»,
   «thread открыт с sandbox S».

Платформенный: запуск hook-команд (`node …`) на Windows.

## Готово, когда

- [x] Contract test: hook `PreToolUse` с deny — tool не выполнен; `Stop` с block — ход продолжен с `reason`;
      `TaskCompleted` в `hooks.json` — пропущен; без подтверждения hash — hook-и не запускаются.
- [x] Contract test: в thread-е с sandbox `read-only` правка файла и команда, помеченная «пишет», получают отказ, файл
      не меняется; чтение проходит; в thread-е с `workspace-write` та же правка проходит. Так оба пути read-only
      Ticket-а 36 проверяемы до его выбора.
- [x] Contract test: поля входа hook-ов фейка (`PreToolUse`, `Stop`, `SubagentStop`) совпадают с полями записей
      Ticket-а 30 в `test/fixtures/codex-messages/hooks/`. Если в записях нет `agent_type` (настоящий Codex перестал
      его присылать) — test красный.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/fixtures/codex-app-server/hook-runner.mjs` (новый)
- `test/fixtures/codex-app-server/fake-app-server.mjs` (Ticket 18) — вызов hook-runner-а и sandbox `read-only`
- `test/contract/codex-fake-hooks.test.ts` (новый)

Только читать: `test/fixtures/codex-messages/hooks/` (записи Ticket-а 30).

## Итог

Фейк app-server исполняет hook-и plugin-а, установленного во временный `CODEX_HOME`, по правилам Codex 0.166.0, и
держит sandbox thread-а. Правила взяты из source `codex-rs/` тега `rust-v0.166.0` (ссылки на файлы — в шапке
`test/fixtures/codex-app-server/hook-runner.mjs`); Codex не скачивался и не запускался.

- `hook-runner.mjs` (новый): plugin-ы из `CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`, их
  `hooks/hooks.json`; события `SessionStart`, `SubagentStart`, `PreToolUse`, `Stop`, `SubagentStop`, `SessionEnd`;
  незнакомые Codex (`TaskCompleted`, `TeammateIdle`) пропускаются молча. Matcher-ы — как в `matcher.rs`: пусто или `*` —
  всё, `[A-Za-z0-9_|]` — точный список, иначе regex; `apply_patch` отвечает и на `Edit`, `Write`. `PreToolUse`:
  `permissionDecision: "deny"` с причиной, `decision: "block"` или exit 2 со stderr — tool не выполняется. `Stop` /
  `SubagentStop`: `decision: "block"` или exit 2 — ход продолжается, причина приходит item-ом `hookPrompt`, следующий
  `Stop` идёт с `stop_hook_active: true`; `continue: false` — ход кончается. Timeout — 600 s по умолчанию, у
  `SessionEnd` 1 s по умолчанию и не больше 3 s; по истечении дерево процессов hook-а убивается. Вход hook-а — поля и их
  порядок из `schema.rs`; `agent_id` и `agent_type` в `PreToolUse` — только внутри Subagent-а, как в записях Ticket-а 30.
- Доверие — как Codex проверяет его при запуске: hook регистрируется, только если в `config.toml` `CODEX_HOME` есть
  `[hooks.state."<key>"]` с `trusted_hash` (любой строкой, и пустой); иначе — молча пропускается. Каждый запуск сверяет
  два hash-а, как `matches_hash` в `plugin_trust.rs`: `trusted_hash` — с hash-ем объявления hook-а (`declarationHash`,
  ровно `hook_hash` из `discovery.rs` и `version_for_toml` из `config/src/fingerprint.rs`), `trusted_content_hash` — с
  SHA-256 папки plugin-а (алгоритм `plugin_fingerprint.rs`). Не совпал любой — run `failed` с «plugin contents changed;
  hook approval required», действие идёт дальше. `approvePluginHooks` пишет подтверждение для test-ов, как `/hooks`
  пользователя.
- Каждый запуск hook-а фейк сообщает notification-ами `hook/started` и `hook/completed` (форма — как в записях).
- Sandbox: thread с `read-only` отказывает в `fileChange` (status `declined`) и в команде, которую шаг помечает
  `"writes": true` (status `failed`, exit code 1); файл не меняется; чтение идёт как обычно. В `workspace-write`
  правка пишется под `cwd` thread-а (`add`, `update` по hunk-ам, `delete`). `fileChange`, у которого `path` или
  `move_path` выходит за `cwd` thread-а (`../x`, абсолютный путь снаружи), отклоняется целиком (`declined`) в любом
  sandbox-е, ничего не пишется и не удаляется.
- Новые шаги сценария — ключ на шаге `notify` (формат — в шапке `fake-app-server.mjs`): `"tool"` на `item/completed`
  (агент вызывает tool как `agentType`), `"stop": "turn" | "subagent"` на `turn/completed` (агент или Subagent
  заканчивает ход; `continuation` — сколько следующих шагов играть только после block), `"start": "subagent"`. Так
  новые шаги проходят ту же проверку JSON Schema (`codex-fake.test.ts`) и сверку с записями (`codex-compat.test.ts`)
  без правок этих проверок. «Thread открыт с sandbox S» — `sandbox` результата `thread/start` в сценарии; `sandbox`,
  который просит worfy, важнее.
- Сценарии `hooks.jsonl` (агент и Subagent `worfy-reviewer`, Stop с block один раз) и `sandbox.jsonl`; plugin test-ов —
  `test/fixtures/codex-plugin-probe/`. Прежние шаги и сценарии не менялись.
- Test-ы: `test/contract/codex-fake-hooks.test.ts` (13) — deny, block и продолжение, hook-и `TaskCompleted` и
  `TeammateIdle` не регистрируются, без подтверждения, с изменённой папкой и с неверным `trusted_hash` при верном hash-е
  папки, hash объявления против literal-ов test-а самого Codex, exit 2, `SessionEnd` 3 s, read-only и workspace-write,
  правка за пределами `cwd`, поля входа против записей (и красный, если в записях нет `agent_type`); `codex-fake.test.ts` (+2) — всё, что фейк шлёт сам (hook run-ы, `hookPrompt`,
  отказы sandbox), проходит закрытую JSON Schema; неверные шаги — exit 2. Без новой реализации фейка новый test
  красный: 7 из 9.

Решено без владельца, подтвердить:

1. Отказ `PreToolUse`: фейк не шлёт item tool-а вовсе (ни `item/started`, ни `item/completed`), только `hook/completed`
   со status `blocked` и причиной. Что шлёт живой app-server при deny, записи Ticket-а 30 не показывают.
2. Отказ sandbox: `fileChange` — `declined`, команда — `failed` с exit code 1 и текстом «Operation not permitted»
   (так команда кончается под sandbox, который не даёт писать). Approval под `read-only` фейк не спрашивает.
3. Sandbox по умолчанию, без слова сценария и worfy, — `workspace-write`.
4. `SessionStart` идёт после первого `turn/start` thread-а (в записях run `sessionStart` несёт `turnId` первого хода);
   `SessionEnd` — при закрытии stdin, без notification-ов.
5. Контекст `SessionStart` / `SubagentStart` (`additionalContext` или простой stdout) — запись `context` в
   `hook/completed`; разбор этих двух событий в Codex не сверялся.
6. Hash объявления hook-а фейк считает ровно как Codex (`hook_hash`): нормализованный handler (команда этой ОС до
   подстановки `${PLUGIN_ROOT}`, timeout с умолчанием, `async`, `statusMessage`, `additionalContextLimit` не по
   умолчанию и только у событий, которые его держат), matcher — только у событий с matcher-ом; JSON с ключами по
   алфавиту, SHA-256. Сверено с literal-ами `trusted_hash` test-а Codex `core/tests/suite/hooks.rs` (тег
   `rust-v0.166.0`) — совпали оба. С записями Ticket-а 30 (`hooks/list`, `currentHash`) сверить нельзя: в них путь
   команды заменён при очистке, а hash считался от настоящего. Осталось `shortcut:` — подтверждение без
   `trusted_content_hash` (старое, до fingerprint-ов папки) фейк проваливает, Codex переносит его через свой legacy-файл.
7. Команда hook-а идёт через shell Node (`/bin/sh -c`, на Windows `cmd.exe /d /s /c`), как Codex без настроенного
   shell; `${CLAUDE_PLUGIN_ROOT}` и соседние подставляются в текст до запуска, поэтому `node "…"` работает и на Windows.
8. `fileChange` за пределами `cwd` thread-а фейк отклоняет (`declined`), как sandbox `workspace-write` не даёт писать
   вне рабочей папки; сценарий с такой правкой — ошибка test-а, а не запись на диск test-машины.

Для Ticket-а 42 (документация второго выпуска): `docs/features/vendors.md:180-186` («The fake Codex») не говорит, что
фейк исполняет hook-и установленного plugin-а и держит sandbox thread-а.

Платформенный: на Windows проверить `test/contract/codex-fake-hooks.test.ts` и `test/contract/codex-fake.test.ts` —
запуск `node "${CLAUDE_PLUGIN_ROOT}/…"` через `cmd.exe`, путь с `\` в hash папки, `taskkill /T /F` по timeout-у
`SessionEnd`.

### Долги gate (Wave 12, PR #1300)

Раунд 1 — REJECTED (med: фейк не сверял `trusted_hash` с hash-ем объявления hook-а), раунд 2 — VERIFIED: `declarationHash` даёт оба literal-а `codex-rs/core/tests/suite/hooks.rs:4785`, `:4787` (rust-v0.166.0).

- [low] `test/fixtures/codex-app-server/fake-app-server.mjs:270`: проверка «вне cwd» — по тексту пути; symlink внутри cwd, ведущий наружу, не ловится.
- [low] `hook-runner.mjs:357`, `:364`: тексты отказа отличаются от Codex (`pre_tool_use.rs:281`, `:289`); их пока никто не читает.
- [low] `fake-app-server.mjs:~185`: фейк читает `CODEX_HOME` из окружения; в dev с выставленным `CODEX_HOME` пользователя он запустит его настоящие подтверждённые hook-и (test-ы и e2e всегда ставят временный).
- Для Ticket-а 42: `docs/features/vendors.md:180-186` (раздел «The fake Codex») не говорит про hook-и и sandbox.
