# 100 — Новые модели Claude в списке моделей: подъём Agent SDK до 0.3.322 и Dependabot на его новые версии

Type: bug
Status: claimed 2026-11-10T15:47Z
PR: #1787
Branch: worfy-polish/100
Blocked by: —
Source: владелец 2026-11-10 (бриф Orchestrator-а): «Список доступных моделей Worfy не обновляется с появлением
новых… вышел новый Fable 5.2, но его нет в списке.» Платное снятие fixtures и запись транскриптов в
`~/.claude/projects` — разрешение владельца 2026-11-10 (через Orchestrator-а).

## Что происходит

Строки model picker-а — ответ `query.supportedModels()` того Claude Code, который запускает worfy
(`src/main/vendors/claude/session.ts`, `src/main/agent/session/models.ts` — отбрасывает только haiku). Своего списка
у worfy нет. Собранное приложение запускает бинарник платформенного пакета SDK (ADR-0057,
`claudeExecutablePath()` в `src/main/vendors/claude/options.ts`), а `package.json` держит
`@anthropic-ai/claude-agent-sdk` на 0.3.289 (Claude Code 2.1.289). В таблице моделей этого бинарника Fable 5.2 нет:
`fable` у него — Fable 5.1. На npm уже 0.3.322 (2026-11-10, Claude Code 2.1.322). Список стар ровно настолько,
насколько стар SDK, и никто не узнаёт о новой версии: `.github/dependabot.yml` нет.

## Что делаем

1. Поднимаем `@anthropic-ai/claude-agent-sdk` до 0.3.322 (`package.json`, `pnpm-lock.yaml`; платформенные пакеты —
   его optional dependencies, отдельно нигде не закреплены; `electron-builder.yml` распаковывает их маской
   `node_modules/@anthropic-ai/claude-agent-sdk-*/**`).
2. По уроку `docs/lessons/agents.md` («Agent SDK поднимать только до сборки с Claude Code 2.1.299 или новее и в том же
   PR заново снимать fixtures») снимаем `test/fixtures/sdk-messages/` заново на новом SDK и обновляем test-ы,
   которые держатся за значения старого снятия.
3. `.github/dependabot.yml`: npm, каждый день, только `@anthropic-ai/claude-agent-sdk*` одной группой.

## Готово, когда

- [ ] `package.json` и `pnpm-lock.yaml` на 0.3.322, установленный пакет — Claude Code 2.1.322; `pnpm typecheck` exit 0.
  - evidence: test-run pass · `pnpm typecheck` exit 0 (installed @anthropic-ai/claude-agent-sdk 0.3.322, claudeCodeVersion 2.1.322) · mac - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
- [ ] `supportedModels()` бинарника 0.3.322 отдаёт `fable` = «Fable 5.2» (и `claude-fable-5-1`), у 0.3.289 —
      `fable` = «Fable 5.1»; проверено без вызова модели (query без prompt-а).
  - evidence: test-run pass · `node list.mjs <checkout>` (query without a prompt, supportedModels()) exit 0: fable = Fable 5.2 on 0.3.322, fable = Fable 5.1 on 0.3.289 · mac - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
- [ ] `test/fixtures/sdk-messages/` сняты заново на Claude Code 2.1.322, `manifest.json` — `node scripts/sdk-compat.mjs
      manifest`; `background-tasks.jsonl` снимается сценарием `sdk-probe.ts`, а не потерянным одноразовым скриптом;
      личные слова владельца не попадают в fixtures (`node scripts/check-personal.mjs` exit 0).
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0; `pnpm test test/contract/sdk-compat.test.ts` exit 0 · mac - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0 after the rescrub (skill-N, <personal text>, <tmp>) · mac - · 5b27c9984ea4a9d16193651ee97b9db53f88b1e9
- [ ] `test/contract/sdk-compat.test.ts`, `test/contract/agent-events.test.ts`, `test/unit/agent-options.test.ts`,
      `test/contract/limits.test.ts`, `test/unit/claude-events.test.ts` зелёные на новом снятии; весь `pnpm test` exit 0.
  - evidence: test-run pass · `pnpm test` exit 0 (737 files, 17454 tests passed) · mac - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
  - evidence: test-run pass · `pnpm test test/contract/sdk-compat.test.ts test/unit/agent-options.test.ts test/unit/claude-events.test.ts test/contract/agent-events.test.ts test/contract/limits.test.ts` exit 0 (187 passed) · mac - · 5b27c9984ea4a9d16193651ee97b9db53f88b1e9
- [ ] `.github/dependabot.yml` есть; Dependabot PR идёт через тот же `ci.yml` (`pull_request`, без secrets).
  - evidence: commit pass · Raise the Agent SDK to 0.3.322 so the model picker lists Fable 5.2 (worfy-polish 100) · - - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
- [ ] e2e spec-и Session, model picker, Terminal AI, limits, narrator — exit 0.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/session-controls.spec.ts test/e2e/new-session.spec.ts test/e2e/session-view.spec.ts test/e2e/limits.spec.ts test/e2e/limits-vendors.spec.ts test/e2e/terminal-ai-request.spec.ts test/e2e/terminal-ai-suggest.spec.ts test/e2e/product-session.spec.ts test/e2e/first-run.spec.ts test/e2e/settings-health.spec.ts` exit 0 (43 passed) · mac - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ac5d22bf076d1c0c920973b03c13e3c6019e1488
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5b27c9984ea4a9d16193651ee97b9db53f88b1e9

## Где в коде

- `package.json`, `pnpm-lock.yaml` — версия SDK.
- `.github/dependabot.yml` — новый.
- `test/fixtures/sdk-messages/*` — новое снятие, `README.md`.
- `scripts/spikes/sdk-probe.ts` — сценарий `background-tasks`, resolver gate из `harness/hooks/` (старый путь
  `~/.claude/hooks/gate-resolve.mjs` исчез с переходом на plugin), личные слова → `<personal>`.
- `scripts/spikes/harness-plugin/probe.ts` — личные слова → `<personal>`.
- `scripts/sdk-compat.mjs` — `model_usage_since_last_result` как запись по модели.
- `test/contract/sdk-compat.test.ts`, `test/contract/agent-events.test.ts`, `test/unit/agent-options.test.ts`,
  `test/contract/limits.test.ts`, `test/unit/claude-events.test.ts` и его запись `test/fixtures/sdk-events/claude.json`.
- `src/main/agent/fake-query.ts`, `src/main/vendors/claude/options.ts` — комментарии с версией SDK.
- `docs/lessons/agents.md` — номер строки проверки урока.

## Вне скоупа

- Свой список моделей в worfy или запрос каталога моделей мимо Claude Code.
- Другие зависимости в Dependabot.

## Итог

**Что изменилось.**
- `@anthropic-ai/claude-agent-sdk` 0.3.289 → 0.3.322 (Claude Code 2.1.289 → 2.1.322). `supportedModels()` нового бинарника,
  спрошенный без prompt-а (без вызова модели): `default`, `opus` (Opus 5.5), `fable` (Fable 5.2), `sonnet` (Sonnet 5.5),
  `haiku` (Haiku 5.5), `claude-fable-5-1`, `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5`,
  `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`. У 0.3.289 `fable` — Fable 5.1, строк
  `claude-fable-5-1` и Haiku 5.5 нет. Model picker отбрасывает обе строки haiku, как и раньше.
- Fixtures сняты заново 2026-11-10 на 2.1.322, по подписке. Каким скриптом какой файл:
  - `scripts/spikes/sdk-probe.ts --fixtures`: `init`, `controls`, `stop-hook`, `no-login`, `permissions`, `bypass`
    (+ `can-use-tool.json`) и новый сценарий `background-tasks` (`background-tasks.jsonl`; прежний одноразовый скрипт
    worfy-daily/29 потерян).
  - `scripts/spikes/harness-plugin/probe.ts <сценарий> --fixtures`: `known` → `plugin-known-*.jsonl` (3),
    `workflow-hooks` → `plugin-workflow-hooks-user-settings.jsonl`, `env-file` → `plugin-env-file-sdk.jsonl`,
    `mcp-name` → `plugin-mcp-name-*.jsonl` (9, без вызова модели, в sandbox).
  - `manifest.json` — `node scripts/sdk-compat.mjs manifest`.
- Стоимость по `total_cost_usd` в result-ах (по API-ценам; оплачено подпиской): около 0,7 USD на все снятия.
- Чего новое снятие не повторило: «Prompt is too long» и `status: compacting` (у haiku 5.5 окно больше), пятичасового
  окна в `rate_limit_event` (у аккаунта его нет). Test-ы на эти случаи держат сообщения снятия 2026-10-05 у себя,
  сценарии Limits fake SDK играют пятичасовое окно по исключению в `test/contract/sdk-compat.test.ts`.
- В skill-ах пользователя было личное слово владельца. Оба probe (`scripts/spikes/personal-scrub.mjs`) пишут имя с
  таким словом как `skill-N` целиком, текст с ним — как `<personal text>`, и ставят такие записи в конец списка;
  временная папка Claude Code `/private/tmp/claude-<uid>/<проект>` — `<tmp>` (правки ревью, `--rescrub` без вызова модели).
- `.github/dependabot.yml`: npm, daily, только `@anthropic-ai/claude-agent-sdk*` одной группой, cooldown 1 день
  (pnpm 11 не ставит версии моложе суток), не больше 2 открытых PR. Dependabot PR идёт через `ci.yml` как любой PR,
  но его `ci-ok` красный, пока fixtures не сняты заново: `test/contract/sdk-compat.test.ts` так и задуман.
