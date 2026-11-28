# 07: Проверка Harness при старте на Claude Code

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 07; «Решение», 4; «Набросок функции» (шаг 1, notice «Harness did not load»);
«Решения по реализации» («Проверка Harness при старте на Claude Code»); «Решения по test-ам», Seams (worfy) и «Сначала
падающий test», 07; «Волны», Wave 2

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Для Claude Code проверки hooks Harness нет: «A Vendor that runs a plugin's hooks without an approval (Claude Code)
  has no such part, and nothing is checked for it» (`src/main/vendors/harness-hooks.ts:1-5`). У Codex она есть —
  `hooks/list` перед Run (`src/main/vendors/codex/harness-hooks.ts`, часть драйвера `src/main/vendors/codex/index.ts:27`).
- `sdkInit` (`src/shared/vendors/claude/events.ts:25-33`) выбрасывает `plugins` и `plugin_errors`: Session, где plugin
  `worfy` не загрузился, ничего не говорит.
- `unattendedRefusal` (`src/main/agent/orchestrator.ts:569`) отказывает Autopilot только по Vendor-у с частью
  `harnessHooks` (`src/main/vendors/driver.ts:34`, `src/main/agent/app-orchestrators.ts:127`).

## Что строить

- `sdkInit` читает `plugins` и `plugin_errors` (формы — по fixture-у spike-а 01 в `test/fixtures/sdk-messages/`), событие
  `init` несёт их дальше.
- Session, которой worfy дал Harness (`sessionHarnessPlugin`, `src/main/vendors/claude/options.ts:714-716`; у legacy
  Harness — plugin по имени `worfy`), без plugin `worfy` в `plugins` или с записью `plugin_errors` для него получает
  notice:

  ```text
  Harness did not load
  worfy · hook-load-failed: <message from Claude Code>
  Guards and the gate do not hold in this Session.
  [Open Health]  [Copy details]
  ```

  Тексты UI — на английском (ADR-0074).
- Новый `src/main/vendors/claude/harness-hooks.ts` — часть `HarnessHooksPart` (`src/main/vendors/harness-hooks.ts:8-16`)
  драйвера Claude (`src/main/vendors/claude/index.ts`):
  - `trust(cwd)` делает запрос без модели с plugin-ами Session, как `inventoryOptions` (`options.ts:762-770`), и
    читает `system/init`;
  - если spike 01 подтвердил `get_hooks_listing`, читает и его ответ: hooks PreToolUse и Stop plugin-а `worfy` в
    списке и не выключены;
  - ответ — `approved` или `unknown` с причиной; `refusal` — текст отказа Autopilot.
- `unattendedRefusal` с этой частью отказывает Autopilot на Claude Code без Harness, как на Codex.
- Комментарий `src/main/vendors/harness-hooks.ts:1-5` меняется: у Claude Code часть теперь есть.

## Где в коде

- `src/shared/vendors/claude/events.ts` — `sdkInit` `:25-33`, `case 'init'` `:212-225`
- `src/main/vendors/claude/harness-hooks.ts` (новый)
- `src/main/vendors/claude/index.ts` — часть `harnessHooks` драйвера
- `src/main/vendors/harness-hooks.ts` — комментарий `:1-5`
- `src/main/vendors/claude/options.ts` — `sessionHarnessPlugin` `:714-716`, `inventoryOptions` `:762-770` (только
  читать или общий helper)
- `src/main/agent/orchestrator.ts` — `unattendedRefusal` `:569`
- `src/renderer/session/` — notice «Harness did not load» (файл — по месту, где Session рисует notice-ы)
- `test/unit/` — разбор `system/init` и часть `harnessHooks` Claude (новые файлы, имена — предложение:
  `claude-init-plugins.test.ts`, `claude-harness-hooks.test.ts`)
- `test/e2e/` — notice в Session по fake init с `plugin_errors` (новый spec-файл или существующий spec Session)
- Только читать: `src/main/vendors/codex/harness-hooks.ts`, `test/fixtures/sdk-messages/` (fixture spike-а 01)

## Test-ы

- Unit: разбор `system/init` с `plugins` и `plugin_errors` по fixture-у spike-а; init без `plugin_errors` для `worfy` —
  без notice.
- Unit: часть `harnessHooks` Claude на fake query — `approved`, `unknown` с причиной; `unattendedRefusal` с этой частью
  отказывает.
- E2e: notice в Session по fake init с `plugin_errors` (агент — `WORFY_AGENT=fake`).
- Сначала падающий test: init с записью `plugin_errors` для `worfy` сегодня не даёт notice; test ждёт notice.
- Без моделей и без сети: настоящие Claude и Codex test-ы не запускают.

## Готово, когда

- [ ] `sdkInit` читает `plugins` и `plugin_errors`; Session, где plugin `worfy` не загрузился или с ошибкой, показывает
      notice «Harness did not load» с Open Health и Copy details (unit и e2e, красный на старом коде).
- [ ] У драйвера Claude есть часть `harnessHooks`: запрос без модели читает `system/init` (и `get_hooks_listing`, если
      spike 01 его подтвердил) и отвечает `approved` или `unknown` с причиной.
- [ ] Autopilot на Claude Code без Harness не стартует и называет причину, как на Codex.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
